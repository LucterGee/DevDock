const VARIABLE_RE = /\$\{(\w+)\}/g;

const normalizeVariables = (list) => {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => ({
      name: String((item && item.name) || '').trim(),
      value: String((item && item.value) || '').trim(),
    }))
    .filter((item) => item.name);
};

const variableMap = (list) => {
  const map = new Map();
  for (const item of normalizeVariables(list)) map.set(item.name, item.value);
  return map;
};

const resolveText = (text, variables) => {
  const map = variableMap(variables);
  return String(text == null ? '' : text).replace(VARIABLE_RE, (match, name) => {
    return map.has(name) ? map.get(name) : match;
  });
};

const listVariableNames = (text) => {
  const names = [];
  String(text == null ? '' : text).replace(VARIABLE_RE, (match, name) => {
    if (!names.includes(name)) names.push(name);
    return match;
  });
  return names;
};

// 返回解析后的路由副本，原对象不变
const resolveRoute = (route, variables) => {
  const map = variableMap(variables);
  const resolve = (value) => resolveText(value, variables);

  return {
    ...route,
    targets: (route.targets || []).map((target) => ({
      ...target,
      proxyPass: resolve(target.proxyPass),
      referer: resolve(target.referer),
    })),
    others: (route.others || []).map((item) => ({ ...item, value: resolve(item.value) })),
    referer: resolve(route.referer || ''),
  };
};

const findMissingVariables = (routes, variables) => {
  const known = variableMap(variables);
  const missing = new Set();
  for (const route of routes || []) {
    const texts = [
      ...(route.targets || []).map((target) => target.proxyPass),
      ...(route.targets || []).map((target) => target.referer),
      ...(route.others || []).map((item) => item.value),
    ];
    for (const text of texts) {
      for (const name of listVariableNames(text)) {
        if (!known.has(name)) missing.add(name);
      }
    }
  }
  return [...missing];
};

module.exports = { normalizeVariables, resolveText, resolveRoute, findMissingVariables, listVariableNames };
