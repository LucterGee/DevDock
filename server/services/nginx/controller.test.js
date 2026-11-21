const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveBinaryPath, buildArgs, isProcessAlive } = require('./controller');
const { createNginxController } = require('./controller');
const { createNginxStore } = require('./routeStore');

test('打包态按平台解析随包二进制', () => {
  assert.equal(
    resolveBinaryPath({ resourcesPath: '/app/Resources', isPackaged: true, platform: 'darwin' }),
    '/app/Resources/nginx/darwin/nginx'
  );
  assert.equal(
    resolveBinaryPath({ resourcesPath: 'C:/app/Resources', isPackaged: true, platform: 'win32' }),
    path.join('C:/app/Resources', 'nginx', 'win32', 'nginx.exe')
  );
});

test('开发态指向仓库 resources 目录', () => {
  assert.equal(
    resolveBinaryPath({ repoRoot: '/repo', isPackaged: false, platform: 'darwin' }),
    '/repo/resources/nginx/darwin/nginx'
  );
});

test('各动作都用 -p/-c 固定前缀与配置', () => {
  const target = { prefixDir: '/p', confPath: '/p/nginx.conf' };
  assert.deepEqual(buildArgs({ ...target, action: 'test' }), ['-p', '/p', '-c', '/p/nginx.conf', '-t']);
  assert.deepEqual(buildArgs({ ...target, action: 'reload' }), ['-p', '/p', '-c', '/p/nginx.conf', '-s', 'reload']);
  assert.deepEqual(buildArgs({ ...target, action: 'stop' }), ['-p', '/p', '-c', '/p/nginx.conf', '-s', 'quit']);
  assert.deepEqual(buildArgs({ ...target, action: 'start' }), ['-p', '/p', '-c', '/p/nginx.conf']);
});

test('进程存活判断', () => {
  assert.equal(isProcessAlive(process.pid), true);
  assert.equal(isProcessAlive(0), false);
  assert.equal(isProcessAlive(999999), false);
});

test('未准备二进制时 status 报告 installed=false 且动作返回 BINARY_MISSING', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devdock-ctl-'));
  const store = createNginxStore({ statePath: path.join(root, 'state.json'), routesDir: path.join(root, 'routes') });
  const controller = createNginxController({
    store,
    repoRoot: path.join(root, 'repo'),
    isPackaged: false,
    platform: 'darwin',
  });

  const status = controller.status();
  assert.equal(status.installed, false);
  assert.equal(status.running, false);
  assert.equal(status.port, 18080);

  const result = await controller.test();
  assert.equal(result.ok, false);
  assert.equal(result.code, 'BINARY_MISSING');
});

test('writeConfig 会把生成的配置写进 prefix 目录', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devdock-ctl-'));
  const prefixDir = path.join(root, 'nginx');
  const store = createNginxStore({ statePath: path.join(root, 'state.json'), routesDir: path.join(prefixDir, 'routes') });
  const state = store.load();
  state.nginx.prefixDir = prefixDir;
  state.nginx.routesDir = path.join(prefixDir, 'routes');
  state.nginx.logDir = path.join(prefixDir, 'logs');
  state.nginx.errorLog.path = path.join(prefixDir, 'logs', 'error.log');
  state.nginx.port = 18099;
  store.save(state);

  const controller = createNginxController({ store, repoRoot: root, platform: 'darwin' });
  const { confPath } = controller.writeConfig();

  assert.equal(fs.existsSync(confPath), true);
  const content = fs.readFileSync(confPath, 'utf8');
  assert.match(content, /listen 18099;/);
  assert.match(content, /include .*routes\/\*\.conf;/);
});
