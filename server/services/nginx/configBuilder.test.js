const test = require('node:test');
const assert = require('node:assert/strict');

const { buildMainConfig, resolvePort, DEFAULT_PORT } = require('./configBuilder');

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

test('默认监听 18080 并包含路由 include', () => {
  const conf = buildMainConfig(baseState());
  assert.match(conf, /listen 18080;/);
  assert.match(conf, /include \/Users\/demo\/\.devdock\/nginx\/routes\/\*\.conf;/);
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

test('access_log 默认关闭，开启后写入指定路径', () => {
  assert.match(buildMainConfig(baseState()), /access_log off;/);
  const enabled = buildMainConfig(baseState({
    accessLog: { enabled: true, path: '/tmp/access.log' },
  }));
  assert.match(enabled, /access_log \/tmp\/access\.log main;/);
});

test('pid 与 error_log 落在 prefix 目录内', () => {
  const conf = buildMainConfig(baseState());
  assert.match(conf, /pid \/Users\/demo\/\.devdock\/nginx\/nginx\.pid;/);
  assert.match(conf, /error_log \/Users\/demo\/\.devdock\/nginx\/logs\/error\.log warn;/);
});

test('Windows 反斜杠路径会转成正斜杠', () => {
  const conf = buildMainConfig(baseState({
    prefixDir: 'C:\\Users\\demo\\.devdock\\nginx',
    routesDir: 'C:\\Users\\demo\\.devdock\\nginx\\routes',
    logDir: 'C:\\Users\\demo\\.devdock\\nginx\\logs',
    errorLog: { enabled: true, path: 'C:\\Users\\demo\\.devdock\\nginx\\logs\\error.log' },
  }));
  assert.doesNotMatch(conf, /\\\\/);
  assert.match(conf, /include C:\/Users\/demo\/\.devdock\/nginx\/routes\/\*\.conf;/);
});

test('配置头标注为自动生成', () => {
  assert.match(buildMainConfig(baseState()), /由 DevDock 生成/);
});

test('全局配置片段注入到 http 块内', () => {
  const conf = buildMainConfig(baseState({ customHttp: 'gzip on;\ngzip_types text/css;' }));
  const lines = conf.split('\n');
  const httpIndex = lines.findIndex((line) => line.trim() === 'http {');
  const serverIndex = lines.findIndex((line) => line.trim().startsWith('server {'));
  const gzipIndex = lines.findIndex((line) => line.includes('gzip on;'));
  const gzipTypesIndex = lines.findIndex((line) => line.includes('gzip_types text/css;'));

  assert.ok(httpIndex >= 0, '应包含 http 块');
  assert.ok(gzipIndex > httpIndex && gzipIndex < serverIndex, 'gzip 应在 http 块内且在 server 之前');
  assert.ok(gzipTypesIndex > gzipIndex, '多行内容应逐行写入');
  assert.match(lines[gzipIndex], /^ {2}gzip on;$/, '应缩进两格');
});

test('未配置全局片段时不产生多余空行', () => {
  const conf = buildMainConfig(baseState());
  assert.doesNotMatch(conf, /自定义全局配置/);
});

test('配置头提示全局片段的位置', () => {
  const conf = buildMainConfig(baseState());
  assert.match(conf, /全局配置/);
});

