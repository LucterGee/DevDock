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

const buildMainConfig = (state) => {
  const nginx = (state && state.nginx) || {};
  const port = resolvePort(nginx);
  const prefix = escapePath(nginx.prefixDir || '');
  const routesDir = escapePath(nginx.routesDir || '');
  const logDir = escapePath(nginx.logDir || '');

  const accessLog = nginx.accessLog && nginx.accessLog.enabled
    ? 'access_log ' + escapePath(nginx.accessLog.path) + ' main;'
    : 'access_log off;';
  const errorLogPath = (nginx.errorLog && nginx.errorLog.path) || path.posix.join(logDir, 'error.log');
  const customHttp = typeof nginx.customHttp === 'string' ? nginx.customHttp.trim() : '';
  const customHttpLines = customHttp
    ? ['  # 自定义全局配置（来自设置）', ...customHttp.split('\n').map((line) => (line.trim() ? '  ' + line : '')), '']
    : [];

  const lines = [
    '# 由 DevDock 生成，请勿手工修改；',
    '# http 级自定义指令请写在「设置 → 全局配置」中，location 级内容请使用路由或「原始块」路由',
    'worker_processes 1;',
    'pid ' + path.posix.join(prefix, 'nginx.pid') + ';',
    'error_log ' + escapePath(errorLogPath) + ' warn;',
    '',
    'events {',
    '  worker_connections 1024;',
    '}',
    '',
    'http {',
    '  default_type application/octet-stream;',
    '  sendfile on;',
    '  keepalive_timeout 65;',
    '  client_max_body_size 1000M;',
    '  client_body_timeout 600s;',
    '  client_header_timeout 600s;',
    '',
    '  log_format main \'$remote_addr - $remote_user [$time_local] "$request" \'',
    '                  \'$status $body_bytes_sent "$http_referer" \'',
    '                  \'"$http_user_agent" "$http_x_forwarded_for"\';',
    '',
    '  ' + accessLog,
    '',
    ...customHttpLines,
    '  types {',
    ...MIME_TYPES.map((item) => '    ' + item),
    '  }',
    '',
    '  server {',
    '    listen ' + port + ';',
    '    server_name localhost;',
    '',
    '    # DevDock 路由（每个路由一个文件）',
    '    include ' + path.posix.join(routesDir, '*.conf') + ';',
    '  }',
    '}',
    '',
  ];

  return lines.join('\n');
};

module.exports = { buildMainConfig, resolvePort, DEFAULT_PORT, MIME_TYPES };
