#!/usr/bin/env node
/**
 * 准备内置 nginx 二进制到 resources/nginx/<platform>/
 * - Windows：下载 nginx.org 官方 zip 并解压
 * - macOS：从 Homebrew 复制二进制，并收集它依赖的非系统 dylib
 * 本地开发与 CI 共用本脚本。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const VERSION = process.env.NGINX_VERSION || '1.27.3';
const ROOT = path.join(__dirname, '..');
const OUT_ROOT = path.join(ROOT, 'resources', 'nginx');

const log = (message) => console.log('[nginx:fetch] ' + message);

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

const fetchWindows = async () => {
  const outDir = path.join(OUT_ROOT, 'win32');
  fs.mkdirSync(outDir, { recursive: true });
  const zipPath = path.join(os.tmpdir(), 'nginx-' + VERSION + '-win.zip');
  const url = 'https://nginx.org/download/nginx-' + VERSION + '.zip';
  log('下载 ' + url);
  await download(url, zipPath);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nginx-win-'));
  // Windows 与 macOS 自带的 bsdtar 都能解 zip，避免依赖 unzip
  execFileSync('tar', ['-xf', zipPath, '-C', tmpDir], { stdio: 'inherit' });
  const extracted = path.join(tmpDir, 'nginx-' + VERSION);
  for (const name of ['nginx.exe', 'conf', 'html', 'logs', 'temp']) {
    const from = path.join(extracted, name);
    if (!fs.existsSync(from)) continue;
    fs.cpSync(from, path.join(outDir, name), { recursive: true });
  }
  log('完成 -> ' + outDir);
};

const fetchMac = () => {
  const outDir = path.join(OUT_ROOT, 'darwin');
  const libDir = path.join(outDir, 'lib');
  fs.mkdirSync(libDir, { recursive: true });

  // 注意：brew --prefix nginx 在「未安装」时同样会返回路径且退出码为 0，
  // 因此必须校验二进制本身是否存在，不能只看 brew 的返回
  let prefix = '';
  try {
    prefix = execFileSync('brew', ['--prefix', 'nginx'], { encoding: 'utf8' }).trim();
  } catch (error) {
    prefix = '';
  }

  const binary = prefix ? path.join(prefix, 'bin', 'nginx') : '';
  if (!binary || !fs.existsSync(binary)) {
    throw new Error(
      '本机没有可用的 Homebrew nginx（' + (binary || 'brew 未安装') + '）。\n' +
      '请先执行：brew install nginx\n' +
      '然后重新运行：npm run nginx:fetch'
    );
  }

  fs.copyFileSync(binary, path.join(outDir, 'nginx'));
  fs.chmodSync(path.join(outDir, 'nginx'), 0o755);
  log('复制二进制 ' + binary);

  // 收集非系统依赖（pcre2 / openssl 等）
  const otool = execFileSync('otool', ['-L', binary], { encoding: 'utf8' });
  const deps = otool
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(' ')[0])
    .filter((dep) => dep && !dep.startsWith('/usr/lib/') && !dep.startsWith('/System/'));

  for (const dep of deps) {
    const target = path.join(libDir, path.basename(dep));
    if (!fs.existsSync(target)) fs.copyFileSync(dep, target);
    log('收集依赖 ' + path.basename(dep));
  }

  log('完成 -> ' + outDir);
  log('运行时需设置 DYLD_LIBRARY_PATH=' + libDir);
};

const main = async () => {
  if (process.platform === 'win32') {
    await fetchWindows();
    return;
  }
  if (process.platform === 'darwin') {
    fetchMac();
    return;
  }
  log('当前平台 ' + process.platform + ' 暂不支持，跳过');
};

main().catch((error) => {
  console.error('[nginx:fetch] 失败：' + error.message);
  process.exitCode = 1;
});
