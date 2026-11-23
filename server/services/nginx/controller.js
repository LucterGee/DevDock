const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { execFile } = require('child_process');

const { buildMainConfig, resolvePort } = require('./configBuilder');
const { createNginxStore } = require('./routeStore');

const NGINX_DIR_NAME = 'nginx';

const resolveBinaryPath = ({ resourcesPath, repoRoot, platform = process.platform, isPackaged = false }) => {
  const exe = platform === 'win32' ? 'nginx.exe' : 'nginx';
  const platformDir = platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux';

  const packagedPath = resourcesPath
    ? path.join(resourcesPath, NGINX_DIR_NAME, platformDir, exe)
    : '';

  if (isPackaged && packagedPath) return packagedPath;

  // 打包后代码位于 app.asar 内，按 repoRoot 拼出来的路径会指向
  // app.asar/resources/...，实际资源在 process.resourcesPath 下。
  // 因此未显式标记打包态时，以真实存在的路径为准。
  if (packagedPath && fs.existsSync(packagedPath)) return packagedPath;

  return path.join(repoRoot || process.cwd(), 'resources', NGINX_DIR_NAME, platformDir, exe);
};

// 服务端也可能以纯 Node 方式运行，这里做兼容判断
const detectPackaged = () => {
  try {
    const { app } = require('electron');
    if (app && typeof app.isPackaged === 'boolean') return app.isPackaged;
  } catch (e) {
    // 非 Electron 环境
  }
  const resourcesPath = process.resourcesPath || '';
  return resourcesPath.includes('Contents/Resources');
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

// 探测 127.0.0.1 上是否已有监听。nginx 绑的是 *:port，若本机另有进程
// 绑定了 127.0.0.1:port，系统会把本机请求投给更具体的那个绑定，
// 表现为连接成功但收不到响应，因此启动前必须单独检查
const isPortInUse = (port, host = '127.0.0.1', timeout = 400) => new Promise((resolve) => {
  if (!port) { resolve(false); return; }
  const socket = net.connect({ port, host });
  const finish = (result) => {
    socket.destroy();
    resolve(result);
  };
  socket.setTimeout(timeout);
  socket.once('connect', () => finish(true));
  socket.once('timeout', () => finish(false));
  socket.once('error', () => finish(false));
});

const createNginxController = (options = {}) => {
  const platform = options.platform || process.platform;
  const repoRoot = options.repoRoot || path.join(__dirname, '..', '..', '..');
  const resourcesPath = options.resourcesPath || process.resourcesPath;
  const isPackaged = options.isPackaged === undefined ? detectPackaged() : Boolean(options.isPackaged);
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
    const prefixDir = options.prefixDir || nginx.prefixDir || path.join(os.homedir(), '.devdock', NGINX_DIR_NAME);
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

  const buildContent = () => {
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
    return { target, content };
  };

  const writeConfig = () => {
    const { target, content } = buildContent();
    const tmpPath = target.confPath + '.tmp';
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, target.confPath);
    return { confPath: target.confPath, content };
  };

  // 保证配置文件与当前状态一致：文件缺失或内容已过期时重新生成
  const ensureConfig = () => {
    const { target, content } = buildContent();
    let existing = '';
    try {
      existing = fs.readFileSync(target.confPath, 'utf8');
    } catch (error) {
      existing = '';
    }
    if (existing !== content) writeConfig();
    return target.confPath;
  };

  // 打包进 Resources 的 dylib 通过 @loader_path 引用，这里再兜一层搜索路径
  const buildEnv = () => {
    const env = { ...process.env };
    if (platform === 'darwin') {
      const libDir = path.join(path.dirname(binaryPath()), 'lib');
      if (fs.existsSync(libDir)) {
        env.DYLD_LIBRARY_PATH = [libDir, env.DYLD_LIBRARY_PATH].filter(Boolean).join(':');
        env.DYLD_FALLBACK_LIBRARY_PATH = env.DYLD_LIBRARY_PATH;
      }
    }
    return env;
  };

  const run = async (action) => {
    const binary = binaryPath();
    if (!fs.existsSync(binary)) {
      return {
        ok: false,
        code: 'BINARY_MISSING',
        error: '未找到内置 nginx 二进制：' + binary + '\n开发模式下请先运行 npm run nginx:fetch 准备二进制。',
      };
    }

    const target = paths();
    const running = isProcessAlive(readPid(target.pidPath));

    if ((action === 'reload' || action === 'stop') && !running) {
      return { ok: false, code: 'NOT_RUNNING', error: 'nginx 未运行，无法执行该操作' };
    }
    if (action === 'start' && running) {
      return { ok: false, code: 'ALREADY_RUNNING', error: 'nginx 已在运行' };
    }

    if (action === 'start') {
      const port = resolvePort(state().nginx);
      if (await isPortInUse(port)) {
        return {
          ok: false,
          code: 'PORT_IN_USE',
          error: '端口 ' + port + ' 已被其他程序占用（127.0.0.1），本机请求不会到达 nginx，请更换端口后重试',
        };
      }
    }

    if (action !== 'stop') ensureConfig();
    const args = buildArgs({ prefixDir: target.prefixDir, confPath: target.confPath, action });

    return new Promise((resolve) => {
      execFileImpl(binary, args, { timeout: 15000, env: buildEnv() }, (error, stdout, stderr) => {
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
  };

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
    ensureConfig,
    writeConfig,
    status,
    test: () => run('test'),
    reload: () => run('reload'),
    stop: () => run('stop'),
    start: () => run('start'),
  };
};

module.exports = { createNginxController, resolveBinaryPath, buildArgs, readPid, isProcessAlive };
