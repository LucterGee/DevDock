const test = require('node:test');
const assert = require('node:assert/strict');

const {
  EDITOR_OPTIONS,
  normalizeEditorConfig,
  resolveEditorLaunch,
  describeLaunchError,
} = require('./editors');

test('默认编辑器为 VS Code', () => {
  assert.deepEqual(normalizeEditorConfig(undefined), { preset: 'vscode', customCommand: '' });
  assert.deepEqual(normalizeEditorConfig({}), { preset: 'vscode', customCommand: '' });
  assert.deepEqual(normalizeEditorConfig({ preset: 'unknown' }), { preset: 'vscode', customCommand: '' });
});

test('兼容早期的 editorId 字段', () => {
  assert.deepEqual(normalizeEditorConfig({ editorId: 'system' }), { preset: 'system', customCommand: '' });
});

test('保留自定义命令并去空格', () => {
  assert.deepEqual(normalizeEditorConfig({ preset: 'custom', customCommand: '  zed  ' }), {
    preset: 'custom',
    customCommand: 'zed',
  });
});

test('内置选项包含自定义入口', () => {
  assert.deepEqual(EDITOR_OPTIONS.map((item) => item.id), ['vscode', 'system', 'custom']);
});

test('macOS 用 open -a 打开 VS Code，不依赖 PATH', () => {
  const spec = resolveEditorLaunch({ preset: 'vscode' }, '/repo', 'darwin');
  assert.equal(spec.command, 'open');
  assert.deepEqual(spec.args, ['-a', 'Visual Studio Code', '/repo']);
});

test('系统默认在各平台使用对应命令', () => {
  assert.equal(resolveEditorLaunch({ preset: 'system' }, '/repo', 'darwin').command, 'open');
  assert.equal(resolveEditorLaunch({ preset: 'system' }, '/repo', 'win32').command, 'explorer');
  assert.equal(resolveEditorLaunch({ preset: 'system' }, '/repo', 'linux').command, 'xdg-open');
});

test('Windows 使用 code.cmd，Linux 使用 code', () => {
  assert.equal(resolveEditorLaunch({ preset: 'vscode' }, 'C:/repo', 'win32').command, 'code.cmd');
  assert.equal(resolveEditorLaunch({ preset: 'vscode' }, '/repo', 'linux').command, 'code');
});

test('自定义命令直接作为可执行文件', () => {
  const spec = resolveEditorLaunch({ preset: 'custom', customCommand: 'zed' }, '/repo', 'darwin');
  assert.equal(spec.command, 'zed');
  assert.deepEqual(spec.args, ['/repo']);
});

test('自定义 .app 路径在 macOS 走 open -a', () => {
  const spec = resolveEditorLaunch({ preset: 'custom', customCommand: '/Applications/Zed.app' }, '/repo', 'darwin');
  assert.equal(spec.command, 'open');
  assert.deepEqual(spec.args, ['-a', '/Applications/Zed.app', '/repo']);
});

test('自定义但未填命令时返回 null', () => {
  assert.equal(resolveEditorLaunch({ preset: 'custom', customCommand: '' }, '/repo', 'darwin'), null);
});

test('路径为空时返回 null', () => {
  assert.equal(resolveEditorLaunch({ preset: 'vscode' }, '', 'darwin'), null);
});

test('启动失败时给出可操作的提示', () => {
  const enoent = Object.assign(new Error('spawn code ENOENT'), { code: 'ENOENT' });
  assert.match(describeLaunchError(enoent, '', { command: 'code' }, { preset: 'vscode' }), /Shell Command/);
  assert.match(describeLaunchError(enoent, '', { command: 'open' }, { preset: 'vscode' }), /未找到指定的编辑器/);
  assert.match(describeLaunchError(enoent, '', null, { preset: 'custom', customCommand: '' }), /自定义编辑器/);
  assert.equal(
    describeLaunchError(new Error('x'), 'Unable to find application', null, { preset: 'vscode' }),
    'Unable to find application'
  );
});
