const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { discoverAuthors } = require('./gitActivity');

// 建一个未配置 user.name / user.email 的仓库，提交时用 -c 临时指定作者
const makeRepoWithoutConfig = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devdock-authors-'));
  const run = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  run(['init', '-q']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  run(['add', '.']);
  run([
    '-c', 'user.name=测试作者',
    '-c', 'user.email=author@example.com',
    'commit', '-q', '-m', 'init',
  ]);
  return dir;
};

test('未配置 user.name 时仍能从提交历史发现作者', async () => {
  const dir = makeRepoWithoutConfig();
  try {
    // 确认前提：该仓库确实没有配置 user.name
    let configFailed = false;
    try {
      execFileSync('git', ['config', '--get', 'user.name'], { cwd: dir, encoding: 'utf8' });
    } catch (error) {
      configFailed = true;
    }
    assert.equal(configFailed, true, '测试仓库不应配置 user.name');

    const authors = await discoverAuthors([{ path: dir }], { months: 12 });
    assert.equal(authors.length, 1);
    assert.equal(authors[0].name, '测试作者');
    assert.deepEqual(authors[0].emails, ['author@example.com']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('配置了 user.name 的仓库会作为候选出现', async () => {
  const dir = makeRepoWithoutConfig();
  try {
    execFileSync('git', ['config', 'user.name', '本地配置作者'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'local@example.com'], { cwd: dir });

    const authors = await discoverAuthors([{ path: dir }], { months: 12 });
    const names = authors.map((item) => item.name);
    assert.ok(names.includes('本地配置作者'));
    assert.ok(names.includes('测试作者'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('不可读的仓库被跳过，不影响其它仓库', async () => {
  const dir = makeRepoWithoutConfig();
  try {
    const authors = await discoverAuthors([
      { path: path.join(os.tmpdir(), 'devdock-does-not-exist') },
      { path: dir },
    ], { months: 12 });
    assert.equal(authors.length, 1);
    assert.equal(authors[0].name, '测试作者');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
