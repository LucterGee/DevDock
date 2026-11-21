const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const { buildMainConfig, resolvePort } = require('./configBuilder');
const { createNginxStore } = require('./routeStore');

const NGINX_DIR_NAME = 'nginx';

const resolveBinaryPath = ({ resourcesPath, repoRoot, platform = process.platform, isPackaged = false }) => {
  const exe = platform === 'win32' ? 'nginx.exe' : 'nginx';
  const platformDir = platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux';
  if (isPackaged && resourcesPath) {
    return path.join(resourcesPath, NGINX_DIR_NAME, platformDir, exe);
  }
  return path.join(repoRoot || process.cwd(), 'resources', NGINX_DIR_NAME, platformDir, exe);
};

// 所有动作都用 -p/-c 固定前缀与配置，绝不碰系统 nginx
const buildArgs = ({ prefixDir, confPath, action = 'start' }) => {
  const base = ['-p', prefixDir, '-c', confPath];
  if (action === 'test') return [...base, '-t'];
  if (action === 'reload') return [...base, '-s', 'reload'];
  if (action === 'stop') return [...base, '-s', 'quit'];
  return base;
};

const readPid = (pidPath) => {
  try {
    const pid = Number(fs.readFileSync(pidPath, 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  } catch (error) {
    return 0;
  }
};

const isProcessAlive = (pid) => {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

const createNginxController = (options = {}) => {
  const platform = options.platform || process.platform;
  const repoRoot = options.repoRoot || path.join(__dirname, '..', '..', '..');
  const resourcesPath = options.resourcesPath || process.resourcesPath;
  const isPackaged = Boolean(options.isPackaged);
  const execFileImpl = options.execFile || execFile;
  const store = options.store || createNginxStore();

  const state = () => store.load();

  const binaryPath = () => resolveBinaryPath({ resourcesPath, repoRoot, platform, isPackaged });

  const binaryInstalled = () => {
    try {
      return fs.existsSync(binaryPath());
    } catch (error) {
      return false;
    }
  };

  const paths = () => {
    const current = state();
    const nginx = current.nginx || {};
    const prefixDir = nginx.prefixDir || path.join(os.homedir(), '.devdock', NGINX_DIR_NAME);
    return {
      prefixDir,
      confPath: path.join(prefixDir, 'nginx.conf'),
      pidPath: path.join(prefixDir, 'nginx.pid'),
      routesDir: nginx.routesDir || path.join(prefixDir, 'routes'),
      logDir: nginx.logDir || path.join(prefixDir, 'logs'),
    };
  };

  const ensureDirs = () => {
    const target = paths();
    for (const dir of [target.prefixDir, target.routesDir, target.logDir]) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return target;
  };

  const writeConfig = () => {
    const target = ensureDirs();
    const current = state();
    const content = buildMainConfig({
      ...current,
      nginx: {
        ...current.nginx,
        prefixDir: target.prefixDir,
        routesDir: target.routesDir,
        logDir: target.logDir,
        port: resolvePort(current.nginx),
      },
    });
    const tmpPath = target.confPath + '.tmp';
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, target.confPath);
    return { confPath: target.confPath, content };
  };

  const run = (action) => new Promise((resolve) => {
    const binary = binaryPath();
    if (!fs.existsSync(binary)) {
      resolve({
        ok: false,
        code: 'BINARY_MISSING',
        error: '未找到内置 nginx 二进制：' + binary + '\n开发模式下请先运行 npm run nginx:fetch 准备二进制。',
      });
      return;
    }

    const target = paths();
    const args = buildArgs({ prefixDir: target.prefixDir, confPath: target.confPath, action });
    execFileImpl(binary, args, { timeout: 15000 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error ? error.code || 'EXEC_FAILED' : 'OK',
        stdout: String(stdout || ''),
        stderr: String(stderr || ''),
        error: error ? String(stderr || error.message || '') : '',
        args,
        binary,
      });
    });
  });

  const status = () => {
    const target = paths();
    const pid = readPid(target.pidPath);
    const current = state();
    return {
      installed: binaryInstalled(),
      binaryPath: binaryPath(),
      running: isProcessAlive(pid),
      pid,
      port: resolvePort(current.nginx),
      prefixDir: target.prefixDir,
      confPath: target.confPath,
      routesDir: target.routesDir,
      logDir: target.logDir,
    };
  };

  return {
    state,
    store,
    binaryPath,
    binaryInstalled,
    paths,
    ensureDirs,
    writeConfig,
    status,
    test: () => run('test'),
    reload: () => run('reload'),
    stop: () => run('stop'),
    start: () => run('start'),
  };
};

module.exports = { createNginxController, resolveBinaryPath, buildArgs, readPid, isProcessAlive };
