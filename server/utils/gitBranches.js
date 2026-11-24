const { execFile } = require('child_process');

const DEFAULT_TIMEOUT = 20000;
const FETCH_TIMEOUT = 15000;

const runGit = (cwd, args, timeout = DEFAULT_TIMEOUT) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd, timeout, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
    if (error) {
      reject(new Error(String(stderr || stdout || error.message || 'git 执行失败').trim()));
      return;
    }
    resolve(stdout);
  });
});

const splitLines = (text) => String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);

// 列出本地与远端分支；fetch 失败（没网、没权限）时沿用本地已知的远端引用
const listBranches = async (projectPath, { fetch = true } = {}) => {
  let fetchError = '';
  if (fetch) {
    try {
      await runGit(projectPath, ['fetch', '--prune', '--quiet'], FETCH_TIMEOUT);
    } catch (error) {
      fetchError = error.message;
    }
  }

  const current = (await runGit(projectPath, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const local = splitLines(await runGit(projectPath, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).sort();
  // 用 symref 过滤掉 origin/HEAD 这类符号引用
  const remoteRefs = splitLines(await runGit(projectPath, ['for-each-ref', '--format=%(refname:short)|%(symref)', 'refs/remotes']));
  const remote = remoteRefs
    .map((line) => line.split('|'))
    .filter(([, symref]) => !symref)
    .map(([name]) => name)
    .sort();

  return { current, local, remote, fetchError };
};

const assertBranchName = async (projectPath, name) => {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('分支名不能为空');
  // 交给 git 自己校验命名规则
  await runGit(projectPath, ['check-ref-format', '--branch', trimmed]);
  return trimmed;
};

// 切换分支；远端分支会在本地建同名分支并跟踪
const checkoutBranch = async (projectPath, branch, { isRemote = false } = {}) => {
  const name = String(branch || '').trim();
  if (!name) throw new Error('分支名不能为空');

  if (!isRemote) {
    await runGit(projectPath, ['checkout', name]);
    return name;
  }

  const local = name.includes('/') ? name.slice(name.indexOf('/') + 1) : name;
  const exists = splitLines(await runGit(projectPath, ['branch', '--list', local]));
  if (exists.length > 0) {
    await runGit(projectPath, ['checkout', local]);
    return local;
  }
  await runGit(projectPath, ['checkout', '-b', local, '--track', name]);
  return local;
};

// 基于当前分支创建并切换到新分支
const createBranch = async (projectPath, branch) => {
  const name = await assertBranchName(projectPath, branch);
  await runGit(projectPath, ['checkout', '-b', name]);
  return name;
};

module.exports = { listBranches, checkoutBranch, createBranch };
