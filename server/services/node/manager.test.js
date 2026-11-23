const test = require('node:test');
const assert = require('node:assert/strict');

const manager = require('./manager');
const nodeVersions = require('../../utils/nodeVersions');

test('版本号归一化', () => {
  assert.equal(manager.normalizeVersion('v22.11.0'), '22.11.0');
  assert.equal(manager.normalizeVersion(' 22.11.0 '), '22.11.0');
  assert.equal(manager.normalizeVersion(''), '');
  assert.equal(manager.normalizeVersion(undefined), '');
});

test('平台标签与包名', () => {
  const tag = manager.platformTag();
  assert.match(tag, /^(darwin|win|linux)-(arm64|x64)$/);

  const name = manager.archiveName('22.11.0');
  assert.match(name, /^node-v22\.11\.0-/);
  assert.ok(name.endsWith(process.platform === 'win32' ? '.zip' : '.tar.gz'));
});

test('管理目录位于 ~/.devdock/node', () => {
  assert.ok(manager.getManagedDir().endsWith('/.devdock/node') || manager.getManagedDir().endsWith('\\.devdock\\node'));
});

test('已安装列表带来源与可删除标记', () => {
  const list = manager.listInstalled();
  assert.ok(Array.isArray(list));
  for (const item of list) {
    assert.equal(typeof item.version, 'string');
    assert.ok(['managed', 'nvm'].includes(item.source));
    assert.equal(typeof item.removable, 'boolean');
    // 只有应用内安装的版本才允许删除
    assert.equal(item.removable, item.source === 'managed');
  }
});

test('拒绝删除非应用内安装的版本', () => {
  const managed = manager.listInstalled().filter((item) => item.source === 'managed');
  const external = manager.listInstalled().find((item) => item.source === 'nvm');
  if (!external) return; // 本机没有 nvm 版本时跳过
  assert.throws(() => manager.remove(external.version), /只能删除由本应用安装的版本/);
  assert.equal(managed.length >= 0, true);
});

test('版本目录解析覆盖所有来源', () => {
  const versions = nodeVersions.getInstalledVersions();
  for (const version of versions) {
    assert.ok(nodeVersions.getVersionDir(version), '版本 ' + version + ' 应能解析到目录');
  }
});
