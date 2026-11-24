<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" @mousedown.self="emit('close')">
    <div class="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-gray-700 bg-surface shadow-2xl">
      <div class="flex items-center justify-between border-b border-gray-700 bg-surface-raised p-4">
        <h3 class="flex items-center gap-2 text-sm font-semibold text-gray-100">
          <GitBranch class="h-4 w-4 text-sky-400" />分支管理
        </h3>
        <button class="px-2 text-gray-400 transition hover:text-gray-100" @click="emit('close')"><X class="h-4 w-4" /></button>
      </div>

      <div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div class="flex items-center gap-2 text-xs text-gray-400">
          <span class="w-16 shrink-0">当前分支</span>
          <span class="rounded bg-surface-raised px-2 py-0.5 font-mono text-gray-100">{{ current || '—' }}</span>
        </div>

        <div class="border-t border-gray-700 pt-4">
          <span class="mb-1 block text-xs text-gray-400">基于当前分支新建</span>
          <div class="flex gap-2">
            <input
              v-model="newBranch"
              type="text"
              spellcheck="false"
              autocomplete="off"
              placeholder="feature/xxx"
              class="min-w-0 flex-1 rounded border border-gray-700 bg-surface-sunken px-3 py-1.5 font-mono text-xs text-gray-100 placeholder:text-gray-500 focus:border-sky-500 focus:outline-none"
              @keydown.enter="createBranch"
            />
            <button
              class="shrink-0 rounded bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-sky-500 disabled:opacity-50"
              :disabled="busy || !newBranch.trim()"
              @click="createBranch"
            >创建并切换</button>
          </div>
        </div>

        <div v-if="fetchError" class="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-300">
          远端分支可能不是最新的：{{ fetchError }}
        </div>

        <div v-if="loading" class="py-6 text-center text-xs text-gray-500">加载中…</div>

        <template v-else>
          <div class="border-t border-gray-700 pt-4">
            <span class="mb-2 block text-xs text-gray-400">本地分支（{{ local.length }}）</span>
            <div class="space-y-1">
              <button
                v-for="name in local"
                :key="'local-' + name"
                class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-mono text-xs transition hover:bg-surface-hover disabled:opacity-50"
                :class="name === current ? 'text-sky-300' : 'text-gray-200'"
                :disabled="busy || name === current"
                @click="switchTo(name, false)"
              >
                <span class="min-w-0 flex-1 truncate">{{ name }}</span>
                <span v-if="name === current" class="shrink-0 text-[10px] text-gray-500">当前</span>
              </button>
            </div>
          </div>

          <div v-if="remote.length" class="border-t border-gray-700 pt-4">
            <span class="mb-2 block text-xs text-gray-400">远端分支（{{ remote.length }}）</span>
            <div class="space-y-1">
              <button
                v-for="name in remote"
                :key="'remote-' + name"
                class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-mono text-xs text-gray-200 transition hover:bg-surface-hover disabled:opacity-50"
                :disabled="busy"
                @click="switchTo(name, true)"
              >
                <span class="min-w-0 flex-1 truncate">{{ name }}</span>
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { GitBranch, X } from 'lucide-vue-next';
import { socket } from '../utils/socket';
import { useEscapeKey } from '../utils/useEscapeKey';

const props = defineProps<{ projectPath: string }>();
const emit = defineEmits<{ close: []; changed: [] }>();

useEscapeKey(() => emit('close'));

const current = ref('');
const local = ref<string[]>([]);
const remote = ref<string[]>([]);
const fetchError = ref('');
const loading = ref(true);
const busy = ref(false);
const newBranch = ref('');

const applyResult = (result: any) => {
  current.value = result.current || '';
  local.value = result.local || [];
  remote.value = result.remote || [];
  fetchError.value = result.fetchError || '';
};

const load = (fetch = true) => {
  loading.value = true;
  socket.emit('git:branches', { projectPath: props.projectPath, fetch }, (result: any) => {
    loading.value = false;
    if (!result || result.success === false) {
      window.$toast?.warning?.(result?.error || '读取分支失败');
      return;
    }
    applyResult(result);
  });
};

onMounted(() => load(true));

const switchTo = (name: string, isRemote: boolean) => {
  if (busy.value) return;
  busy.value = true;
  socket.emit('git:checkout', { projectPath: props.projectPath, branch: name, isRemote }, (result: any) => {
    busy.value = false;
    if (!result || result.success === false) {
      window.$toast?.warning?.(result?.error || '切换分支失败');
      return;
    }
    window.$toast?.success?.('已切换到 ' + result.current);
    emit('changed');
    load(false);
  });
};

const createBranch = () => {
  const name = newBranch.value.trim();
  if (!name || busy.value) return;
  busy.value = true;
  socket.emit('git:create-branch', { projectPath: props.projectPath, branch: name }, (result: any) => {
    busy.value = false;
    if (!result || result.success === false) {
      window.$toast?.warning?.(result?.error || '创建分支失败');
      return;
    }
    newBranch.value = '';
    window.$toast?.success?.('已创建并切换到 ' + result.current);
    emit('changed');
    load(false);
  });
};
</script>
