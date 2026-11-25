#!/usr/bin/env node
/**
 * 准备内置 cloudflared 二进制到 resources/cloudflared/<platform>/
 * 从 Cloudflare 官方 GitHub Release 下载对应平台产物：
 * - macOS 是 .tgz，解压后取其中的 cloudflared
 * - Windows / Linux 是单文件
 * 本地开发与 CI 共用本脚本。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT_ROOT = path.join(ROOT, 'resources', 'cloudflared');
const BASE_URL = 'https://github.com/cloudflare/cloudflared/releases/latest/download';

const log = (message) => console.log('[cloudflared:fetch] ' + message);

const download = (url, dest) => new Promise((resolve, reject) => {
  const follow = (target) => {
    https.get(target, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        follow(res.headers.location);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error('下载失败 ' + target + ' -> HTTP ' + res.statusCode));
        return;
      }
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
      file.on('error', reject);
    }).on('error', reject);
  };
  follow(url);
});

const platformDir = (platform) => (platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux');

const assetName = (platform, arch) => {
  if (platform === 'darwin') return 'cloudflared-darwin-' + (arch === 'arm64' ? 'arm64' : 'amd64') + '.tgz';
  if (platform === 'win32') return 'cloudflared-windows-amd64.exe';
  return 'cloudflared-linux-' + (arch === 'arm64' ? 'arm64' : 'amd64');
};

const main = async () => {
  const platform = process.platform;
  const arch = process.arch;
  const outDir = path.join(OUT_ROOT, platformDir(platform));
  fs.mkdirSync(outDir, { recursive: true });

  const asset = assetName(platform, arch);
  const url = BASE_URL + '/' + asset;
  const tmpFile = path.join(os.tmpdir(), asset);
  log('下载 ' + url);
  await download(url, tmpFile);

  const exeName = platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const target = path.join(outDir, exeName);

  if (asset.endsWith('.tgz')) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudflared-'));
    execFileSync('tar', ['-xzf', tmpFile, '-C', tmpDir], { stdio: 'inherit' });
    const extracted = path.join(tmpDir, 'cloudflared');
    if (!fs.existsSync(extracted)) throw new Error('压缩包内未找到 cloudflared');
    fs.copyFileSync(extracted, target);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } else {
    fs.copyFileSync(tmpFile, target);
  }

  fs.chmodSync(target, 0o755);
  fs.rmSync(tmpFile, { force: true });

  const version = execFileSync(target, ['--version'], { encoding: 'utf8' }).trim();
  log('完成 -> ' + target);
  log(version);
};

main().catch((error) => {
  console.error('[cloudflared:fetch] 失败：' + error.message);
  process.exit(1);
});
