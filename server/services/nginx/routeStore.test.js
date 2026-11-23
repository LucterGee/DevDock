const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createNginxStore, createDefaultState, HEADER_MARK } = require('./routeStore');

const makeStore = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devdock-nginx-'));
  const routesDir = path.join(root, 'routes');
  const statePath = path.join(root, 'state.json');
  fs.mkdirSync(routesDir, { recursive: true });
  return { root, routesDir, statePath, store: createNginxStore({ statePath, routesDir }) };
};

const makeRoute = (id, overrides = {}) => ({
  id,
  path: '/' + id,
  note: '',
  enabled: true,
  kind: 'proxy',
  activeTargetId: 'default',
  targets: [{ id: 'default', label: 'local', proxyPass: 'http://127.0.0.1:8080', referer: '' }],
  headers: { httpVersion: true, host: false, upgrade: false, connection: false },
  others: [],
  rawBody: '',
  managed: true,
  ...overrides,
});

test('默认状态包含完整的 nginx 配置项', () => {
  const state = createDefaultState();
  assert.equal(state.version, 1);
  assert.equal(state.nginx.port, 18080);
  assert.ok(state.nginx.prefixDir.endsWith(path.join('.devdock', 'nginx')));
  assert.equal(state.nginx.onConflict, 'ask');
  assert.equal(state.nginx.accessLog.enabled, false);
  assert.deepEqual(state.routes, []);
});

test('写入路由会带上生成标记与哈希', () => {
  const { store, routesDir } = makeStore();
  store.writeRoute(makeRoute('alpha'));
  const file = path.join(routesDir, 'alpha.conf');
  assert.equal(fs.existsSync(file), true);
  const content = fs.readFileSync(file, 'utf8');
  assert.ok(content.startsWith(HEADER_MARK));
  assert.match(content, /# id: alpha/);
  assert.match(content, /# hash: [0-9a-f]{64}/);
  assert.match(content, /location \/alpha \{/);
});

test('scan 区分托管文件与未托管文件', () => {
  const { store, routesDir } = makeStore();
  store.writeRoute(makeRoute('alpha'));
  fs.writeFileSync(path.join(routesDir, 'my-own.conf'), 'location /mine { return 200; }\n');

  const result = store.scan();
  assert.equal(result.managed.length, 1);
  assert.equal(result.managed[0].id, 'alpha');
  assert.equal(result.untracked.length, 1);
  assert.equal(result.untracked[0].name, 'my-own.conf');
  assert.equal(result.edited.length, 0);
});

test('手工改过的文件会被识别为 edited', () => {
  const { store, routesDir } = makeStore();
  store.writeRoute(makeRoute('alpha'));
  const file = path.join(routesDir, 'alpha.conf');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8') + '\n# 手工加的一行\n');

  const result = store.scan();
  assert.equal(result.edited.length, 1);
  assert.equal(result.edited[0].id, 'alpha');
});

test('sync 默认跳过被手工改过的文件，force 后覆盖', () => {
  const { store, routesDir } = makeStore();
  const route = makeRoute('alpha');
  store.writeRoute(route);
  const file = path.join(routesDir, 'alpha.conf');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8') + '\n# 手工修改\n');

  const state = { ...createDefaultState(), routes: [route] };
  const first = store.sync(state);
  assert.equal(first.skipped.length, 1);
  assert.equal(first.skipped[0].reason, 'edited');

  const second = store.sync(state, { force: ['alpha'] });
  assert.equal(second.written.length, 1);
  assert.equal(second.skipped.length, 0);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /手工修改/);
});

test('sync 不触碰未托管文件', () => {
  const { store, routesDir } = makeStore();
  const own = path.join(routesDir, 'my-own.conf');
  fs.writeFileSync(own, 'location /mine { return 200; }\n');

  store.sync({ ...createDefaultState(), routes: [makeRoute('alpha')] });
  assert.equal(fs.readFileSync(own, 'utf8'), 'location /mine { return 200; }\n');
});

test('sync 删除已移除路由对应的托管文件', () => {
  const { store, routesDir } = makeStore();
  const alpha = makeRoute('alpha');
  const beta = makeRoute('beta');
  store.sync({ ...createDefaultState(), routes: [alpha, beta] });
  assert.equal(fs.existsSync(path.join(routesDir, 'alpha.conf')), true);
  assert.equal(fs.existsSync(path.join(routesDir, 'beta.conf')), true);

  store.sync({ ...createDefaultState(), routes: [alpha] });
  assert.equal(fs.existsSync(path.join(routesDir, 'alpha.conf')), true);
  assert.equal(fs.existsSync(path.join(routesDir, 'beta.conf')), false);
});

test('状态读写保留默认值并合并自定义项', () => {
  const { store, statePath } = makeStore();
  const state = store.load();
  state.nginx.port = 18099;
  state.routes = [makeRoute('alpha')];
  store.save(state);

  const reloaded = createNginxStore({ statePath, routesDir: store.routesDir }).load();
  assert.equal(reloaded.nginx.port, 18099);
  assert.equal(reloaded.nginx.backupLimit, 10);
  assert.equal(reloaded.routes.length, 1);
});

test('切换目标后 sync 会把新目标写进文件', () => {
  const { store, routesDir } = makeStore();
  const route = makeRoute('alpha');
  route.targets.push({ id: 'alt', label: 'alt', proxyPass: 'http://127.0.0.1:9090', referer: 'https://alt.example.com' });
  store.writeRoute(route);

  route.activeTargetId = 'alt';
  store.sync({ ...createDefaultState(), routes: [route] }, { force: ['alpha'] });

  const content = fs.readFileSync(path.join(routesDir, 'alpha.conf'), 'utf8');
  assert.match(content, /proxy_pass http:\/\/127\.0\.0\.1:9090/);
  assert.match(content, /Referer "https:\/\/alt\.example\.com"/);
});
