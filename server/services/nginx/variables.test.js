const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveText, resolveRoute, findMissingVariables, normalizeVariables } = require('./variables');
const { createNginxStore } = require('./routeStore');

const VARS = [{ name: 'aieduEpubedu', value: 'aiedu.epubedu.com' }];

test('解析变量占位符', () => {
  assert.equal(resolveText('https://${aieduEpubedu}/xxkj/', VARS), 'https://aiedu.epubedu.com/xxkj/');
  assert.equal(resolveText('http://${aieduEpubedu}', VARS), 'http://aiedu.epubedu.com');
});

test('未定义的变量原样保留，便于暴露问题', () => {
  assert.equal(resolveText('https://${nope}/x/', VARS), 'https://${nope}/x/');
});

test('变量可用在前后缀任意位置', () => {
  assert.equal(resolveText('${aieduEpubedu}:8080/api', VARS), 'aiedu.epubedu.com:8080/api');
  assert.equal(resolveText('pre-${aieduEpubedu}-post', VARS), 'pre-aiedu.epubedu.com-post');
});

test('normalizeVariables 丢弃空名并去空格', () => {
  assert.deepEqual(
    normalizeVariables([{ name: ' a ', value: ' b ' }, { name: '', value: 'x' }, null]),
    [{ name: 'a', value: 'b' }]
  );
});

test('resolveRoute 只解析副本，不改原对象', () => {
  const route = {
    id: 't',
    targets: [{ id: 'a', proxyPass: 'https://${aieduEpubedu}/xxkj/', referer: 'https://${aieduEpubedu}/' }],
    others: [{ name: 'proxy_set_header', value: 'X-Env ${aieduEpubedu}' }],
  };
  const resolved = resolveRoute(route, VARS);
  assert.equal(resolved.targets[0].proxyPass, 'https://aiedu.epubedu.com/xxkj/');
  assert.equal(resolved.targets[0].referer, 'https://aiedu.epubedu.com/');
  assert.equal(resolved.others[0].value, 'X-Env aiedu.epubedu.com');
  assert.equal(route.targets[0].proxyPass, 'https://${aieduEpubedu}/xxkj/');
});

test('findMissingVariables 汇总所有未定义变量', () => {
  const routes = [
    { targets: [{ proxyPass: 'https://${aieduEpubedu}/x', referer: '' }] },
    { targets: [{ proxyPass: 'https://${other}/y', referer: '' }], others: [{ name: 'h', value: '${other2}' }] },
  ];
  assert.deepEqual(findMissingVariables(routes, VARS).sort(), ['other', 'other2']);
});

test('写入文件时变量被解析为实际值', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'devdock-var-'));
  const routesDir = path.join(root, 'routes');
  const store = createNginxStore({ statePath: path.join(root, 'state.json'), routesDir });
  const state = store.load();
  state.nginx.variables = VARS;
  state.routes = [{
    id: 'xxkj',
    path: '/xxkj/',
    note: '',
    enabled: true,
    kind: 'proxy',
    activeTargetId: 'a',
    targets: [{ id: 'a', label: 'a', proxyPass: 'https://${aieduEpubedu}/xxkj/', referer: 'https://${aieduEpubedu}/' }],
    headers: { httpVersion: true, host: false, upgrade: false, connection: false },
    others: [],
  }];
  store.save(state);
  store.sync(state);

  const content = fs.readFileSync(path.join(routesDir, 'xxkj.conf'), 'utf8');
  assert.match(content, /proxy_pass https:\/\/aiedu\.epubedu\.com\/xxkj\//);
  assert.match(content, /Referer "https:\/\/aiedu\.epubedu\.com\/"/);
  assert.ok(!content.includes('$' + '{'), '生成的文件里不应残留变量占位符');
});
