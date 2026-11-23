const test = require('node:test');
const assert = require('node:assert/strict');

const { buildMainConfig, buildDefaultHttpBody, resolvePort, DEFAULT_PORT } = require('./configBuilder');

const baseState = (overrides = {}) => ({
  nginx: {
    port: 18080,
    prefixDir: '/Users/demo/.devdock/nginx',
    routesDir: '/Users/demo/.devdock/nginx/routes',
    logDir: '/Users/demo/.devdock/nginx/logs',
    accessLog: { enabled: false, path: '/Users/demo/.devdock/nginx/logs/access.log' },
    errorLog: { enabled: true, path: '/Users/demo/.devdock/nginx/logs/error.log' },
    ...overrides,
  },
});

test('默认监听 18080 并包含相对路由 include', () => {
  const conf = buildMainConfig(baseState());
  assert.match(conf, /listen 18080;/);
  assert.match(conf, /include routes\/\*\.conf;/);
});

test('prefix 内的路径写成相对形式，不出现用户目录', () => {
  const conf = buildMainConfig(baseState());
  assert.match(conf, /pid nginx\.pid;/);
  assert.match(conf, /error_log logs\/error\.log warn;/);
  assert.doesNotMatch(conf, /\/Users\/demo/);
});

test('prefix 外的路径保持绝对', () => {
  const conf = buildMainConfig(baseState({
    errorLog: { enabled: true, path: '/var/log/nginx/error.log' },
  }));
  assert.match(conf, /error_log \/var\/log\/nginx\/error\.log warn;/);
});

test('端口可自定义', () => {
  const conf = buildMainConfig(baseState({ port: 18099 }));
  assert.match(conf, /listen 18099;/);
  assert.doesNotMatch(conf, /listen 18080;/);
});

test('非法端口回落到默认值', () => {
  assert.equal(resolvePort({ port: 0 }), DEFAULT_PORT);
  assert.equal(resolvePort({ port: -1 }), DEFAULT_PORT);
  assert.equal(resolvePort({ port: 70000 }), DEFAULT_PORT);
  assert.equal(resolvePort({ port: 'abc' }), DEFAULT_PORT);
  assert.equal(resolvePort({}), DEFAULT_PORT);
});

test('pid 与 error_log 相对 prefix 解析', () => {
  const conf = buildMainConfig(baseState());
  assert.match(conf, /pid nginx\.pid;/);
  assert.match(conf, /error_log logs\/error\.log warn;/);
});

test('Windows 反斜杠路径会转成正斜杠', () => {
  const conf = buildMainConfig(baseState({
    prefixDir: 'C:\\Users\\demo\\.devdock\\nginx',
    routesDir: 'C:\\Users\\demo\\.devdock\\nginx\\routes',
    logDir: 'C:\\Users\\demo\\.devdock\\nginx\\logs',
    errorLog: { enabled: true, path: 'C:\\Users\\demo\\.devdock\\nginx\\logs\\error.log' },
  }));
  assert.doesNotMatch(conf, /\\\\/);
  assert.match(conf, /include routes\/\*\.conf;/);
});

test('配置头标注为自动生成', () => {
  assert.match(buildMainConfig(baseState()), /由 DevDock 生成/);
});

test('全局配置决定 http 块内容，位于 server 之前', () => {
  const conf = buildMainConfig(baseState({ customHttp: 'gzip on;\ngzip_types text/css;' }));
  const lines = conf.split('\n');
  const httpIndex = lines.findIndex((line) => line.trim() === 'http {');
  const serverIndex = lines.findIndex((line) => line.trim().startsWith('server {'));
  const gzipIndex = lines.findIndex((line) => line.includes('gzip on;'));
  const gzipTypesIndex = lines.findIndex((line) => line.includes('gzip_types text/css;'));

  assert.ok(httpIndex >= 0, '应包含 http 块');
  assert.ok(gzipIndex > httpIndex && gzipIndex < serverIndex, 'gzip 应在 http 块内且在 server 之前');
  assert.ok(gzipTypesIndex > gzipIndex, '多行内容应逐行写入');
  assert.equal(lines[gzipIndex].trim(), 'gzip on;', '指令名不受缩进影响');
  assert.doesNotMatch(conf, /client_max_body_size/, '不再自动注入内置指令');
});

test('未配置全局片段时不产生多余空行', () => {
  const conf = buildMainConfig(baseState());
  assert.doesNotMatch(conf, /自定义全局配置/);
});

test('配置头提示全局片段的位置', () => {
  const conf = buildMainConfig(baseState());
  assert.match(conf, /全局配置/);
});


test('用户内容带缩进时不会叠加', () => {
  const conf = buildMainConfig(baseState({ customHttp: '  gzip on;\n  gzip_types text/css;' }));
  const lines = conf.split('\n');
  const gzip = lines.find((line) => line.includes('gzip on;'));
  const types = lines.find((line) => line.includes('gzip_types'));
  assert.equal(gzip, '  gzip on;');
  assert.equal(types, '  gzip_types text/css;');
});

test('tab 缩进归一化为空格', () => {
  const conf = buildMainConfig(baseState({ customHttp: '\tgzip on;' }));
  assert.match(conf, /^ {2}gzip on;$/m);
});

test('用户写了同名指令时以用户为准', () => {
  const conf = buildMainConfig(baseState({ customHttp: 'client_max_body_size 2000M;' }));
  const hits = conf.split('\n').filter((line) => line.includes('client_max_body_size'));
  assert.equal(hits.length, 1);
  assert.match(hits[0], /2000M/);
});

test('未自定义时 http 块不含任何内置内容', () => {
  const conf = buildMainConfig(baseState());
  const lines = conf.split('\n');
  const httpIndex = lines.findIndex((line) => line.trim() === 'http {');
  const serverIndex = lines.findIndex((line) => line.trim().startsWith('server {'));

  assert.equal(serverIndex, httpIndex + 1, 'http 块内直接就是 server');
  assert.doesNotMatch(conf, /client_max_body_size/);
  assert.doesNotMatch(conf, /types \{/);
});


test('默认 http 内容只保留必要指令，日志以注释形式给出', () => {
  const body = buildDefaultHttpBody();
  const active = body.split('\n').filter((line) => line.trim() && !line.trim().startsWith('#'));

  assert.deepEqual(active.map((line) => line.trim()), [
    'client_max_body_size 1000M;',
    'client_body_timeout 600s;',
    'client_header_timeout 600s;',
  ]);
  assert.match(body, /# access_log\s+logs\/access\.log/);
  assert.match(body, /# log_format\s+main/);
  assert.doesNotMatch(body, /include/, '不引用外部文件');
});

test('不再生成 access_log，由用户在全局配置里自行开启', () => {
  const conf = buildMainConfig(baseState({ accessLog: { enabled: true, path: '/Users/demo/.devdock/nginx/logs/access.log' } }));
  assert.doesNotMatch(conf, /^\s*access_log/m);
});

