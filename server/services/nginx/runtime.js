const { parseNginxConfig } = require('./parser');
const { locationToRoute } = require('./generator');
const { createNginxStore } = require('./routeStore');
const { createNginxController } = require('./controller');

const sortRoutes = (routes) => [...routes].sort((a, b) => String(a.path).localeCompare(String(b.path)));

const createNginxRuntime = (options = {}) => {
  const store = options.store || createNginxStore();
  const controller = options.controller || createNginxController({ store });

  const state = () => store.load();
  const save = (next) => store.save(next);

  const overview = () => {
    const current = state();
    const status = controller.status();
    const scan = store.scan();
    return {
      state: current,
      status,
      routes: sortRoutes(current.routes || []),
      conflicts: scan.edited.map((item) => ({ id: item.id, path: item.path })),
      untracked: scan.untracked,
    };
  };

  const findRoute = (current, id) => (current.routes || []).find((item) => item.id === id) || null;

  const upsertRoute = (route) => {
    const current = state();
    const routes = Array.isArray(current.routes) ? current.routes : [];
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

  const setEnabled = (id, enabled) => {
    const current = state();
    const route = findRoute(current, id);
    if (!route) return null;
    route.enabled = Boolean(enabled);
    save(current);
    return route;
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

  // 导入：按 path 合并，已存在的路由保留其目标/开关，只补充新路径
  const importFromText = (text) => {
    const { locations } = parseNginxConfig(text);
    const current = state();
    const routes = Array.isArray(current.routes) ? current.routes : [];
    const byPath = new Map(routes.map((item) => [item.path, item]));

    let added = 0;
    let updated = 0;
    for (const location of locations) {
      const incoming = locationToRoute(location);
      const existing = byPath.get(incoming.path);
      if (existing) {
        if (incoming.note && incoming.note !== existing.note) existing.note = incoming.note;
        updated += 1;
        continue;
      }
      routes.push(incoming);
      byPath.set(incoming.path, incoming);
      added += 1;
    }

    save({ ...current, routes });
    return { added, updated, total: locations.length };
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
    importFromText,
    upsertRoute,
    removeRoute,
    setEnabled,
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

module.exports = { createNginxRuntime, sortRoutes };
