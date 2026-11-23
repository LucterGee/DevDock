const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getWechatLaunchCandidates,
  getWechatLaunchSpec,
  resolveWechatLaunchSpec,
  resolveWechatCliPath,
  normalizeWechatDevtoolsConfig,
  getWechatCliCandidates,
} = require('./projectTools');

test('normalizeWechatDevtoolsConfig 读取单一路径并兼容旧字段', () => {
  assert.deepEqual(
    normalizeWechatDevtoolsConfig({ path: '  /Applications/wechatwebdevtools.app  ' }),
    { path: '/Applications/wechatwebdevtools.app' }
  );
  // 旧配置里按系统拆分的字段读一次兼容
  assert.deepEqual(
    normalizeWechatDevtoolsConfig({ macosPath: '  /Applications/wechatwebdevtools.app  ' }),
    { path: '/Applications/wechatwebdevtools.app' }
  );
  assert.deepEqual(
    normalizeWechatDevtoolsConfig({ windowsPath: ' C:\\WeChat\\cli.bat ' }),
    { path: 'C:\\WeChat\\cli.bat' }
  );
  assert.deepEqual(normalizeWechatDevtoolsConfig({}), { path: '' });
});

test('getWechatCliCandidates derives cli.bat from a Windows install directory', () => {
  const candidates = getWechatCliCandidates('C:\\Program Files\\WeChatDevTools', 'win32');

  assert.deepEqual(candidates, [
    'C:\\Program Files\\WeChatDevTools\\cli.bat',
  ]);
});

test('getWechatCliCandidates prefers cli.bat sibling when given a Windows exe path', () => {
  const candidates = getWechatCliCandidates(
    'C:\\Program Files\\WeChatDevTools\\微信开发者工具.exe',
    'win32'
  );

  assert.deepEqual(candidates, [
    'C:\\Program Files\\WeChatDevTools\\cli.bat',
    'C:\\Program Files\\WeChatDevTools\\微信开发者工具.exe',
  ]);
});

test('getWechatCliCandidates supports app bundle and legacy cli locations on macOS', () => {
  const candidates = getWechatCliCandidates(
    '/Applications/wechatwebdevtools.app',
    'darwin'
  );

  assert.deepEqual(candidates, [
    '/Applications/wechatwebdevtools.app/Contents/MacOS/cli',
    '/Applications/wechatwebdevtools.app/Contents/Resources/app.nw/bin/cli',
  ]);
});

test('getWechatLaunchCandidates prefers launching the Windows app directly from an install directory', () => {
  const candidates = getWechatLaunchCandidates('C:\\Program Files\\WeChatDevTools', 'win32');

  assert.deepEqual(candidates, [
    'C:\\Program Files\\WeChatDevTools\\微信开发者工具.exe',
    'C:\\Program Files\\WeChatDevTools\\cli.bat',
  ]);
});

test('getWechatLaunchSpec uses open for macOS app bundles', () => {
  const spec = getWechatLaunchSpec('/Applications/wechatwebdevtools.app', 'darwin');

  assert.deepEqual(spec, {
    command: 'open',
    args: ['/Applications/wechatwebdevtools.app'],
  });
});

test('getWechatLaunchSpec wraps Windows bat launch in hidden cmd invocation', () => {
  const spec = getWechatLaunchSpec('C:\\Program Files\\WeChatDevTools\\cli.bat', 'win32');

  assert.deepEqual(spec, {
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', '"C:\\Program Files\\WeChatDevTools\\cli.bat"'],
  });
});

test('resolveWechatLaunchSpec picks an existing Windows exe target', () => {
  const result = resolveWechatLaunchSpec(
    { windowsPath: 'C:\\Program Files\\WeChatDevTools' },
    'win32',
    (candidate) => candidate.endsWith('微信开发者工具.exe')
  );

  assert.equal(result.success, true);
  assert.deepEqual(result.launchSpec, {
    command: 'C:\\Program Files\\WeChatDevTools\\微信开发者工具.exe',
    args: [],
  });
});

test('resolveWechatLaunchSpec reports missing configured tool path clearly', () => {
  const result = resolveWechatLaunchSpec({}, 'win32');

  assert.deepEqual(result, {
    success: false,
    error: '请先在设置中配置微信开发者工具路径',
    launchSpec: null,
    configuredPath: '',
    candidates: [],
  });
});
