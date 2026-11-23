const { trimQuotes } = require('./parser');

const TOGGLE_DIRECTIVES = {
  httpVersion: { name: 'proxy_http_version', value: '1.1' },
  host: { name: 'proxy_set_header', value: 'Host $host' },
  upgrade: { name: 'proxy_set_header', value: 'Upgrade $http_upgrade' },
  connection: { name: 'proxy_set_header', value: 'Connection "upgrade"' },
};

const TOGGLE_ORDER = ['httpVersion', 'host', 'upgrade', 'connection'];

const isHeader = (directive, headerName) =>
  directive.name === 'proxy_set_header' && new RegExp('^' + headerName + '\\s', 'i').test(directive.value);

const labelFromProxyPass = (proxyPass) => {
  const text = trimQuotes(proxyPass);
  const hostMatch = text.match(/^https?:\/\/([^/]+)/);
  if (!hostMatch) return text;
  const host = hostMatch[1];
  const rest = text.slice(hostMatch[0].length).replace(/\/+$/, '');
  return rest ? host + rest : host;
};

const resolveTarget = (route) => {
  const targets = Array.isArray(route.targets) ? route.targets : [];
  return targets.find((item) => item.id === route.activeTargetId) || targets[0] || null;
};

// 解析结果 → 路由条目
const locationToRoute = (location) => {
  const directives = location.directives || [];
  const proxyPass = directives.find((item) => item.name === 'proxy_pass') || null;
  const referer = directives.find((item) => isHeader(item, 'Referer')) || null;

  const headers = {};
  for (const key of TOGGLE_ORDER) {
    const spec = TOGGLE_DIRECTIVES[key];
    headers[key] = directives.some(
      (item) => item.name === spec.name && trimQuotes(item.value) === trimQuotes(spec.value)
    );
  }

  // 每条被建模的指令只消费一次，重复出现的（如两条 Host）保留在 others 里，
  // 保证「解析 → 生成」不会吞掉用户配置中的重复行
  const consumed = new Set();
  const takeOnce = (predicate) => {
    for (let i = 0; i < directives.length; i += 1) {
      if (consumed.has(i)) continue;
      if (predicate(directives[i])) {
        consumed.add(i);
        return true;
      }
    }
    return false;
  };

  if (proxyPass) takeOnce((item) => item === proxyPass);
  if (referer) takeOnce((item) => item === referer);
  for (const key of TOGGLE_ORDER) {
    if (!headers[key]) continue;
    const spec = TOGGLE_DIRECTIVES[key];
    takeOnce((item) => item.name === spec.name && trimQuotes(item.value) === trimQuotes(spec.value));
  }

  const others = directives.filter((item, index) => !consumed.has(index));

  const targets = proxyPass
    ? [{
        id: 'default',
        label: labelFromProxyPass(proxyPass.value),
        proxyPass: proxyPass.value,
        referer: referer ? trimQuotes(referer.value.replace(/^Referer\s+/i, '')) : '',
      }]
    : [];

  const route = {
    id: location.id,
    path: location.pattern,
    note: location.note || '',
    enabled: true,
    kind: (location.unknown && location.unknown.length) || !proxyPass ? 'raw' : 'proxy',
    activeTargetId: targets.length ? 'default' : '',
    targets,
    headers,
    others,
    rawBody: location.body || '',
    managed: true,
  };

  if (route.kind === 'proxy' && !roundTrips(route, location.body)) {
    route.kind = 'raw';
  }

  return route;
};

const generateLocationBlock = (route) => {
  const pattern = route.path || route.pattern || '/';
  const lines = [];
  if (route.note) lines.push('# ' + route.note);
  lines.push('location ' + pattern + ' {');

  if (route.kind === 'raw') {
    if (route.rawBody) {
      for (const rawLine of String(route.rawBody).split('\n')) {
        lines.push(rawLine.trim() ? '  ' + rawLine.trim() : '');
      }
    }
    lines.push('}');
    return lines.join('\n');
  }

  const target = resolveTarget(route);
  if (!target) throw new Error('route ' + route.id + ' 缺少目标地址');

  lines.push('  proxy_pass ' + target.proxyPass + ';');

  const headers = route.headers || {};
  for (const key of TOGGLE_ORDER) {
    if (!headers[key]) continue;
    const spec = TOGGLE_DIRECTIVES[key];
    lines.push('  ' + spec.name + ' ' + spec.value + ';');
  }

  const referer = target.referer || route.referer || '';
  if (referer) lines.push('  proxy_set_header Referer "' + trimQuotes(referer) + '";');

  for (const item of route.others || []) {
    const name = String(item.name || '').trim();
    if (!name) continue;
    lines.push('  ' + name + ' ' + String(item.value || '').trim() + ';');
  }

  lines.push('}');
  return lines.join('\n');
};

const stripQuotes = (line) => line.replace(/"([^"]*)"/g, '$1').replace(/'([^']*)'/g, '$1');

const normalizeBlock = (text) => String(text || '')
  .split('\n')
  .map((line) => stripQuotes(line.replace(/\s+/g, ' ').trim()))
  .filter((line) => line && !line.startsWith('#'))
  .sort()
  .join('\n');

const roundTrips = (route, originalBody) => {
  if (route.kind === 'raw') return true;
  const generated = generateLocationBlock(route);
  const open = generated.indexOf('{');
  const close = generated.lastIndexOf('}');
  const body = open >= 0 && close > open ? generated.slice(open + 1, close) : '';
  return normalizeBlock(body) === normalizeBlock(originalBody);
};

module.exports = {
  generateLocationBlock,
  locationToRoute,
  normalizeBlock,
  resolveTarget,
  roundTrips,
  labelFromProxyPass,
  TOGGLE_DIRECTIVES,
  TOGGLE_ORDER,
};
