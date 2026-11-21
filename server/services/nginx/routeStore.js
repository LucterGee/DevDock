const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { generateLocationBlock } = require('./generator');

const HEADER_MARK = '# devdock:generated';
const DEFAULT_ROUTE_DIR = path.join(os.homedir(), '.devdock', 'nginx', 'routes');
const DEFAULT_LOG_DIR = path.join(os.homedir(), '.devdock', 'nginx', 'logs');
const DEFAULT_BACKUP_DIR = path.join(os.homedir(), '.devdock', 'nginx', 'backups');
const DEFAULT_STATE_PATH = path.join(os.homedir(), '.devdock-nginx.json');

const createDefaultState = () => ({
  version: 1,
  nginx: {
    binPath: '',
    confPath: '',
    testCommand: 'nginx -t',
    reloadCommand: 'nginx -s reload',
    restartCommand: '',
    routesDir: DEFAULT_ROUTE_DIR,
    logDir: DEFAULT_LOG_DIR,
    editor: 'vscode',
    accessLog: { enabled: false, path: path.join(DEFAULT_LOG_DIR, 'access.log') },
    errorLog: { enabled: true, path: path.join(DEFAULT_LOG_DIR, 'error.log') },
    backupLimit: 10,
    onConflict: 'ask',
  },
  routes: [],
});

const sha256 = (text) => crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');

const ensureDir = (dir) => {
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
};

// 原子写：先写临时文件再 rename，避免写到一半被 nginx 读到
const writeFileAtomic = (filePath, content) => {
  ensureDir(path.dirname(filePath));
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, content, 'utf8');
  fs.renameSync(tmpPath, filePath);
};

const routeFileName = (route) => String(route.id || 'route').replace(/[^a-zA-Z0-9._-]+/g, '-') + '.conf';

const buildFileContent = (route) => {
  const body = generateLocationBlock(route);
  const hash = sha256(body);
  return [HEADER_MARK, '# id: ' + route.id, '# hash: ' + hash, '', body, ''].join('\n');
};

// 把文件拆成「头部注释块」和「正文」
const splitHeader = (content) => {
  const lines = String(content || '').split(/\r?\n/);
  let index = 0;
  while (index < lines.length && (lines[index].startsWith('#') || !lines[index].trim())) index += 1;
  return {
    header: lines.slice(0, index).join('\n'),
    body: lines.slice(index).join('\n').trim(),
  };
};

const readHeaderValue = (header, key) => {
  const match = new RegExp('^#\\s*' + key + ':\\s*(.+)$', 'm').exec(header);
  return match ? match[1].trim() : '';
};

const inspectFile = (filePath) => {
  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return { managed: false, path: filePath, missing: true };
  }

  if (!content.startsWith(HEADER_MARK)) {
    return { managed: false, path: filePath, missing: false };
  }

  const { header, body } = splitHeader(content);
  const recorded = readHeaderValue(header, 'hash');
  const actual = sha256(body);

  return {
    managed: true,
    missing: false,
    path: filePath,
    id: readHeaderValue(header, 'id') || path.basename(filePath, '.conf'),
    recordedHash: recorded,
    actualHash: actual,
    edited: Boolean(recorded) && recorded !== actual,
    body,
  };
};

const createNginxStore = (options = {}) => {
  const statePath = options.statePath || DEFAULT_STATE_PATH;
  const routesDir = options.routesDir || DEFAULT_ROUTE_DIR;

  const load = () => {
    const defaults = createDefaultState();
    if (!fs.existsSync(statePath)) {
      return { ...defaults, nginx: { ...defaults.nginx, routesDir } };
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      return {
        ...defaults,
        ...parsed,
        nginx: { ...defaults.nginx, ...(parsed.nginx || {}), routesDir },
        routes: Array.isArray(parsed.routes) ? parsed.routes : [],
      };
    } catch (error) {
      return { ...defaults, nginx: { ...defaults.nginx, routesDir } };
    }
  };

  const save = (state) => {
    ensureDir(path.dirname(statePath));
    writeFileAtomic(statePath, JSON.stringify(state, null, 2) + '\n');
    return state;
  };

  // 扫描路由目录：区分「DevDock 生成」「被手工改过」「用户自己的文件」
  const scan = () => {
    ensureDir(routesDir);
    const files = fs.readdirSync(routesDir).filter((name) => name.endsWith('.conf'));
    const managed = [];
    const edited = [];
    const untracked = [];

    for (const name of files) {
      const info = inspectFile(path.join(routesDir, name));
      if (!info.managed) {
        untracked.push({ name, path: info.path });
        continue;
      }
      if (info.edited) edited.push(info);
      managed.push(info);
    }

    return { managed, edited, untracked };
  };

  const writeRoute = (route) => {
    const filePath = path.join(routesDir, routeFileName(route));
    writeFileAtomic(filePath, buildFileContent(route));
    return filePath;
  };

  const removeRoute = (id) => {
    const filePath = path.join(routesDir, id + '.conf');
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  };

  // 把当前路由数据同步到目录：
  // - 只写「启用」的路由
  // - 被手工改过且不在 force 里的文件跳过（交给用户决定）
  // - 目录里已无对应路由的托管文件删除
  // - 未托管文件永远不动
  const sync = (state, options2 = {}) => {
    const routes = Array.isArray(state.routes) ? state.routes : [];
    const force = new Set(options2.force || []);
    const before = scan();
    const result = { written: [], skipped: [], removed: [], untracked: before.untracked };

    const editedIds = new Set(before.edited.map((item) => item.id));
    const activeIds = new Set();

    for (const route of routes) {
      if (route.enabled === false) continue;
      activeIds.add(route.id);
      if (editedIds.has(route.id) && !force.has(route.id)) {
        result.skipped.push({ id: route.id, reason: 'edited' });
        continue;
      }
      result.written.push(writeRoute(route));
    }

    for (const file of before.managed) {
      if (activeIds.has(file.id)) continue;
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
        result.removed.push(file.path);
      }
    }

    return result;
  };

  return { statePath, routesDir, load, save, scan, writeRoute, removeRoute, sync, inspectFile };
};

module.exports = {
  createNginxStore,
  createDefaultState,
  buildFileContent,
  inspectFile,
  splitHeader,
  routeFileName,
  writeFileAtomic,
  HEADER_MARK,
  DEFAULT_ROUTE_DIR,
  DEFAULT_STATE_PATH,
};
