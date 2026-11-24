<script setup lang="ts">
import { computed, ref } from 'vue'
import { Copy, Plus, Search, X } from 'lucide-vue-next'
import type { NginxRoute, NginxVariable } from '../../utils/nginx'
import { useEscapeKey } from '../../utils/useEscapeKey'

const props = defineProps<{
  variables: NginxVariable[]
  routes: NginxRoute[]
  missing: string[]
}>()

const emit = defineEmits<{
  save: [variables: NginxVariable[]]
  close: []
}>()

useEscapeKey(() => emit('close'))

type Row = NginxVariable & { key: number }

let seq = 0
const toRow = (item: NginxVariable): Row => ({
  key: (seq += 1),
  name: item.name || '',
  value: item.value || ''
})

const draft = ref<Row[]>(props.variables.map((item) => toRow(item)))
const search = ref('')

const tokenOf = (name: string) => '$' + '{' + name + '}'

const rows = computed(() => {
  const indexed = draft.value.map((item, index) => ({ item, index }))
  const keyword = search.value.trim().toLowerCase()
  if (!keyword) return indexed
  return indexed.filter(({ item }) =>
    item.name.toLowerCase().includes(keyword) || item.value.toLowerCase().includes(keyword)
  )
})

const referenceCount = (name: string) => {
  if (!name) return 0
  const token = tokenOf(name)
  return props.routes.filter((route) =>
    (route.targets || []).some(
      (target) => String(target.proxyPass || '').includes(token) || String(target.referer || '').includes(token)
    ) || (route.others || []).some((item) => String(item.value || '').includes(token))
  ).length
}

const addVariable = () => {
  draft.value.push(toRow({ name: '', value: '' }))
}

const copyToken = async (name: string) => {
  const token = tokenOf(name)
  await navigator.clipboard?.writeText(token)
  window.$toast?.success?.('已复制 ' + token)
}

const submit = () => {
  emit('save', draft.value.map((item) => ({ name: item.name.trim(), value: item.value.trim() })))
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" @mousedown.self="emit('close')">
    <div class="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-gray-700 bg-surface shadow-2xl">
      <div class="flex items-center justify-between border-b border-gray-700 bg-surface-raised p-4">
        <h3 class="text-sm font-semibold text-gray-100">变量</h3>
        <button class="px-2 text-gray-400 transition hover:text-gray-100" @click="emit('close')"><X class="h-4 w-4" /></button>
      </div>

      <div class="flex items-center gap-2 p-4 pb-2">
        <div class="relative min-w-0 flex-1">
          <Search class="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-500" />
          <input
            v-model="search"
            class="w-full rounded border border-gray-700 bg-surface-sunken py-1.5 pl-7 pr-2 text-xs text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
            placeholder="搜索变量"
          />
        </div>
        <button
          class="flex shrink-0 items-center gap-1.5 rounded border border-dashed border-gray-700 px-3 py-1.5 text-xs text-blue-400 transition hover:bg-surface-hover"
          @click="addVariable"
        >
          <Plus class="h-3.5 w-3.5" />新增变量
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-4">
        <div class="sticky top-0 grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_3rem_3.5rem] items-center gap-2 bg-surface py-2 text-xs text-gray-400">
          <span>变量名</span>
          <span>值</span>
          <span>引用</span>
          <span>操作</span>
        </div>
        <div
          v-for="row in rows"
          :key="row.item.key"
          class="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)_3rem_3.5rem] items-center gap-2 pb-2"
        >
          <input
            v-model="row.item.name"
            class="w-full rounded border border-gray-700 bg-surface-sunken px-2 py-1.5 font-mono text-xs text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
            placeholder="变量名"
          />
          <input
            v-model="row.item.value"
            class="w-full rounded border border-gray-700 bg-surface-sunken px-2 py-1.5 font-mono text-xs text-gray-100 placeholder:text-gray-500 focus:border-blue-500 focus:outline-none"
            placeholder="值"
          />
          <span
            class="font-mono text-xs tabular-nums"
            :class="referenceCount(row.item.name) ? 'text-gray-300' : 'text-gray-500'"
          >{{ referenceCount(row.item.name) }}</span>
          <div class="flex items-center gap-1">
            <button
              class="rounded p-1 text-gray-400 transition hover:bg-surface-hover hover:text-blue-400"
              :title="'复制 ' + tokenOf(row.item.name)"
              @click="copyToken(row.item.name)"
            ><Copy class="h-3.5 w-3.5" /></button>
            <button
              class="rounded p-1 text-gray-500 transition hover:bg-surface-hover hover:text-gray-100"
              title="删除变量"
              @click="draft.splice(row.index, 1)"
            ><X class="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </div>

      <div class="border-t border-gray-700 p-4">
        <p v-if="missing.length" class="mb-3 font-mono text-[11px] text-blue-400">未定义：{{ missing.join(', ') }}</p>
        <div class="flex justify-end gap-2">
          <button class="rounded border border-gray-700 px-4 py-2 text-sm text-gray-300 transition hover:bg-surface-hover" @click="emit('close')">取消</button>
          <button class="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500" @click="submit">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>
