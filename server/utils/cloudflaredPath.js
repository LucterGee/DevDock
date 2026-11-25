const fs = require('fs');
const path = require('path');

const CLOUDFLARED_DIR_NAME = 'cloudflared';

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

// 内置的 cloudflared 在打包后位于 resources/cloudflared/<platform>/，
// 开发模式下位于仓库的 resources 目录
const resolveCloudflaredPath = (options = {}) => {
  const platform = options.platform || process.platform;
  const exe = platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const platformDir = platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux';

  const resourcesPath = options.resourcesPath !== undefined ? options.resourcesPath : process.resourcesPath;
  const packagedPath = resourcesPath
    ? path.join(resourcesPath, CLOUDFLARED_DIR_NAME, platformDir, exe)
    : '';
  const isPackaged = options.isPackaged === undefined ? detectPackaged() : Boolean(options.isPackaged);

  if (isPackaged && packagedPath) return packagedPath;
  if (packagedPath && fs.existsSync(packagedPath)) return packagedPath;

  const repoRoot = options.repoRoot || path.join(__dirname, '..', '..');
  return path.join(repoRoot, 'resources', CLOUDFLARED_DIR_NAME, platformDir, exe);
};

module.exports = { resolveCloudflaredPath, detectPackaged, CLOUDFLARED_DIR_NAME };
