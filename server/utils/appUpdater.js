const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { spawnSync } = require('child_process');

const ROOT_PACKAGE_PATH = path.join(__dirname, '../../package.json');

const readJsonFileSafe = (filePath, fallback = {}) => {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
};

const ROOT_PACKAGE = readJsonFileSafe(ROOT_PACKAGE_PATH, {});
const emitter = new EventEmitter();

let initialized = false;
let autoUpdater = null;
let electronApp = null;

const state = {
  appName:
    ROOT_PACKAGE?.build?.productName ||
    ROOT_PACKAGE?.name ||
    'DevDock',
  currentVersion: String(ROOT_PACKAGE?.version || '0.0.0'),
  supported: false,
  enabled: false,
  installSupported: false,
  checking: false,
  hasUpdate: false,
  downloaded: false,
  progress: 0,
  latestVersion: '',
  releaseName: '',
  releaseDate: '',
  status: 'idle',
  message: '',
  error: ''
};

const cloneState = () => ({ ...state });

// macOS 的 Squirrel.Mac 在安装前会校验新包签名，未签名或 ad-hoc 签名
// 必然失败（designated requirement 是当前二进制的 cdhash，新版本对不上）。
// 这里通过 bundle 是否带签名清单判断能否在本机安装。
// Squirrel.Mac 只接受带 Developer ID 证书的签名。
// ad-hoc 签名同样会生成 _CodeSignature，但校验必然失败，
// 所以这里要看证书而不是目录是否存在，否则会误判成可自动安装。
const isBundleSigned = (electronAppInstance) => {
  if (process.platform !== 'darwin') return true;
  try {
    const exe = electronAppInstance.getPath('exe');
    const appPath = path.resolve(path.dirname(exe), '..', '..');
    const result = spawnSync('codesign', ['-dv', '--verbose=2', appPath], { encoding: 'utf8' });
    const detail = `${result.stdout || ''}${result.stderr || ''}`;
    return /Authority=Developer ID Application/.test(detail);
  } catch (e) {
    return false;
  }
};

const emitState = () => {
  emitter.emit('state', cloneState());
};

const updateState = (patch = {}) => {
  Object.assign(state, patch);
  emitState();
};

const setup = () => {
  if (initialized) return cloneState();
  initialized = true;

  const isElectronRuntime = Boolean(process.versions && process.versions.electron);
  if (!isElectronRuntime) {
    updateState({
      supported: false,
      enabled: false,
      status: 'disabled',
      message: '仅打包后的桌面应用支持自动更新'
    });
    return cloneState();
  }

  try {
    const { app } = require('electron');
    const updaterModule = require('electron-updater');
    electronApp = app;
    autoUpdater = updaterModule.autoUpdater;
  } catch (e) {
    updateState({
      supported: true,
      enabled: false,
      status: 'disabled',
      error: e.message || '加载 electron-updater 失败',
      message: 'electron-updater 不可用'
    });
    return cloneState();
  }

  state.currentVersion = electronApp?.getVersion?.() || state.currentVersion;
  state.supported = true;
  state.enabled = !!electronApp?.isPackaged;

  if (!state.enabled) {
    updateState({
      status: 'disabled',
      message: '开发模式不支持自动下载与安装'
    });
    return cloneState();
  }

  state.installSupported = isBundleSigned(electronApp);

  // 无法安装时只检查不下载，避免白等一个大文件
  autoUpdater.autoDownload = state.installSupported;
  autoUpdater.autoInstallOnAppQuit = state.installSupported;

  autoUpdater.on('checking-for-update', () => {
    updateState({
      checking: true,
      status: 'checking',
      error: '',
      message: '正在检查更新…'
    });
  });

  autoUpdater.on('update-available', (info) => {
    updateState({
      checking: false,
      hasUpdate: true,
      downloaded: false,
      progress: 0,
      latestVersion: String(info?.version || ''),
      releaseName: String(info?.releaseName || ''),
      releaseDate: String(info?.releaseDate || ''),
      status: state.installSupported ? 'downloading' : 'manual',
      error: '',
      message: state.installSupported ? '发现新版本，正在下载…' : '发现新版本，需手动下载安装'
    });
  });

  autoUpdater.on('update-not-available', () => {
    updateState({
      checking: false,
      hasUpdate: false,
      downloaded: false,
      progress: 0,
      latestVersion: '',
      releaseName: '',
      releaseDate: '',
      status: 'no-update',
      error: '',
      message: '已是最新版本'
    });
  });

  autoUpdater.on('download-progress', (progressObj) => {
    updateState({
      checking: false,
      hasUpdate: true,
      downloaded: false,
      progress: Number(progressObj?.percent || 0),
      status: 'downloading',
      error: '',
      message: '正在下载更新包…'
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateState({
      checking: false,
      hasUpdate: true,
      downloaded: true,
      progress: 100,
      latestVersion: String(info?.version || state.latestVersion || ''),
      releaseName: String(info?.releaseName || state.releaseName || ''),
      releaseDate: String(info?.releaseDate || state.releaseDate || ''),
      status: 'downloaded',
      error: '',
      message: '更新已下载，重启后安装'
    });
  });

  autoUpdater.on('error', (err) => {
    updateState({
      checking: false,
      status: 'error',
      error: err?.message || String(err || '未知错误'),
      message: '更新失败'
    });
  });

  updateState({
    status: 'idle',
    message: '可以检查更新'
  });

  return cloneState();
};

const getState = () => {
  if (!initialized) setup();
  return cloneState();
};

const checkForUpdates = async () => {
  if (!initialized) setup();
  if (!state.enabled || !autoUpdater) {
    return {
      success: false,
      state: cloneState(),
      error: state.message || '当前模式不支持自动更新'
    };
  }
  if (state.checking) {
    return {
      success: true,
      state: cloneState(),
      message: '正在检查更新，请稍候'
    };
  }

  try {
    await autoUpdater.checkForUpdates();
    return {
      success: true,
      state: cloneState()
    };
  } catch (e) {
    updateState({
      checking: false,
      status: 'error',
      error: e.message || '检查更新调用失败',
      message: '检查更新失败'
    });
    return {
      success: false,
      state: cloneState(),
      error: state.error
    };
  }
};

// 未签名构建在 macOS 上无法自动安装，改为打开下载页手动安装
// 打包后 electron-builder 会裁掉 package.json 的 build 字段，
// 发布仓库信息改从 Resources/app-update.yml 读取
const resolvePublishTarget = () => {
  const ymlPath = process.resourcesPath
    ? path.join(process.resourcesPath, 'app-update.yml')
    : '';
  if (ymlPath && fs.existsSync(ymlPath)) {
    try {
      const text = fs.readFileSync(ymlPath, 'utf-8');
      const owner = (text.match(/^owner:\s*(.+)$/m) || [])[1];
      const repo = (text.match(/^repo:\s*(.+)$/m) || [])[1];
      if (owner && repo) return { owner: owner.trim(), repo: repo.trim() };
    } catch (e) {
      // 读取失败则回退到 package.json
    }
  }

  const publishConfig = Array.isArray(ROOT_PACKAGE?.build?.publish)
    ? ROOT_PACKAGE.build.publish[0]
    : ROOT_PACKAGE?.build?.publish;
  if (publishConfig?.owner && publishConfig?.repo) {
    return { owner: publishConfig.owner, repo: publishConfig.repo };
  }
  return null;
};

const openReleasePage = () => {
  if (!initialized) setup();

  const target = resolvePublishTarget();
  if (!target) {
    return { success: false, error: '未找到发布仓库配置' };
  }

  const url = 'https://github.com/' + target.owner + '/' + target.repo + '/releases/latest';
  try {
    const { shell } = require('electron');
    shell.openExternal(url);
  } catch (e) {
    return { success: false, error: e.message || '打开下载页失败' };
  }
  return { success: true, url };
};

const quitAndInstall = () => {
  if (!initialized) setup();
  if (!state.enabled || !autoUpdater) {
    return {
      success: false,
      state: cloneState(),
      error: state.message || '自动更新不可用'
    };
  }
  if (!state.installSupported) {
    return {
      success: false,
      state: cloneState(),
      error: '当前构建未签名，无法自动安装，请使用下载页手动安装。'
    };
  }
  if (!state.downloaded) {
    return {
      success: false,
      state: cloneState(),
      error: '更新包尚未下载完成'
    };
  }

  setImmediate(() => {
    autoUpdater.quitAndInstall();
  });

  return {
    success: true,
    state: cloneState()
  };
};

const onState = (listener) => {
  emitter.on('state', listener);
};

const offState = (listener) => {
  emitter.off('state', listener);
};

module.exports = {
  setup,
  getState,
  checkForUpdates,
  quitAndInstall,
  openReleasePage,
  onState,
  offState
};

