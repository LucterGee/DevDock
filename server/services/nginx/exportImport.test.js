const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createNginxRuntime, EXPORT_FORMAT, EXPORT_VERSION } = require('./runtime');
const { createNginxStore } = require('./routeStore');

const SEED = [
  { path: "/teacher", note: "信科官网首页", targets: [{ id: "t1", label: "local", proxyPass: "http://127.0.0.1:4567", referer: "" }], headers: { httpVersion: true, host: true, upgrade: true, connection: true }, others: [] },
  { path: "/api/", note: "", targets: [{ id: "t1", label: "remote", proxyPass: "https://a.example.com/api/", referer: "https://a.example.com/" }], headers: { httpVersion: true, host: false, upgrade: true, connection: true }, others: [] },
];

const seed = (runtime, routes = SEED) => runtime.importPayload({ format: EXPORT_FORMAT, version: EXPORT_VERSION, routes, variables: [] });

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devdock-exp-'));
  const store = createNginxStore({ statePath: path.join(root, 'state.json'), routesDir: path.join(root, 'routes') });
  const runtime = createNginxRuntime({ store, controller: { status: () => ({}), writeConfig: () => ({}) } });
  return { root, store, runtime };
};

const CONF = [
  'http {',
  '  server {',
  '    listen 18080;',
  '    location /a {',
  '      proxy_pass http://127.0.0.1:1;',
  '    }',
  '    location /b/ {',
  '      proxy_pass http://127.0.0.1:2;',
  '    }',
  '  }',
  '}',
].join('\n');

const validPayload = () => ({
  format: EXPORT_FORMAT,
  version: EXPORT_VERSION,
  variables: [{ name: 'h', value: '127.0.0.1' }],
  routes: [{
    path: '/x/',
    note: '',
    enabled: true,
    kind: 'proxy',
    activeTargetId: 't1',
    targets: [{ id: 't1', label: 'l', proxyPass: 'http://127.0.0.1:9', referer: '' }],
    headers: { httpVersion: true, host: false, upgrade: false, connection: false },
    others: [],
  }],
});

test('导出带格式标识与版本号', () => {
  const { runtime } = setup();
  seed(runtime);
  const payload = runtime.exportPayload();
  assert.equal(payload.format, EXPORT_FORMAT);
  assert.equal(payload.version, EXPORT_VERSION);
  assert.equal(payload.routes.length, 2);
  assert.equal(typeof payload.exportedAt, 'string');
});

test('导出后再导入可完整还原', () => {
  const { runtime } = setup();
  seed(runtime);
  const snapshot = runtime.exportPayload();
  runtime.importPayload({ format: EXPORT_FORMAT, version: EXPORT_VERSION, routes: [], variables: [] });
  assert.equal(runtime.exportPayload().routes.length, 0);
  const result = runtime.importPayload(snapshot);
  assert.equal(result.ok, true);
  assert.equal(runtime.exportPayload().routes.length, 2);
});

test('导入覆盖现有路由而不是追加', () => {
  const { runtime } = setup();
  seed(runtime);
  runtime.importPayload(validPayload());
  const routes = runtime.exportPayload().routes;
  assert.equal(routes.length, 1);
  assert.equal(routes[0].path, '/x/');
});

test('缺少 id 的路由在导入时自动生成 id', () => {
  const { runtime } = setup();
  runtime.importPayload(validPayload());
  const route = runtime.exportPayload().routes[0];
  assert.ok(route.id);
  assert.equal(route.path, '/x/');
});

test('结构不符的文件被拒绝并给出原因', () => {
  const { runtime } = setup();
  const cases = [
    [{}, 'format'],
    [{ format: 'other', version: 1, routes: [] }, 'format'],
    [{ format: EXPORT_FORMAT, version: 99, routes: [] }, '版本'],
    [{ format: EXPORT_FORMAT, version: 1 }, 'routes'],
    [{ format: EXPORT_FORMAT, version: 1, routes: [{ path: '' }] }, 'path'],
    [{ format: EXPORT_FORMAT, version: 1, routes: [{ path: '/a' }] }, 'targets'],
    [{ format: EXPORT_FORMAT, version: 1, routes: [{ path: '/a', targets: [{}] }] }, 'proxyPass'],
  ];
  for (const [payload, keyword] of cases) {
    const result = runtime.importPayload(payload);
    assert.equal(result.ok, false, '应拒绝：' + JSON.stringify(payload).slice(0, 60));
    assert.match(result.error, new RegExp(keyword), '错误信息应包含 ' + keyword);
  }
});

test('被拒绝的导入不会改动现有路由', () => {
  const { runtime } = setup();
  seed(runtime);
  const before = runtime.exportPayload().routes.length;
  const result = runtime.importPayload({ format: 'bad' });
  assert.equal(result.ok, false);
  assert.equal(runtime.exportPayload().routes.length, before);
});

test('导入会同时覆盖变量表', () => {
  const { runtime } = setup();
  runtime.importPayload(validPayload());
  const payload = runtime.exportPayload();
  assert.deepEqual(payload.variables, [{ name: 'h', value: '127.0.0.1' }]);
});
