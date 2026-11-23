const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createNginxRuntime } = require('./runtime');
const { createNginxStore } = require('./routeStore');
const { EXPORT_FORMAT, EXPORT_VERSION } = require('./runtime');

const SEED = [
  { path: "/teacher", note: "信科官网首页", targets: [{ id: "t1", label: "local", proxyPass: "http://127.0.0.1:4567", referer: "" }], headers: { httpVersion: true, host: true, upgrade: true, connection: true }, others: [] },
  { path: "/api/", note: "", targets: [{ id: "t1", label: "remote", proxyPass: "https://a.example.com/api/", referer: "https://a.example.com/" }], headers: { httpVersion: true, host: false, upgrade: true, connection: true }, others: [] },
];

const seed = (runtime, routes = SEED) => runtime.importPayload({ format: EXPORT_FORMAT, version: EXPORT_VERSION, routes, variables: [] });

const FIXTURE = [
  'http {',
  '  server {',
  '    listen 18080;',
  '    # 信科官网首页',
  '    location /teacher {',
  '      proxy_pass http://host.docker.internal:4567;',
  '      proxy_http_version 1.1;',
  '      proxy_set_header Host $host;',
  '    }',
  '    location /api/ {',
  '      # proxy_pass https://xk.epubedu.com/api/;',
  '      proxy_pass https://aiedu.epubedu.com/api/;',
  '    }',
  '  }',
  '}',
].join('\n');

const setup = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devdock-rt-'));
  const routesDir = path.join(root, 'routes');
  fs.mkdirSync(routesDir, { recursive: true });
  const store = createNginxStore({ statePath: path.join(root, 'state.json'), routesDir });
  const state = store.load();
  state.nginx.routesDir = routesDir;
  state.nginx.prefixDir = root;
  store.save(state);

  const calls = [];
  const controller = {
    status: () => ({ installed: true, running: false, pid: 0, port: state.nginx.port }),
    writeConfig: () => {
      calls.push('writeConfig');
      const confPath = path.join(root, 'nginx.conf');
      fs.writeFileSync(confPath, 'generated');
      return { confPath };
    },
    test: async () => { calls.push('test'); return { ok: true }; },
    reload: async () => { calls.push('reload'); return { ok: true }; },
    start: async () => { calls.push('start'); return { ok: true }; },
    stop: async () => { calls.push('stop'); return { ok: true }; },
  };

  return { root, routesDir, store, controller, calls, runtime: createNginxRuntime({ store, controller }) };
};

test('overview 返回排序后的路由与状态', () => {
  const { runtime } = setup();
  seed(runtime);
  const view = runtime.overview();
  assert.equal(view.routes.length, 2);
  assert.deepEqual(view.routes.map((r) => r.path), ['/api/', '/teacher']);
  assert.equal(view.status.installed, true);
  assert.deepEqual(view.conflicts, []);
});



test('开关与目标切换写入状态', () => {
  const { runtime } = setup();
  seed(runtime);
  const id = runtime.overview().routes[0].id;

  runtime.setEnabled(id, false);
  assert.equal(runtime.overview().routes.find((r) => r.id === id).enabled, false);

  runtime.addTarget(id, { label: '同事联调', proxyPass: 'http://192.168.1.5:8107', referer: '' });
  const withTarget = runtime.overview().routes.find((r) => r.id === id);
  assert.equal(withTarget.targets.length, 2);

  const newTargetId = withTarget.targets[1].id;
  runtime.setActiveTarget(id, newTargetId);
  assert.equal(runtime.overview().routes.find((r) => r.id === id).activeTargetId, newTargetId);

  runtime.removeTarget(id, newTargetId);
  const afterRemove = runtime.overview().routes.find((r) => r.id === id);
  assert.equal(afterRemove.targets.length, 1);
  assert.notEqual(afterRemove.activeTargetId, newTargetId);
});

test('apply 写配置并同步路由文件，停用的路由不落盘', () => {
  const { runtime, routesDir, calls } = setup();
  seed(runtime);
  const routes = runtime.overview().routes;
  runtime.setEnabled(routes[0].id, false);

  const result = runtime.apply();
  assert.equal(calls.includes('writeConfig'), true);
  assert.equal(result.written.length, 1);
  const files = fs.readdirSync(routesDir).filter((name) => name.endsWith('.conf'));
  assert.equal(files.length, 1);
});

test('removeRoute 删除路由', () => {
  const { runtime } = setup();
  seed(runtime);
  const id = runtime.overview().routes[0].id;
  runtime.removeRoute(id);
  assert.equal(runtime.overview().routes.length, 1);
});

test('冲突文件在 overview 中暴露，overwrite 可覆盖', () => {
  const { runtime, routesDir } = setup();
  seed(runtime);
  runtime.apply();
  const routes = runtime.overview().routes;
  const file = path.join(routesDir, routes[0].id + '.conf');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8') + '\n# 手工修改\n');

  const view = runtime.overview();
  assert.equal(view.conflicts.length, 1);

  runtime.resolveConflict(routes[0].id, 'overwrite');
  assert.equal(runtime.overview().conflicts.length, 0);
});

test('restart 先停后启', async () => {
  const { runtime, calls } = setup();
  await runtime.restart();
  assert.deepEqual(calls.filter((c) => c === 'stop' || c === 'start'), ['stop', 'start']);
});
