const os = require('os');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn } = require('child_process');

const nodeVersions = require('../../utils/nodeVersions');

const MANAGED_DIR = path.join(os.homedir(), '.devdock', 'node');
const TMP_DIR = path.join(MANAGED_DIR, '.tmp');
const INDEX_URLS = ['https://npmmirror.com/mirrors/node/index.json', 'https://nodejs.org/dist/index.json'];
const DOWNLOAD_BASES = ['https://npmmirror.com/mirrors/node', 'https://nodejs.org/dist'];

const normalizeVersion = (value) => String(value || '').trim().replace(/^v/, '');

const platformTag = () => {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  if (process.platform === 'darwin') return `darwin-${arch}`;
  if (process.platform === 'win32') return `win-${arch}`;
  return `linux-${arch}`;
};

const archiveName = (version) => {
  const ext = process.platform === 'win32' ? 'zip' : 'tar.gz';
  return `node-v${version}-${platformTag()}.${ext}`;
};

const extractedDirName = (version) => `node-v${version}-${platformTag()}`;

const getManagedDir = () => MANAGED_DIR;

// 跟随重定向的 GET，返回响应流
const openStream = (url, redirects = 0) => new Promise((resolve, reject) => {
  if (redirects > 5) {
    reject(new Error('下载重定向次数过多'));
    return;
  }
  const req = https.get(url, { timeout: 30000 }, (response) => {
    const status = response.statusCode || 0;
    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume();
      resolve(openStream(new URL(response.headers.location, url).toString(), redirects + 1));
      return;
    }
    if (status !== 200) {
      response.resume();
      reject(new Error(`下载失败 HTTP ${status}`));
      return;
    }
    resolve(response);
  });
  req.on('timeout', () => req.destroy(new Error('下载超时')));
  req.on('error', reject);
});

const readJson = async (url) => {
  const stream = await openStream(url);
  return new Promise((resolve, reject) => {
    let raw = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => { raw += chunk; });
    stream.on('end', () => {
      try { resolve(JSON.parse(raw)); } catch (error) { reject(new Error('版本索引解析失败')); }
    });
    stream.on('error', reject);
  });
};

// 可用版本列表：只保留正式版
const listAvailable = async () => {
  let lastError = null;
  for (const url of INDEX_URLS) {
    try {
      const list = await readJson(url);
      if (!Array.isArray(list)) continue;
      return list
        .map((item) => ({
          version: normalizeVersion(item.version),
          lts: typeof item.lts === 'string' ? item.lts : '',
          date: item.date || '',
        }))
        .filter((item) => item.version && !item.version.includes('-'));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('无法获取 Node 版本列表');
};

const readManagedVersions = () => {
  if (!fs.existsSync(MANAGED_DIR)) return [];
  try {
    return fs.readdirSync(MANAGED_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('v'))
      .map((entry) => normalizeVersion(entry.name))
      .filter((version) => Boolean(nodeVersions.getVersionDir(version)));
  } catch (error) {
    return [];
  }
};

// 已安装版本，标记来源与是否可删除
const listInstalled = () => {
  const managed = new Set(readManagedVersions());
  return nodeVersions.getInstalledVersions().map((version) => ({
    version,
    source: managed.has(version) ? 'managed' : 'nvm',
    removable: managed.has(version),
  }));
};

const downloadArchive = (url, targetFile, onProgress) => new Promise(async (resolve, reject) => {
  let stream;
  try {
    stream = await openStream(url);
  } catch (error) {
    reject(error);
    return;
  }

  const total = Number(stream.headers['content-length'] || 0);
  let downloaded = 0;
  const file = fs.createWriteStream(targetFile);

  stream.on('data', (chunk) => {
    downloaded += chunk.length;
    if (onProgress) {
      onProgress({
        downloaded,
        total,
        percent: total ? Math.min(100, Math.round((downloaded / total) * 100)) : 0,
      });
    }
  });
  stream.on('error', (error) => { file.destroy(); reject(error); });
  file.on('error', reject);
  file.on('finish', () => resolve());
  stream.pipe(file);
});

const extractArchive = (archivePath, destination) => new Promise((resolve, reject) => {
  const isZip = archivePath.endsWith('.zip');
  const command = isZip ? 'powershell' : 'tar';
  const args = isZip
    ? ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${archivePath}' -DestinationPath '${destination}' -Force`]
    : ['-xzf', archivePath, '-C', destination];

  const child = spawn(command, args, { stdio: 'pipe' });
  let stderr = '';
  child.stderr.on('data', (data) => { stderr += data.toString(); });
  child.on('error', reject);
  child.on('close', (code) => {
    if (code === 0) resolve();
    else reject(new Error(stderr.trim() || `解压失败（退出码 ${code}）`));
  });
});

const install = async (rawVersion, onProgress) => {
  const version = normalizeVersion(rawVersion);
  if (!version) throw Object.assign(new Error('版本号不能为空'), { code: 'INVALID_VERSION' });

  const targetDir = path.join(MANAGED_DIR, `v${version}`);
  if (fs.existsSync(targetDir)) {
    throw Object.assign(new Error(`Node v${version} 已安装`), { code: 'ALREADY_INSTALLED' });
  }

  fs.mkdirSync(TMP_DIR, { recursive: true });
  const archivePath = path.join(TMP_DIR, archiveName(version));

  let lastError = null;
  let downloaded = false;
  for (const base of DOWNLOAD_BASES) {
    const url = `${base}/v${version}/${archiveName(version)}`;
    try {
      await downloadArchive(url, archivePath, onProgress);
      downloaded = true;
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!downloaded) {
    fs.rmSync(archivePath, { force: true });
    throw lastError || new Error('下载失败');
  }

  const extractRoot = fs.mkdtempSync(path.join(TMP_DIR, 'extract-'));
  try {
    await extractArchive(archivePath, extractRoot);
    const extracted = path.join(extractRoot, extractedDirName(version));
    if (!fs.existsSync(extracted)) throw new Error('解压后未找到版本目录');
    fs.mkdirSync(MANAGED_DIR, { recursive: true });
    fs.renameSync(extracted, targetDir);
  } finally {
    fs.rmSync(extractRoot, { recursive: true, force: true });
    fs.rmSync(archivePath, { force: true });
  }

  if (!nodeVersions.getVersionDir(version)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
    throw new Error('安装后未找到 node 可执行文件');
  }

  return { version, path: targetDir };
};

const remove = (rawVersion) => {
  const version = normalizeVersion(rawVersion);
  const targetDir = path.join(MANAGED_DIR, `v${version}`);
  const managed = readManagedVersions();
  if (!managed.includes(version)) {
    throw Object.assign(new Error('只能删除由本应用安装的版本'), { code: 'NOT_MANAGED' });
  }
  fs.rmSync(targetDir, { recursive: true, force: true });
  return { version };
};

module.exports = {
  getManagedDir,
  normalizeVersion,
  platformTag,
  archiveName,
  listAvailable,
  listInstalled,
  install,
  remove,
};
