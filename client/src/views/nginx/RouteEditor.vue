<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { Braces, Plus, X } from 'lucide-vue-next'
import type { NginxRoute, NginxVariable } from '../../utils/nginx'

const props = defineProps<{
  route: NginxRoute
  variables: NginxVariable[]
  missingVariables: string[]
}>()

const emit = defineEmits<{
  save: [route: NginxRoute]
  close: []
}>()

type TargetField = 'proxyPass' | 'referer'

const clone = (route: NginxRoute): NginxRoute => ({
  id: route.id || '',
  path: route.path || '',
  note: route.note || '',
  enabled: route.enabled !== false,
  kind: route.kind === 'raw' ? 'raw' : 'proxy',
  activeTargetId: route.activeTargetId || '',
  targets: (route.targets || []).map((target) => ({
    id: target.id || '',
    label: target.label || '',
    proxyPass: target.proxyPass || '',
    referer: target.referer || ''
  })),
  headers: {
    httpVersion: route.headers?.httpVersion !== false,
    host: route.headers?.host !== false,
    upgrade: route.headers?.upgrade !== false,
    connection: route.headers?.connection !== false
  },
  others: (route.others || []).map((item) => ({ name: item.name || '', value: item.value || '' })),
  rawBody: route.rawBody || ''
})

const draft = ref<NginxRoute>(clone(props.route))

const tokenOf = (name: string) => '$' + '{' + name + '}'

const menuIndex = ref(-1)
const menuField = ref<TargetField>('proxyPass')
const caret = ref<{ index: number; field: TargetField; start: number; el: HTMLInputElement | null } | null>(null)

const rememberCaret = (index: number, field: TargetField, event: Event) => {
  const el = event.target as HTMLInputElement | null
  caret.value = { index, field, start: el?.selectionStart ?? 0, el }
}

const toggleMenu = (index: number, field: TargetField) => {
  if (menuIndex.value === index) {
    menuIndex.value = -1
    return
  }
  menuIndex.value = index
  menuField.value = field
}

const insertVariable = async (name: string) => {
  const index = menuIndex.value
  const field = menuField.value
  const target = draft.value.targets[index]
  if (!target) return

  const token = tokenOf(name)
  const value = target[field] || ''
  const remembered = caret.value
  const start = remembered && remembered.index === index && remembered.field === field
    ? Math.min(Math.max(remembered.start, 0), value.length)
    : value.length
  target[field] = value.slice(0, start) + token + value.slice(start)

  const el = remembered?.el ?? null
  menuIndex.value = -1
  await nextTick()
  if (el) {
    el.focus()
    const pos = start + token.length
    el.setSelectionRange(pos, pos)
    caret.value = { index, field, start: pos, el }
  }
}

let targetSeq = 0
const addTarget = () => {
  targetSeq += 1
  const id = 'target-' + Date.now().toString(36) + '-' + targetSeq
  draft.value.targets.push({ id, label: '', proxyPass: '', referer: '' })
  if (!draft.value.activeTargetId) draft.value.activeTargetId = id
}

const removeTarget = (index: number) => {
  const [removed] = draft.value.targets.splice(index, 1)
  if (removed && draft.value.activeTargetId === removed.id) {
    draft.value.activeTargetId = draft.value.targets[0]?.id || ''
  }
  if (menuIndex.value === index) menuIndex.value = -1
}

const addOther = () => {
  draft.value.others.push({ name: '', value: '' })
}

const canSave = computed(() => Boolean(draft.value.path.trim()))

const submit = () => {
  if (!canSave.value) return
  emit('save', {
    ...draft.value,
    path: draft.value.path.trim(),
    note: draft.value.note.trim(),
    targets: draft.value.targets.map((target) => ({
      ...target,
      label: target.label.trim(),
      proxyPass: target.proxyPass.trim(),
      referer: target.referer.trim()
    })),
    others: draft.value.others.map((item) => ({ name: item.name.trim(), value: item.value.trim() }))
  })
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" @mousedown.self="emit('close')">
    <div class="w-full max-w-4xl overflow-hidden rounded-lg border border-gray-700 bg-surface shadow-2xl">
      <div class="flex items-center justify-between border-b border-gray-700 bg-surface-raised p-4">
        <h3 class="text-sm font-semibold text-gray-100">{{ draft.id ? '编辑路由' : '新增路由' }}</h3>
        <button class="px-2 text-gray-400 transition hover:text-gray-100" @click="emit('close')"><X class="h-4 w-4" /></button>
      </div>

      <div class="max-h-[70vh] space-y-4 overflow-y-auto p-4">
        <label class="block">
          <span class="mb-1 block text-xs text-gray-400">路径</span>
          <input
            v-model="draft.path"
            class="w-full rounded border border-gray-700 bg-surface-sunken px-3 py-2 font-mono text-xs text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
          />
        </label>

        <label class="block">
          <span class="mb-1 block text-xs text-gray-400">类型</span>
          <select
            v-model="draft.kind"
            class="w-full rounded border border-gray-700 bg-surface-sunken px-3 py-2 text-xs text-gray-100 focus:border-blue-500 focus:outline-none"
          >
            <option value="proxy">代理</option>
            <option value="raw">原始块</option>
          </select>
        </label>

        <label class="block">
          <span class="mb-1 block text-xs text-gray-400">备注</span>
          <input
            v-model="draft.note"
            class="w-full rounded border border-gray-700 bg-surface-sunken px-3 py-2 text-xs text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
          />
        </label>

        <template v-if="draft.kind === 'proxy'">
        <div class="border-t border-gray-700 pt-4">
          <span class="mb-2 block text-xs text-gray-400">固定头</span>
          <div class="space-y-1.5">
            <label class="flex items-center gap-2 text-xs text-gray-300">
              <input v-model="draft.headers.httpVersion" type="checkbox" class="h-3.5 w-3.5 rounded border-gray-600 bg-surface-sunken" />
              <span class="w-52 shrink-0 font-mono">proxy_http_version</span>
              <span class="font-mono text-gray-500">1.1</span>
            </label>
            <label class="flex items-center gap-2 text-xs text-gray-300">
              <input v-model="draft.headers.host" type="checkbox" class="h-3.5 w-3.5 rounded border-gray-600 bg-surface-sunken" />
              <span class="w-52 shrink-0 font-mono">proxy_set_header Host</span>
              <span class="font-mono text-gray-500">$host</span>
            </label>
            <label class="flex items-center gap-2 text-xs text-gray-300">
              <input v-model="draft.headers.upgrade" type="checkbox" class="h-3.5 w-3.5 rounded border-gray-600 bg-surface-sunken" />
              <span class="w-52 shrink-0 font-mono">proxy_set_header Upgrade</span>
              <span class="font-mono text-gray-500">$http_upgrade</span>
            </label>
            <label class="flex items-center gap-2 text-xs text-gray-300">
              <input v-model="draft.headers.connection" type="checkbox" class="h-3.5 w-3.5 rounded border-gray-600 bg-surface-sunken" />
              <span class="w-52 shrink-0 font-mono">proxy_set_header Connection</span>
              <span class="font-mono text-gray-500">"upgrade"</span>
            </label>
          </div>
        </div>

        <div class="border-t border-gray-700 pt-4">
          <span class="mb-2 block text-xs text-gray-400">高级配置</span>
          <div class="space-y-2">
            <div v-for="(item, index) in draft.others" :key="index" class="flex items-center gap-2">
              <input
                v-model="item.name"
                class="w-40 shrink-0 rounded border border-gray-700 bg-surface-sunken px-2 py-1.5 font-mono text-xs text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
                placeholder="指令"
              />
              <input
                v-model="item.value"
                class="min-w-0 flex-1 rounded border border-gray-700 bg-surface-sunken px-2 py-1.5 font-mono text-xs text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
                placeholder="值"
              />
              <button
                class="shrink-0 rounded p-1 text-gray-500 transition hover:bg-surface-hover hover:text-red-400"
                title="删除指令"
                @click="draft.others.splice(index, 1)"
              ><X class="h-3.5 w-3.5" /></button>
            </div>
          </div>
          <button
            class="mt-2 flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-gray-600 px-3 py-2 text-xs text-blue-400 transition hover:border-blue-500 hover:bg-blue-500/10"
            @click="addOther"
          >
            <Plus class="h-3.5 w-3.5" />新增指令
          </button>
        </div>

        <div class="border-t border-gray-700 pt-4">
          <span class="mb-2 block text-xs text-gray-400">目标候选</span>
          <div class="space-y-2">
            <div
              v-for="(target, index) in draft.targets"
              :key="target.id || index"
              class="rounded border border-gray-700 bg-surface-raised p-2"
            >
              <div class="flex items-center gap-2">
                <input
                  v-model="draft.activeTargetId"
                  type="radio"
                  class="shrink-0"
                  :value="target.id"
                />
                <input
                  v-model="target.label"
                  class="w-32 shrink-0 rounded border border-gray-700 bg-surface-sunken px-2 py-1.5 text-xs text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
                  placeholder="label"
                />
                <input
                  v-model="target.proxyPass"
                  class="min-w-0 flex-1 rounded border border-gray-700 bg-surface-sunken px-2 py-1.5 font-mono text-xs text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
                  placeholder="proxyPass"
                  @focus="rememberCaret(index, 'proxyPass', $event)"
                  @click="rememberCaret(index, 'proxyPass', $event)"
                  @keyup="rememberCaret(index, 'proxyPass', $event)"
                />
                <button
                  v-if="variables.length"
                  class="shrink-0 rounded p-1 text-gray-400 transition hover:bg-surface-hover hover:text-blue-400"
                  title="插入变量"
                  @mousedown.prevent
                  @click="toggleMenu(index, 'proxyPass')"
                ><Braces class="h-3.5 w-3.5" /></button>
                <input
                  v-model="target.referer"
                  class="min-w-0 flex-1 rounded border border-gray-700 bg-surface-sunken px-2 py-1.5 font-mono text-xs text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
                  placeholder="referer"
                  @focus="rememberCaret(index, 'referer', $event)"
                  @click="rememberCaret(index, 'referer', $event)"
                  @keyup="rememberCaret(index, 'referer', $event)"
                />
                <button
                  v-if="variables.length"
                  class="shrink-0 rounded p-1 text-gray-400 transition hover:bg-surface-hover hover:text-blue-400"
                  title="插入变量"
                  @mousedown.prevent
                  @click="toggleMenu(index, 'referer')"
                ><Braces class="h-3.5 w-3.5" /></button>
                <button
                  class="shrink-0 rounded p-1 text-gray-500 transition hover:bg-surface-hover hover:text-red-400"
                  title="删除候选"
                  @click="removeTarget(index)"
                ><X class="h-3.5 w-3.5" /></button>
              </div>
              <div v-if="menuIndex === index" class="mt-2 flex flex-wrap gap-1 border-t border-gray-700 pt-2">
                <button
                  v-for="variable in variables"
                  :key="variable.name"
                  class="rounded border border-gray-700 bg-surface px-2 py-0.5 font-mono text-[11px] text-blue-400 transition hover:bg-surface-hover"
                  :title="variable.value"
                  @click="insertVariable(variable.name)"
                >{{ tokenOf(variable.name) }}</button>
              </div>
            </div>
          </div>
          <button
            class="mt-2 flex w-full items-center justify-center gap-1.5 rounded border border-dashed border-gray-600 px-3 py-2 text-xs text-blue-400 transition hover:border-blue-500 hover:bg-blue-500/10"
            @click="addTarget"
          >
            <Plus class="h-3.5 w-3.5" />新增候选
          </button>
        </div>
        </template>

        <template v-else>
          <label class="block border-t border-gray-700 pt-4">
            <span class="mb-1 block text-xs text-gray-400">location 块内容</span>
            <textarea
              v-model="draft.rawBody"
              rows="10"
              spellcheck="false"
              class="w-full resize-y rounded border border-gray-700 bg-surface-sunken px-3 py-2 font-mono text-xs leading-relaxed text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
              placeholder="proxy_pass http://127.0.0.1:8080;"
            ></textarea>
          </label>
        </template>
      </div>

      <div class="flex justify-end gap-2 border-t border-gray-700 p-4">
        <button class="rounded border border-gray-700 px-4 py-2 text-sm text-gray-300 transition hover:bg-surface-hover" @click="emit('close')">取消</button>
        <button
          class="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
          :disabled="!canSave"
          @click="submit"
        >保存</button>
      </div>
    </div>
  </div>
</template>
