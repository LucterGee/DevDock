<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Braces, Download, FolderOpen, Pencil, Plus, Play, RotateCw, Save, Search, Settings, ShieldCheck, Square, Trash2, Upload, X } from 'lucide-vue-next'
import { ensureHomeDir, toDisplayPath } from '../../utils/pathDisplay'
import RouteEditor from './RouteEditor.vue'
import VariablesDialog from './VariablesDialog.vue'
import {
  nginxCall,
  type NginxActionResult,
  type NginxConflict,
  type NginxOverview,
  type NginxRoute,
  type NginxStatus,
  type NginxTarget,
  type NginxValidateResult,
  type NginxVariable
} from '../../utils/nginx'

const status = ref<NginxStatus | null>(null)
const routes = ref<NginxRoute[]>([])
const conflicts = ref<NginxConflict[]>([])
const variables = ref<NginxVariable[]>([])
const missingVariables = ref<string[]>([])
const selectedId = ref('')
const search = ref('')
const noteDraft = ref('')
const busy = ref(false)


const addingTarget = ref(false)
const newTarget = ref({ label: '', proxyPass: '', referer: '' })

const canTest = computed(() => Boolean(status.value?.installed))
const canStart = computed(() => Boolean(status.value?.installed) && !status.value?.running)
const canReload = computed(() => Boolean(status.value?.running))
const canStop = computed(() => Boolean(status.value?.running))
const runStateLabel = computed(() => {
  if (!status.value) return '读取中'
  if (status.value.running) return '运行中'
  return status.value.installed ? '未启动' : 'nginx 未就绪'
})

const selected = computed(() => routes.value.find((route) => route.id === selectedId.value) || null)
const conflict = computed(() => conflicts.value.find((item) => item.id === selectedId.value) || null)
const filtered = computed(() => {
  const keyword = search.value.trim().toLowerCase()
  if (!keyword) return routes.value
  return routes.value.filter((route) => {
    if (route.path.toLowerCase().includes(keyword)) return true
    return (route.targets || []).some((target) => String(target.proxyPass || '').toLowerCase().includes(keyword))
  })
})

const activeTarget = (route: NginxRoute): NginxTarget | null =>
  (route.targets || []).find((target) => target.id === route.activeTargetId) || null

const replaceRoute = (route: NginxRoute) => {
  const index = routes.value.findIndex((item) => item.id === route.id)
  if (index >= 0) routes.value[index] = route
}

const load = async () => {
  const overview = await nginxCall<NginxOverview>('nginx:overview')
  status.value = overview.status
  routes.value = overview.routes || []
  conflicts.value = overview.conflicts || []
  variables.value = overview.variables || []
  missingVariables.value = overview.missingVariables || []
  nginxSettings.value = (overview.state as any)?.nginx || null
  defaultHttpConfig.value = (overview as any).defaultHttpConfig || ''
  if (!routes.value.some((route) => route.id === selectedId.value)) {
    selectedId.value = routes.value[0]?.id || ''
    addingTarget.value = false
  }
  noteDraft.value = selected.value?.note || ''
}

const run = async (task: () => Promise<void>) => {
  busy.value = true
  try { await task() }
  catch (error: any) { window.$toast?.warning?.(error.message) }
  finally { busy.value = false }
}

const select = (id: string) => {
  selectedId.value = id
  noteDraft.value = selected.value?.note || ''
  addingTarget.value = false
}

const saveRoute = () => run(async () => {
  if (!selected.value) return
  const saved = await nginxCall<NginxRoute>('nginx:route:save', { route: { ...selected.value, note: noteDraft.value } })
  replaceRoute(saved)
  noteDraft.value = saved.note || ''
})

const removeRoute = () => run(async () => {
  if (!selected.value) return
  const route = selected.value
  const ok = await window.$confirm(`确定删除路由「${route.path}」？`, '删除路由', { type: 'warning', confirmText: '删除' })
  if (!ok) return
  await nginxCall<{ removed: boolean }>('nginx:route:remove', { id: route.id })
  selectedId.value = ''
  await load()
})

const editorOpen = ref(false)
const editorRoute = ref<NginxRoute | null>(null)

const emptyRoute = (): NginxRoute => ({
  id: '',
  path: '',
  note: '',
  kind: 'proxy',
  activeTargetId: '',
  targets: [{ id: 'target-1', label: '', proxyPass: '', referer: '' }],
  headers: { httpVersion: true, host: true, upgrade: true, connection: true },
  others: [],
  rawBody: ''
})

const cloneRoute = (route: NginxRoute): NginxRoute => ({
  ...route,
  targets: (route.targets || []).map((target) => ({ ...target })),
  headers: { ...route.headers },
  others: (route.others || []).map((item) => ({ ...item }))
})

const openCreate = () => {
  editorRoute.value = emptyRoute()
  editorOpen.value = true
}

const openEdit = () => {
  if (!selected.value) return
  editorRoute.value = cloneRoute(selected.value)
  editorOpen.value = true
}

const closeEditor = () => {
  editorOpen.value = false
  editorRoute.value = null
}

const submitRoute = (route: NginxRoute) => run(async () => {
  const saved = await nginxCall<NginxRoute>('nginx:route:save', { route })
  window.$toast?.success?.('已保存')
  closeEditor()
  selectedId.value = saved.id
  await load()
})

const startAddTarget = () => {
  newTarget.value = { label: '', proxyPass: '', referer: '' }
  addingTarget.value = true
}

const addTarget = () => run(async () => {
  if (!selected.value) return
  if (!newTarget.value.label.trim() || !newTarget.value.proxyPass.trim()) return
  const route = await nginxCall<NginxRoute>('nginx:target:add', {
    routeId: selected.value.id,
    target: {
      label: newTarget.value.label.trim(),
      proxyPass: newTarget.value.proxyPass.trim(),
      referer: newTarget.value.referer.trim()
    }
  })
  replaceRoute(route)
  addingTarget.value = false
})

const removeTarget = (targetId: string) => run(async () => {
  if (!selected.value) return
  replaceRoute(await nginxCall<NginxRoute>('nginx:target:remove', { routeId: selected.value.id, targetId }))
})

const setActiveTarget = (targetId: string) => run(async () => {
  if (!selected.value) return
  replaceRoute(await nginxCall<NginxRoute>('nginx:target:active', { routeId: selected.value.id, targetId }))
})

const resolveConflict = (action: 'overwrite' | 'adopt') => run(async () => {
  if (!conflict.value) return
  await nginxCall('nginx:conflict:resolve', { id: conflict.value.id, action })
  await load()
})

const actionLabels: Record<string, string> = {
  'nginx:validate': '配置校验通过',
  'nginx:reload': '已重载',
  'nginx:start': '已启动',
  'nginx:stop': '已停止'
}

const runAction = (event: 'nginx:validate' | 'nginx:reload' | 'nginx:start' | 'nginx:stop') => run(async () => {
  if (event === 'nginx:validate') {
    const result = await nginxCall<NginxValidateResult>('nginx:validate')
    if (result.ok) window.$toast?.success?.(actionLabels[event])
    else window.$toast?.error?.(result.error || result.stderr || '配置校验失败')
    return
  }
  const result = await nginxCall<NginxActionResult>(event)
  if (result.ok) window.$toast?.success?.(actionLabels[event])
  else window.$toast?.error?.(result.error || '操作失败')
  await load()
})

const fileInput = ref<HTMLInputElement | null>(null)

const pickImportFile = () => {
  fileInput.value?.click()
}

const onImportFile = (event: Event) => run(async () => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  let payload: any
  try {
    payload = JSON.parse(await file.text())
  } catch (error: any) {
    window.$toast?.error?.('文件不是有效的 JSON')
    return
  }

  if (!payload || payload.format !== 'devdock-nginx') {
    window.$toast?.error?.('文件格式不符：缺少 format=devdock-nginx 标识')
    return
  }

  const incomingRoutes = Array.isArray(payload.routes) ? payload.routes.length : 0
  const incomingVariables = Array.isArray(payload.variables) ? payload.variables.length : 0
  const currentVariables = (nginxSettings.value?.variables || []).length
  const ok = await window.$confirm(
    '导入将覆盖当前 ' + routes.value.length + ' 条路由、' + currentVariables +
      ' 个变量，替换为文件中的 ' + incomingRoutes + ' 条路由、' + incomingVariables +
      ' 个变量。此操作不可撤销。',
    '导入配置',
    { type: 'warning', confirmText: '覆盖导入' }
  )
  if (!ok) return

  const result = await nginxCall<{ imported: number }>('nginx:import-json', { payload })
  window.$toast?.success?.('已导入 ' + result.imported + ' 条路由')
  selectedId.value = ''
  await load()
})

const exportConfig = () => run(async () => {
  const payload = await nginxCall<any>('nginx:export')
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'devdock-nginx-' + stamp + '.json'
  anchor.click()
  URL.revokeObjectURL(url)
  window.$toast?.success?.('已导出 ' + (payload.routes || []).length + ' 条路由')
})


const settingsOpen = ref(false)
const nginxSettings = ref<any>(null)
const defaultHttpConfig = ref('')
const settingsDraft = ref({
  port: 18080,
  routesDir: '',
  logDir: ''
})

// --- 全局配置独立编辑层 ---
const httpConfigOpen = ref(false)
const httpConfigDraft = ref('')
const httpConfigRef = ref<HTMLTextAreaElement | null>(null)
const lineNumberRef = ref<HTMLElement | null>(null)

const lineNumbers = computed(() => {
  const count = httpConfigDraft.value.split('\n').length
  return Array.from({ length: Math.max(count, 1) }, (_, index) => index + 1).join('\n')
})

const openHttpConfig = () => {
  const current = nginxSettings.value || {}
  httpConfigDraft.value = current.customHttp || defaultHttpConfig.value
  httpConfigOpen.value = true
}

// 行号列跟随文本域滚动
const syncHttpScroll = () => {
  if (lineNumberRef.value && httpConfigRef.value) {
    lineNumberRef.value.scrollTop = httpConfigRef.value.scrollTop
  }
}

// Tab 插入制表符而不是切换焦点
const insertHttpTab = (event: KeyboardEvent) => {
  const el = event.target as HTMLTextAreaElement
  const start = el.selectionStart
  const end = el.selectionEnd
  const next = el.value.slice(0, start) + '\t' + el.value.slice(end)
  el.value = next
  el.selectionStart = start + 1
  el.selectionEnd = start + 1
  httpConfigDraft.value = next
}

const saveHttpConfig = () => run(async () => {
  const current = nginxSettings.value || {}
  await nginxCall('nginx:settings:save', { nginx: { ...current, customHttp: httpConfigDraft.value } })
  window.$toast?.success?.('全局配置已保存')
  httpConfigOpen.value = false
  await load()
})

const openSettings = () => {
  ensureHomeDir()
  const current = nginxSettings.value || {}
  settingsDraft.value = {
    port: current.port ?? 18080,
    routesDir: toDisplayPath(current.routesDir),
    logDir: toDisplayPath(current.logDir)
  }
  settingsOpen.value = true
}

const saveSettings = () => run(async () => {
  const current = nginxSettings.value || {}
  await nginxCall('nginx:settings:save', {
    nginx: {
      ...current,
      port: Number(settingsDraft.value.port) || current.port,
      routesDir: settingsDraft.value.routesDir.trim() || current.routesDir,
      logDir: settingsDraft.value.logDir.trim() || current.logDir
    }
  })
  window.$toast?.success?.('设置已保存')
  settingsOpen.value = false
  await load()
})

const variablesOpen = ref(false)

const saveVariables = (next: NginxVariable[]) => run(async () => {
  const current = nginxSettings.value || {}
  await nginxCall('nginx:settings:save', {
    nginx: {
      ...current,
      variables: next
        .map((item) => ({ name: item.name.trim(), value: item.value.trim() }))
        .filter((item) => item.name)
    }
  })
  window.$toast?.success?.('变量已保存')
  variablesOpen.value = false
  await load()
})

const openPath = (which: 'prefix' | 'routes' | 'logs' | 'conf') => run(async () => {
  await nginxCall('nginx:open-path', { which })
})

onMounted(() => run(load))
</script>

<template>
  <div class="flex h-screen flex-col bg-surface text-gray-100">
    <header class="flex items-center justify-between gap-4 border-b border-gray-700 bg-surface-raised px-4 py-3">
      <div class="flex min-w-0 items-center gap-3">
        <span
          class="h-2 w-2 shrink-0 rounded-full"
          :class="status?.running ? 'bg-green-500' : status?.installed ? 'bg-yellow-500' : 'bg-gray-600'"
        />
        <span class="text-xs" :class="status?.running ? 'text-green-400' : 'text-gray-400'">{{ runStateLabel }}</span>
        <span class="text-xs text-gray-400">端口 {{ status?.port ?? '—' }}</span>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <button class="flex items-center gap-1.5 rounded bg-surface px-3 py-2 text-xs text-gray-100 transition hover:bg-surface-hover disabled:opacity-50" :disabled="busy || !canTest" @click="runAction('nginx:validate')">
          <ShieldCheck class="h-3.5 w-3.5" />校验配置
        </button>
        <button class="flex items-center gap-1.5 rounded bg-surface px-3 py-2 text-xs text-gray-100 transition hover:bg-surface-hover disabled:opacity-50" :disabled="busy || !canReload" @click="runAction('nginx:reload')">
          <RotateCw class="h-3.5 w-3.5" />重载
        </button>
        <button class="flex items-center gap-1.5 rounded bg-surface px-3 py-2 text-xs text-gray-100 transition hover:bg-surface-hover disabled:opacity-50" :disabled="busy || !canStart" @click="runAction('nginx:start')">
          <Play class="h-3.5 w-3.5" />启动
        </button>
        <button class="flex items-center gap-1.5 rounded bg-surface px-3 py-2 text-xs text-gray-100 transition hover:bg-surface-hover disabled:opacity-50" :disabled="busy || !canStop" @click="runAction('nginx:stop')">
          <Square class="h-3.5 w-3.5" />停止
        </button>
        <button class="relative flex items-center gap-1.5 rounded bg-surface px-3 py-2 text-xs text-gray-100 transition hover:bg-surface-hover disabled:opacity-50" :disabled="busy" @click="variablesOpen = true">
          <Braces class="h-3.5 w-3.5" />变量
          <span v-if="missingVariables.length" class="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-blue-500" />
        </button>
        <button class="flex items-center gap-1.5 rounded bg-surface px-3 py-2 text-xs text-gray-100 transition hover:bg-surface-hover disabled:opacity-50" :disabled="busy" @click="openHttpConfig">
          全局配置
        </button>
        <button class="flex items-center gap-1.5 rounded bg-surface px-3 py-2 text-xs text-gray-100 transition hover:bg-surface-hover disabled:opacity-50" :disabled="busy" @click="openSettings">
          <Settings class="h-3.5 w-3.5" />设置
        </button>
        <button class="rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-blue-500" @click="$router.push('/dashboard')">返回项目</button>
      </div>
    </header>

    <main class="grid min-h-0 flex-1 grid-cols-[340px_1fr]">
      <aside class="flex min-h-0 flex-col border-r border-gray-700 bg-surface-raised">
        <div class="border-b border-gray-700 p-3">
          <div class="relative">
            <Search class="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
            <input
              v-model="search"
              class="w-full rounded border border-gray-700 bg-surface py-1.5 pl-7 pr-2 text-xs text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
              placeholder="搜索路径或目标"
            />
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto">
          <div
            v-for="route in filtered"
            :key="route.id"
            class="flex cursor-pointer items-center gap-2 border-b border-gray-700/60 px-3 py-2 transition hover:bg-surface-hover"
            :class="route.id === selectedId ? 'bg-surface-hover' : ''"
            @click="select(route.id)"
          >
            <div class="min-w-0 flex-1">
              <div class="truncate font-mono text-xs text-gray-100" :title="route.path">{{ route.path }}</div>
              <div class="truncate font-mono text-[10px] text-gray-500" :title="activeTarget(route)?.proxyPass || ''">{{ activeTarget(route)?.proxyPass || '' }}</div>
            </div>
          </div>
        </div>

        <div class="space-y-2 border-t border-gray-700 p-3">
          <button
            class="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-gray-600 px-3 py-2 text-xs text-blue-400 transition hover:border-blue-500 hover:bg-blue-500/10"
            @click="openCreate"
          >
            <Plus class="h-3.5 w-3.5" />新增配置
          </button>
          <button
            class="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-gray-600 px-3 py-2 text-xs text-blue-400 transition hover:border-blue-500 hover:bg-blue-500/10"
            @click="pickImportFile"
          >
            <Upload class="h-3.5 w-3.5" />导入配置
          </button>
          <button
            class="flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-gray-600 px-3 py-2 text-xs text-blue-400 transition hover:border-blue-500 hover:bg-blue-500/10"
            @click="exportConfig"
          >
            <Download class="h-3.5 w-3.5" />导出配置
          </button>
          <input ref="fileInput" type="file" accept=".json,application/json" class="hidden" @change="onImportFile" />
        </div>
      </aside>

      <section class="min-h-0 overflow-y-auto bg-surface p-4">
        <div v-if="selected" class="space-y-4">
          <div class="space-y-3 rounded border border-gray-700 bg-surface-raised p-4">
            <div class="flex items-center gap-2">
              <span class="min-w-0 flex-1 truncate font-mono text-sm text-gray-100" :title="selected.path">{{ selected.path }}</span>
              <button
                class="flex shrink-0 items-center gap-1.5 rounded border border-gray-700 bg-surface-raised px-2 py-1 text-xs text-red-400 transition hover:bg-surface-hover disabled:opacity-50"
                :disabled="busy"
                @click="removeRoute"
              >
                <Trash2 class="h-3.5 w-3.5" />删除
              </button>
              <button
                class="flex shrink-0 items-center gap-1.5 rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 transition hover:bg-surface-hover"
                @click="openEdit"
              >
                <Pencil class="h-3.5 w-3.5" />编辑
              </button>
              <button
                class="flex shrink-0 items-center gap-1.5 rounded bg-blue-600 px-2 py-1 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
                :disabled="busy"
                @click="saveRoute"
              >
                <Save class="h-3.5 w-3.5" />保存
              </button>
            </div>
            <label class="block text-xs text-gray-400">备注
              <input
                v-model="noteDraft"
                class="mt-1 block w-full rounded border border-gray-700 bg-surface px-2 py-1.5 text-sm text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
              />
            </label>
          </div>

          <div v-if="conflict" class="flex items-center justify-between gap-3 rounded border border-yellow-700/50 bg-yellow-900/20 px-3 py-2 text-xs text-yellow-300">
            <span class="min-w-0 truncate" :title="conflict.path">配置文件中该路径已被手工修改：{{ conflict.path }}</span>
            <div class="flex shrink-0 gap-2">
              <button class="rounded border border-yellow-700/60 px-2 py-0.5 text-[11px] text-yellow-200 transition hover:bg-yellow-900/40 disabled:opacity-50" :disabled="busy" @click="resolveConflict('overwrite')">覆盖</button>
              <button class="rounded border border-gray-600 px-2 py-0.5 text-[11px] text-gray-200 transition hover:bg-surface-hover disabled:opacity-50" :disabled="busy" @click="resolveConflict('adopt')">转为自定义</button>
            </div>
          </div>

          <div class="rounded border border-gray-700 bg-surface-raised p-4">
            <div class="space-y-1">
              <div
                v-for="target in selected.targets || []"
                :key="target.id"
                class="flex items-center gap-2 rounded px-2 py-1.5 transition hover:bg-surface-hover"
              >
                <input
                  type="radio"
                  class="shrink-0"
                  :checked="target.id === selected.activeTargetId"
                  @change="setActiveTarget(target.id)"
                />
                <div class="min-w-0 flex-1">
                  <div class="truncate text-xs text-gray-100" :title="target.label">{{ target.label }}</div>
                  <div class="truncate font-mono text-[10px] text-gray-500" :title="target.proxyPass">{{ target.proxyPass }}</div>
                </div>
                <button
                  class="shrink-0 rounded p-1 text-gray-500 transition hover:bg-surface-hover hover:text-red-400"
                  title="删除候选"
                  @click="removeTarget(target.id)"
                ><X class="h-3.5 w-3.5" /></button>
              </div>
            </div>

            <div v-if="addingTarget" class="mt-2 space-y-2 border-t border-gray-700 pt-2">
              <input v-model="newTarget.label" class="block w-full rounded border border-gray-700 bg-surface px-2 py-1.5 text-xs text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none" placeholder="label" />
              <input v-model="newTarget.proxyPass" class="block w-full rounded border border-gray-700 bg-surface px-2 py-1.5 font-mono text-xs text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none" placeholder="proxyPass" />
              <input v-model="newTarget.referer" class="block w-full rounded border border-gray-700 bg-surface px-2 py-1.5 font-mono text-xs text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none" placeholder="referer（可选）" />
              <div class="flex justify-end gap-2">
                <button class="rounded border border-gray-700 px-3 py-1 text-xs text-gray-300 transition hover:bg-surface-hover" @click="addingTarget = false">取消</button>
                <button class="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-50" :disabled="busy || !newTarget.label.trim() || !newTarget.proxyPass.trim()" @click="addTarget">添加</button>
              </div>
            </div>
            <button
              v-else
              class="mt-2 flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-gray-600 px-3 py-2 text-xs text-blue-400 transition hover:border-blue-500 hover:bg-blue-500/10"
              @click="startAddTarget"
            >
              <Plus class="h-3.5 w-3.5" />新增候选
            </button>
          </div>

        </div>
      </section>
    </main>

    <div v-if="settingsOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" @mousedown.self="settingsOpen = false">
      <div class="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-gray-700 bg-surface shadow-2xl">
        <div class="flex items-center justify-between border-b border-gray-700 bg-surface-raised p-4">
          <h3 class="text-sm font-semibold text-gray-100">Nginx 设置</h3>
          <button class="px-2 text-gray-400 transition hover:text-gray-100" @click="settingsOpen = false"><X class="h-4 w-4" /></button>
        </div>
        <div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <div class="flex items-center gap-3">
            <span class="w-16 shrink-0 text-xs text-gray-400">端口</span>
            <input
              v-model.number="settingsDraft.port"
              type="number"
              class="w-28 rounded border border-gray-700 bg-surface-sunken px-3 py-1.5 font-mono text-xs text-gray-100 focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div class="border-t border-gray-700 pt-4">
            <label class="block">
              <span class="mb-1 block text-xs text-gray-400">路由目录</span>
              <div class="flex gap-2">
                <input
                  v-model="settingsDraft.routesDir"
                  class="min-w-0 flex-1 rounded border border-gray-700 bg-surface-sunken px-3 py-2 font-mono text-xs text-gray-100 focus:border-blue-500 focus:outline-none"
                />
                <button class="shrink-0 rounded border border-gray-700 px-2 text-gray-300 transition hover:bg-surface-hover" @click="openPath('routes')"><FolderOpen class="h-3.5 w-3.5" /></button>
              </div>
            </label>
            <label class="mt-3 block">
              <span class="mb-1 block text-xs text-gray-400">日志目录</span>
              <div class="flex gap-2">
                <input
                  v-model="settingsDraft.logDir"
                  class="min-w-0 flex-1 rounded border border-gray-700 bg-surface-sunken px-3 py-2 font-mono text-xs text-gray-100 focus:border-blue-500 focus:outline-none"
                />
                <button class="shrink-0 rounded border border-gray-700 px-2 text-gray-300 transition hover:bg-surface-hover" @click="openPath('logs')"><FolderOpen class="h-3.5 w-3.5" /></button>
              </div>
            </label>
          </div>


          <div class="flex justify-end gap-2 border-t border-gray-700 pt-4">
            <button class="rounded border border-gray-700 px-4 py-2 text-sm text-gray-300 transition hover:bg-surface-hover" @click="settingsOpen = false">取消</button>
            <button class="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50" :disabled="busy" @click="saveSettings">保存</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="httpConfigOpen" class="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-sm" @mousedown.self="httpConfigOpen = false">
      <div class="flex h-[82vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-gray-700 bg-surface shadow-2xl">
        <div class="flex items-center justify-between border-b border-gray-700 bg-surface-raised p-4">
          <h3 class="text-sm font-semibold text-gray-100">全局配置</h3>
          <button class="px-2 text-gray-400 transition hover:text-gray-100" @click="httpConfigOpen = false"><X class="h-4 w-4" /></button>
        </div>
        <div class="min-h-0 flex-1 p-4">
          <div class="flex h-full overflow-hidden rounded border border-gray-700 bg-surface-sunken">
            <pre ref="lineNumberRef" class="shrink-0 select-none overflow-hidden border-r border-gray-700 px-2 py-2 text-right font-mono text-xs leading-relaxed text-gray-500">{{ lineNumbers }}</pre>
            <textarea
              ref="httpConfigRef"
              v-model="httpConfigDraft"
              spellcheck="false"
              wrap="off"
              class="min-w-0 flex-1 resize-none bg-transparent px-3 py-2 font-mono text-xs leading-relaxed text-gray-100 focus:outline-none"
              style="tab-size: 2; white-space: pre;"
              @keydown.tab.prevent="insertHttpTab"
              @scroll="syncHttpScroll"
            ></textarea>
          </div>
        </div>
        <div class="flex items-center justify-between gap-2 border-t border-gray-700 p-4">
          <span class="text-[11px] text-gray-500">缩进由保存时自动处理</span>
          <div class="flex gap-2">
            <button class="rounded border border-gray-700 px-4 py-2 text-sm text-gray-300 transition hover:bg-surface-hover" @click="httpConfigOpen = false">取消</button>
            <button class="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50" :disabled="busy" @click="saveHttpConfig">保存</button>
          </div>
        </div>
      </div>
    </div>

    <VariablesDialog
      v-if="variablesOpen"
      :variables="variables"
      :routes="routes"
      :missing="missingVariables"
      @save="saveVariables"
      @close="variablesOpen = false"
    />

    <RouteEditor
      v-if="editorOpen && editorRoute"
      :route="editorRoute"
      :variables="variables"
      :missing-variables="missingVariables"
      @save="submitRoute"
      @close="closeEditor"
    />
  </div>
</template>
