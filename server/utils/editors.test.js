const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EDITOR_OPTIONS,
  normalizeEditorConfig,
  resolveEditorLaunch,
  describeLaunchError,
} = require('./editors');

test('默认编辑器为 VS Code', () => {
  assert.deepEqual(normalizeEditorConfig(undefined), { editorId: 'vscode' });
  assert.deepEqual(normalizeEditorConfig({}), { editorId: 'vscode' });
  assert.deepEqual(normalizeEditorConfig({ editorId: 'unknown' }), { editorId: 'vscode' });
});

test('接受已支持的编辑器', () => {
  assert.deepEqual(normalizeEditorConfig({ editorId: 'system' }), { editorId: 'system' });
  assert.equal(EDITOR_OPTIONS.length, 2);
});

test('macOS 用 open -a 打开 VS Code，不依赖 PATH', () => {
  const spec = resolveEditorLaunch('vscode', '/repo', 'darwin');
  assert.equal(spec.command, 'open');
  assert.deepEqual(spec.args, ['-a', 'Visual Studio Code', '/repo']);
});

test('系统默认在各平台使用对应命令', () => {
  assert.equal(resolveEditorLaunch('system', '/repo', 'darwin').command, 'open');
  assert.equal(resolveEditorLaunch('system', '/repo', 'win32').command, 'explorer');
  assert.equal(resolveEditorLaunch('system', '/repo', 'linux').command, 'xdg-open');
});

test('Windows 使用 code.cmd，Linux 使用 code', () => {
  assert.equal(resolveEditorLaunch('vscode', 'C:/repo', 'win32').command, 'code.cmd');
  assert.equal(resolveEditorLaunch('vscode', '/repo', 'linux').command, 'code');
});

test('路径为空时返回 null', () => {
  assert.equal(resolveEditorLaunch('vscode', '', 'darwin'), null);
});

test('启动失败时给出可操作的提示', () => {
  const enoent = Object.assign(new Error('spawn code ENOENT'), { code: 'ENOENT' });
  assert.match(describeLaunchError(enoent, '', { command: 'code' }), /Shell Command/);
  assert.match(describeLaunchError(enoent, '', { command: 'open' }), /Visual Studio Code/);
  assert.equal(describeLaunchError(new Error('x'), 'Unable to find application', null), 'Unable to find application');
});
