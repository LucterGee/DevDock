const { parseNginxConfig, slugify } = require('./parser');
const { locationToRoute } = require('./generator');
const { createNginxStore } = require('./routeStore');
const { createNginxController } = require('./controller');
const { findMissingVariables } = require('./variables');

const sortRoutes = (routes) => [...routes].sort((a, b) => String(a.path).localeCompare(String(b.path)));

const EXPORT_FORMAT = 'devdock-nginx';
const EXPORT_VERSION = 1;

const createNginxRuntime = (options = {}) => {
  const store = options.store || createNginxStore();
  const controller = options.controller || createNginxController({ store });

  const state = () => store.load();
  const save = (next) => store.save(next);

  const overview = () => {
    const current = state();
    if (controller.ensureConfig) controller.ensureConfig();
    const status = controller.status();
    const scan = store.scan();
    const variables = (current.nginx && current.nginx.variables) || [];
    return {
      state: current,
      status,
      routes: sortRoutes(current.routes || []),
      conflicts: scan.edited.map((item) => ({ id: item.id, path: item.path })),
      untracked: scan.untracked,
      variables,
      missingVariables: findMissingVariables(current.routes || [], variables),
    };
  };

  const findRoute = (current, id) => (current.routes || []).find((item) => item.id === id) || null;

  // 新建路由时由后端生成 id，避免前端各自造 id 造成冲突
  const makeRouteId = (current, route) => {
    const base = slugify(route.path || 'route');
    const used = new Set((current.routes || []).map((item) => item.id));
    if (!used.has(base)) return base;
    let index = 2;
    while (used.has(base + '-' + index)) index += 1;
    return base + '-' + index;
  };

  const upsertRoute = (route) => {
    const current = state();
    const routes = Array.isArray(current.routes) ? current.routes : [];
    if (!route.id) route = { ...route, id: makeRouteId(current, route) };
    const index = routes.findIndex((item) => item.id === route.id);
    if (index >= 0) routes[index] = { ...routes[index], ...route };
    else routes.push(route);
    save({ ...current, routes });
    return route;
  };

  const removeRoute = (id) => {
    const current = state();
    const routes = (current.routes || []).filter((item) => item.id !== id);
    save({ ...current, routes });
    return routes.length !== (current.routes || []).length;
  };


  const setActiveTarget = (routeId, targetId) => {
    const current = state();
    const route = findRoute(current, routeId);
    if (!route) return null;
    if (!(route.targets || []).some((item) => item.id === targetId)) return null;
    route.activeTargetId = targetId;
    save(current);
    return route;
  };

  const addTarget = (routeId, target) => {
    const current = state();
    const route = findRoute(current, routeId);
    if (!route) return null;
    const id = target.id || 'target-' + Date.now().toString(36);
    route.targets = [...(route.targets || []), { ...target, id }];
    if (!route.activeTargetId) route.activeTargetId = id;
    save(current);
    return route;
  };

  const removeTarget = (routeId, targetId) => {
    const current = state();
    const route = findRoute(current, routeId);
    if (!route) return null;
    const targets = (route.targets || []).filter((item) => item.id !== targetId);
    if (targets.length === (route.targets || []).length) return null;
    route.targets = targets;
    if (route.activeTargetId === targetId) route.activeTargetId = targets[0] ? targets[0].id : '';
    save(current);
    return route;
  };

  // 导出：固定格式标识与版本，结构不符的文件在导入时会被拒绝
  const exportPayload = () => {
    const current = state();
    return {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      variables: (current.nginx && current.nginx.variables) || [],
      routes: current.routes || [],
    };
  };

  const validateImportPayload = (payload) => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '文件内容不是有效的 JSON 对象';
    if (payload.format !== EXPORT_FORMAT) return 'format 字段必须是 ' + EXPORT_FORMAT;
    if (Number(payload.version) !== EXPORT_VERSION) return '不支持的版本：' + String(payload.version);
    if (!Array.isArray(payload.routes)) return 'routes 字段必须是数组';
    if (payload.variables != null && !Array.isArray(payload.variables)) return 'variables 字段必须是数组';

    for (const route of payload.routes) {
      if (!route || typeof route !== 'object') return '存在无效的路由条目';
      if (typeof route.path !== 'string' || !route.path.trim()) return '存在缺少 path 的路由条目';
      if (!Array.isArray(route.targets)) return '路由 ' + route.path + ' 缺少 targets 数组';
      for (const target of route.targets) {
        if (!target || typeof target.proxyPass !== 'string') return '路由 ' + route.path + ' 存在缺少 proxyPass 的目标';
      }
    }
    return '';
  };

  // 导入：整体覆盖现有路由与变量
  const importPayload = (payload) => {
    const error = validateImportPayload(payload);
    if (error) return { ok: false, error };

    const current = state();
    const routes = payload.routes.map((route, index) => ({
      id: route.id || slugify(route.path) + '-' + (index + 1),
      path: route.path,
      note: route.note || '',
      kind: route.kind === 'raw' ? 'raw' : 'proxy',
      activeTargetId: route.activeTargetId || (route.targets[0] && route.targets[0].id) || '',
      targets: route.targets,
      headers: {
        httpVersion: Boolean(route.headers && route.headers.httpVersion),
        host: Boolean(route.headers && route.headers.host),
        upgrade: Boolean(route.headers && route.headers.upgrade),
        connection: Boolean(route.headers && route.headers.connection),
      },
      others: Array.isArray(route.others) ? route.others : [],
      rawBody: route.rawBody || '',
      managed: true,
    }));

    save({
      ...current,
      nginx: { ...current.nginx, variables: payload.variables || [] },
      routes,
    });

    return { ok: true, imported: routes.length, variables: (payload.variables || []).length };
  };

  // 把状态落到磁盘：写配置 + 同步路由文件
  const apply = (options2 = {}) => {
    const current = state();
    const { confPath } = controller.writeConfig();
    const result = store.sync(current, { force: options2.force || [] });
    return { confPath, ...result };
  };

  const validate = () => controller.test();
  const reload = () => controller.reload();
  const start = () => controller.start();
  const stop = () => controller.stop();
  const restart = async () => {
    await controller.stop();
    return controller.start();
  };

  // 冲突处理：overwrite 覆盖，adopt 转成用户自定义（移除标记），skip 保持
  const resolveConflict = (id, action) => {
    const current = state();
    const route = findRoute(current, id);
    const filePath = require('path').join(current.nginx.routesDir, id + '.conf');

    if (action === 'overwrite') {
      if (route) store.writeRoute(route);
      return { ok: true, action };
    }
    if (action === 'adopt') {
      const { HEADER_MARK } = require('./routeStore');
      if (require('fs').existsSync(filePath)) {
        const text = require('fs').readFileSync(filePath, 'utf8');
        require('fs').writeFileSync(filePath, text.split('\n').filter((line) => !line.startsWith(HEADER_MARK) && !/^#\s*(id|hash):/.test(line)).join('\n'));
      }
      removeRoute(id);
      return { ok: true, action };
    }
    return { ok: true, action: 'skip' };
  };

  return {
    store,
    controller,
    overview,
    exportPayload,
    importPayload,
    validateImportPayload,
    upsertRoute,
    removeRoute,
    setActiveTarget,
    addTarget,
    removeTarget,
    apply,
    validate,
    reload,
    start,
    stop,
    restart,
    resolveConflict,
  };
};

module.exports = { createNginxRuntime, sortRoutes, EXPORT_FORMAT, EXPORT_VERSION };
