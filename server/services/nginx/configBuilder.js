const path = require('path');

const DEFAULT_PORT = 18080;

const MIME_TYPES = [
  'text/html html htm;',
  'text/css css;',
  'application/javascript js mjs;',
  'application/json json;',
  'application/xml xml;',
  'image/svg+xml svg;',
  'image/png png;',
  'image/jpeg jpg jpeg;',
  'image/gif gif;',
  'image/webp webp;',
  'image/x-icon ico;',
  'font/woff woff;',
  'font/woff2 woff2;',
  'font/ttf ttf;',
  'application/wasm wasm;',
];

const escapePath = (value) => String(value || '').replace(/\\/g, '/');

const resolvePort = (nginx) => {
  const port = Number(nginx && nginx.port);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT;
};

// nginx 用 -p 指定 prefix，配置里的相对路径都相对 prefix 解析，
// 因此 prefix 内的路径写成相对形式，配置就不再绑定用户目录
const toConfigPath = (target, prefix) => {
  const absolute = escapePath(target);
  const base = escapePath(prefix);
  if (!base || !absolute) return absolute;

  const relative = path.posix.relative(base, absolute);
  if (relative && !relative.startsWith('..') && !path.posix.isAbsolute(relative)) return relative;
  return absolute;
};

// http 块的默认内容，也是设置里「全局配置」的初始值
const buildDefaultHttpBody = (nginx) => {
  const prefix = escapePath((nginx && nginx.prefixDir) || '');
  const logDir = (nginx && nginx.logDir) || path.posix.join(prefix, 'logs');
  const accessLogPath = (nginx && nginx.accessLog && nginx.accessLog.path) || path.posix.join(logDir, 'access.log');
  const accessLogEnabled = Boolean(nginx && nginx.accessLog && nginx.accessLog.enabled);

  const accessLog = accessLogEnabled
    ? '  access_log ' + toConfigPath(accessLogPath, prefix) + ' main;'
    : '  access_log off;';

  return [
    '  default_type application/octet-stream;',
    '  sendfile on;',
    '  keepalive_timeout 65;',
    '  client_max_body_size 1000M;',
    '  client_body_timeout 600s;',
    '  client_header_timeout 600s;',
    '',
    "  log_format main '$remote_addr - $remote_user [$time_local] \"$request\" '",
    "                  '$status $body_bytes_sent \"$http_referer\" '",
    "                  '\"$http_user_agent\" \"$http_x_forwarded_for\"';",
    '',
    accessLog,
    '',
    '  types {',
    ...MIME_TYPES.map((item) => '    ' + item),
    '  }',
  ].join('\n');
};

// 取一行开头的指令名，用于判断用户是否自定义了同名指令
const directiveNameOf = (line) => {
  const match = String(line).trim().match(/^([a-z_]+)[\s{]/);
  return match ? match[1] : '';
};

// 去掉公共缩进后再统一加两格，避免用户已有的空格被叠加
const indentBlock = (text) => {
  const lines = String(text).split('\n');
  const indents = lines
    .filter((line) => line.trim())
    .map((line) => (line.match(/^[ \t]*/) || [''])[0].length);
  const common = indents.length ? Math.min(...indents) : 0;
  return lines
    .map((line) => (line.trim() ? '  ' + line.slice(common) : ''))
    .join('\n');
};

// 默认内容 + 用户追加的内容；用户写了同名指令时以用户的为准，避免重复指令报错
const buildHttpBody = (nginx, customHttp) => {
  const defaults = buildDefaultHttpBody(nginx);
  if (!customHttp.trim()) return defaults;

  const overridden = new Set(
    customHttp.split('\n').map(directiveNameOf).filter(Boolean)
  );

  const kept = [];
  let dropping = false;
  for (const line of defaults.split('\n')) {
    if (!line.trim()) {
      if (!dropping) kept.push(line);
      continue;
    }
    const name = directiveNameOf(line);
    if (!name) {
      // 续行（如 log_format 的后续引号行）跟随上一条指令
      if (!dropping) kept.push(line);
      continue;
    }
    dropping = overridden.has(name);
    if (!dropping) kept.push(line);
  }

  return kept.join('\n').replace(/\n+$/, '') + '\n\n' + indentBlock(customHttp);
};

const buildMainConfig = (state) => {
  const nginx = (state && state.nginx) || {};
  const port = resolvePort(nginx);
  const prefix = escapePath(nginx.prefixDir || '');
  const routesDir = nginx.routesDir || path.posix.join(prefix, 'routes');
  const logDir = nginx.logDir || path.posix.join(prefix, 'logs');
  const errorLogPath = (nginx.errorLog && nginx.errorLog.path) || path.posix.join(logDir, 'error.log');

  // 配置了全局配置就以它为准，http 块里除 server 外全部由用户掌控
  // 这里不能整体 trim：那会只去掉首行缩进，导致公共缩进算错
  const customHttp = typeof nginx.customHttp === 'string' ? nginx.customHttp : '';
  const httpBody = buildHttpBody({ ...nginx, prefixDir: prefix, logDir, routesDir }, customHttp);

  const lines = [
    '# 由 DevDock 生成，请勿手工修改；',
    '# http 级配置在「设置 → 全局配置」中维护，location 级内容请使用路由或「原始块」路由',
    '',
    'worker_processes 1;',
    'pid ' + toConfigPath(path.posix.join(prefix, 'nginx.pid'), prefix) + ';',
    'error_log ' + toConfigPath(errorLogPath, prefix) + ' warn;',
    '',
    'events {',
    '  worker_connections 1024;',
    '}',
    '',
    'http {',
    httpBody,
    '',
    '  server {',
    '    listen ' + port + ';',
    '    server_name localhost;',
    '',
    '    include ' + toConfigPath(path.posix.join(routesDir, '*.conf'), prefix) + ';',
    '  }',
    '}',
    '',
  ];

  return lines.join('\n');
};

module.exports = { buildMainConfig, buildDefaultHttpBody, resolvePort, DEFAULT_PORT, MIME_TYPES };
