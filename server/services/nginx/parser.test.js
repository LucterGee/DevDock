const test = require('node:test');
const assert = require('node:assert/strict');

const { parseNginxConfig, parseBody } = require('./parser');
const { generateLocationBlock, locationToRoute, normalizeBlock, roundTrips } = require('./generator');

const FIXTURE = [
  'http {',
  '  server {',
  '    listen 18080;',
  '',
  '    # 信科官网首页',
  '    location /teacher {',
  '      proxy_pass http://host.docker.internal:4567;',
  '      proxy_http_version 1.1;',
  '      proxy_set_header Host $host;',
  '      proxy_set_header Upgrade $http_upgrade;',
  '      proxy_set_header Connection "upgrade";',
  '    }',
  '',
  '    location /xxkj/ {',
  '      # proxy_pass https://xk.epubedu.com/xxkj/;',
  '      proxy_pass https://aiedu.epubedu.com/xxkj/;',
  '      proxy_http_version 1.1;',
  '      proxy_set_header Upgrade $http_upgrade;',
  '      proxy_set_header Connection "upgrade";',
  '      proxy_set_header Referer "https://aiedu.epubedu.com/xxkj/";',
  '    }',
  '',
  '    location /dup {',
  '      proxy_pass http://host.docker.internal:3000;',
  '      proxy_set_header Host $host;',
  '      proxy_set_header Host $host;',
  '    }',
  '',
  '    location = /50x.html {',
  '      root html;',
  '    }',
  '  }',
  '}',
].join('\n');

test('parseNginxConfig 提取 location 与上方注释', () => {
  const { locations } = parseNginxConfig(FIXTURE);
  assert.equal(locations.length, 4);
  assert.equal(locations[0].pattern, '/teacher');
  assert.equal(locations[0].note, '信科官网首页');
});

test('被注释掉的候选不会被当成当前目标', () => {
  const { locations } = parseNginxConfig(FIXTURE);
  const route = locationToRoute(locations.find((item) => item.pattern === '/xxkj/'));
  assert.equal(route.targets.length, 1);
  assert.equal(route.targets[0].proxyPass, 'https://aiedu.epubedu.com/xxkj/');
  assert.equal(route.targets[0].referer, 'https://aiedu.epubedu.com/xxkj/');
});

test('常用开关从指令里推导', () => {
  const { locations } = parseNginxConfig(FIXTURE);
  const route = locationToRoute(locations.find((item) => item.pattern === '/teacher'));
  assert.deepEqual(route.headers, {
    httpVersion: true,
    host: true,
    upgrade: true,
    connection: true,
  });
  assert.equal(route.kind, 'proxy');
});

test('重复指令在往返中保留', () => {
  const { locations } = parseNginxConfig(FIXTURE);
  const location = locations.find((item) => item.pattern === '/dup');
  const route = locationToRoute(location);
  assert.equal(route.kind, 'proxy');
  const generated = generateLocationBlock(route);
  assert.equal((generated.match(/proxy_set_header Host \$host;/g) || []).length, 2);
  assert.equal(roundTrips(route, location.body), true);
});

test('无 proxy_pass 的块降级为 raw 并保留原文', () => {
  const { locations } = parseNginxConfig(FIXTURE);
  const location = locations.find((item) => item.pattern === '= /50x.html');
  const route = locationToRoute(location);
  assert.equal(route.kind, 'raw');
  assert.match(generateLocationBlock(route), /root html;/);
});

test('所有 proxy 块往返保真', () => {
  const { locations } = parseNginxConfig(FIXTURE);
  for (const location of locations) {
    const route = locationToRoute(location);
    assert.equal(roundTrips(route, location.body), true, location.pattern + ' 往返失败');
  }
});

test('切换目标后生成的内容随之改变', () => {
  const { locations } = parseNginxConfig(FIXTURE);
  const route = locationToRoute(locations.find((item) => item.pattern === '/xxkj/'));
  route.targets.push({
    id: 'xk',
    label: 'xk',
    proxyPass: 'https://xk.epubedu.com/xxkj/',
    referer: 'https://xk.epubedu.com/xxkj/',
  });
  route.activeTargetId = 'xk';
  const generated = generateLocationBlock(route);
  assert.match(generated, /proxy_pass https:\/\/xk\.epubedu\.com\/xxkj\//);
  assert.match(generated, /Referer "https:\/\/xk\.epubedu\.com\/xxkj\/"/);
});

test('parseBody 遇到嵌套块时产生 unknown（触发 raw 降级）', () => {
  const { directives, unknown } = parseBody('proxy_pass http://a;\nif ($x) {\n  return 404;\n}');
  assert.ok(directives.some((item) => item.name === 'proxy_pass'));
  assert.ok(unknown.length > 0, '含 if 块时应产生 unknown');
});

test('normalizeBlock 忽略引号与顺序差异', () => {
  const a = 'proxy_pass "http://a";\nproxy_http_version 1.1;';
  const b = 'proxy_http_version 1.1;\nproxy_pass http://a;';
  assert.equal(normalizeBlock(a), normalizeBlock(b));
});
