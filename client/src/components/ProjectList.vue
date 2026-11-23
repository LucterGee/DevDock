<template>
  <div class="project-list-container">
    <div v-if="projects.length === 0" class="flex flex-col items-center justify-center h-64 text-gray-500">
      <div class="mb-4 opacity-50"><FolderOpen class="w-10 h-10" /></div>
      <p>暂无项目</p>
    </div>

    <div class="flex flex-col gap-3">
      <div
        v-for="p in projects"
        :key="p.path"
        :ref="(el) => setCardRef(el, p.path)"
        class="flex flex-col transition bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden hover:border-blue-500/30 scroll-mt-24"
      >
        <!-- Title 行：点击空白处或右侧箭头切换展开 -->
        <div
          class="flex items-center gap-3 px-4 py-3 cursor-pointer select-none transition hover:bg-gray-700/20"
          @click="togglePanel(p)"
        >
          <div
            :class="[
              'w-2.5 h-2.5 rounded-full shrink-0 transition-all duration-300',
              hasRunningScripts(p) ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-gray-600'
            ]"
          ></div>

          <div class="flex flex-col min-w-0 flex-1">
            <div class="flex items-center gap-2 min-w-0">
              <span class="font-mono text-base font-bold text-gray-200 truncate" :title="p.name">{{ p.name }}</span>
              <span
                v-if="isHidden(p.path)"
                class="shrink-0 text-[10px] bg-yellow-900/30 text-yellow-500 px-1.5 py-0.5 rounded border border-yellow-800/50"
              >HIDDEN</span>
            </div>
            <div class="text-[10px] text-gray-500 truncate" :title="p.path">
              {{ p.path.split(/[\\/]/).slice(-2).join('/') }}
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <span :class="['text-[10px] px-1.5 py-0.5 rounded border font-mono uppercase', getRunnerBadgeStyle(p.runner)]">
              {{ p.runner }}
            </span>
            <span
              v-if="nvmDetected"
              :class="['text-[10px] px-1.5 py-0.5 rounded border font-mono', getNodeVersionBadgeStyle(p.nodeVersionSource)]"
              :title="getNodeVersionTooltip(p)"
            >
              {{ getNodeVersionLabel(p) }}
            </span>
          </div>

          <div class="flex items-center gap-1 shrink-0">
            <button
              @click.stop="$emit('open-folder', p.path)"
              title="在资源管理器中打开"
              class="p-1.5 text-gray-500 transition rounded hover:bg-gray-700 hover:text-blue-400"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 2H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"></path><path d="M2 10h20"></path></svg>
            </button>
            <button
              @click.stop="$emit('open-terminal', p.path)"
              title="在终端中打开"
              class="p-1.5 text-gray-500 transition rounded hover:bg-gray-700 hover:text-green-400"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>
            </button>
            <button
              @click.stop="$emit('open-in-editor', p.path)"
              title="用编辑器打开"
              class="p-1.5 text-gray-500 transition rounded hover:bg-gray-700 hover:text-blue-400"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
            </button>
            <button
              @click.stop="$emit('toggle-hide', p)"
              :title="!isHidden(p.path) ? '隐藏' : '退出隐藏'"
              class="p-1.5 text-gray-500 transition rounded hover:bg-gray-700 hover:text-red-400"
            >
              <svg v-if="!isHidden(p.path)" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="size-4">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
            </button>
            <button
              @click.stop="togglePanel(p)"
              :title="isExpanded(p) ? '收起' : '展开'"
              class="p-1.5 text-gray-500 transition rounded hover:bg-gray-700 hover:text-gray-100"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
                :class="['transition-transform duration-200', isExpanded(p) ? 'rotate-180' : '']"
              ><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
          </div>
        </div>

        <!-- 面板：同一时间只展开一个；首次展开后常驻，仅用 v-show 切换，
             否则 TerminalView 被卸载会丢失 AI 诊断等内部状态 -->
        <template v-if="hasBeenOpened(p)">
        <div v-show="isExpanded(p)" class="flex flex-col border-t border-gray-700/60">

        <div class="px-4 py-3 bg-surface-sunken flex flex-wrap gap-2 items-center border-b border-gray-700/50 min-h-[50px]">
          <button
            v-for="(cmd, key) in p.scripts"
            :key="key"
            @click="handleScriptClick(p, key)"
            :disabled="p.runningScripts?.[key]"
            :class="[
              'px-3 py-1 text-xs font-bold rounded transition text-white shadow-sm border border-transparent',
              p.runningScripts?.[key]
                ? 'bg-green-600 cursor-default opacity-80'
                : 'bg-blue-600 hover:bg-blue-500 hover:border-blue-400'
            ]"
          >
            <span v-if="p.runningScripts?.[key]" class="flex items-center gap-1">
              <span class="animate-pulse">●</span> {{ key }}
            </span>
            <span v-else>{{ key }}</span>
          </button>

          <span v-if="!Object.keys(p.scripts || {}).length" class="text-xs text-gray-500">
            该项目 package.json 未定义脚本
          </span>
          </div>

          <!-- 第二行：Node 版本 / 微信工具 / Git / KILL -->
          <div class="px-4 py-2.5 bg-surface-sunken flex flex-wrap gap-2 items-center border-b border-gray-700/50">
          <select
            v-if="nvmDetected && installedNodeVersions.length > 0"
            :value="p.nodeVersionOverride || (p.nodeVersionSource === 'auto' ? 'auto' : 'system')"
            @change="emit('node-version-change', p, $event.target.value)"
            class="px-2 py-1 text-[10px] font-mono bg-gray-800 border border-gray-600 rounded text-gray-300 focus:outline-none focus:border-blue-500 cursor-pointer max-w-[140px]"
            title="选择 Node 版本"
          >
            <option value="auto">
              {{ p.detectedNodeVersion ? `自动 (${p.detectedNodeVersion.raw})` : '自动检测' }}
            </option>
            <option value="system">系统默认</option>
            <option v-for="v in installedNodeVersions" :key="v" :value="v">
              v{{ v }}
            </option>
          </select>

          <button
            @click="emit('open-wechat-devtools', p)"
            :disabled="!canOpenWechatDevtools(p)"
            :title="getWechatDevtoolsTooltip(p)"
            class="flex items-center gap-1 px-3 py-1 text-xs font-bold transition border rounded border-emerald-700/50"
            :class="canOpenWechatDevtools(p) ? 'text-emerald-200 bg-emerald-900/30 hover:bg-emerald-600 hover:text-white' : 'text-gray-500 bg-gray-900/40 cursor-not-allowed opacity-70'"
          >
            <span>W</span> 微信工具
          </button>

          <button
            @click="handleAiCommit(p)"
            class="flex items-center gap-1 px-3 py-1 text-xs font-bold text-purple-300 transition border rounded bg-purple-900/30 hover:bg-purple-600 hover:text-white border-purple-800/50"
            title="AI 生成提交信息并提交"
          >
            <Sparkles class="w-3.5 h-3.5" /> Git
          </button>

          <button
            v-if="hasRunningScripts(p)"
            @click="$emit('stop', p)"
            title="强制杀死进程"
            class="flex items-center gap-1 px-3 py-1 text-xs font-bold text-red-400 transition border rounded bg-red-900/30 hover:bg-red-600 hover:text-white border-red-800/50"
          >
            <Skull class="w-3.5 h-3.5" /> KILL
          </button>
        </div>

        <div v-if="stats[p.path]" class="px-4 py-2 border-b bg-gray-900/80 border-gray-700/50">
          <div class="flex items-center mb-1 text-xs whitespace-nowrap">
            <span class="w-8 text-gray-400">CPU</span>
            <div class="flex-1 h-1.5 mx-2 bg-gray-700 rounded-full overflow-hidden">
              <div 
                class="h-full transition-all duration-300 bg-red-500" 
                :style="{ width: Math.min(stats[p.path].cpu, 100) + '%' }"
              ></div>
            </div>
            <span class="w-12 font-mono text-right text-red-400">{{ stats[p.path].cpu }}%</span>
          </div>
          <div class="flex items-center text-xs whitespace-nowrap">
            <span class="w-8 text-gray-400">MEM</span>
            <div class="flex-1 h-1.5 mx-2 bg-gray-700 rounded-full overflow-hidden">
              <div 
              class="h-full transition-all duration-300 bg-blue-500" 
              :style="{ width: calcMemPercent(stats[p.path].memory) + '%' }"
              ></div>
            </div>
            <span class="w-12 font-mono text-right text-blue-400 white-nowrap">{{ formatBytes(stats[p.path].memory) }}</span>
          </div>
        </div>

        <TerminalView :id="p.name" :logs="logs[p.name] || []" :project-path="p.path" @open-file="(uri) => $emit('open-file', uri)">
        <!-- 命令行：Enter 执行；运行中禁止输入，可点停止。放在 slot 内以便被 AI 报告覆盖 -->
        <div class="px-4 py-3 border-t border-gray-700/50 bg-surface-sunken">
          <div class="flex gap-2">
            <input
              :value="p.commandRunning ? p.runningCommand : getCommandInput(p.path)"
              :disabled="p.commandRunning"
              @input="handleCommandInput(p.path, $event.target.value)"
              @keydown.enter.prevent="handleRunCommand(p)"
              @keydown.up.prevent="navigateHistory(p, -1)"
              @keydown.down.prevent="navigateHistory(p, 1)"
              type="text"
              spellcheck="false"
              autocomplete="off"
              :class="[
                'flex-1 px-3 py-2 text-xs font-mono rounded border focus:outline-none transition',
                p.commandRunning
                  ? 'text-amber-300 bg-gray-900/60 border-amber-600/40 cursor-not-allowed'
                  : 'text-gray-200 bg-gray-900 border-gray-700 focus:border-cyan-500'
              ]"
            >
            <button
              @click="handleRunCommand(p)"
              :disabled="p.commandRunning || !getCommandInput(p.path).trim()"
              class="px-3 py-2 text-xs font-bold transition rounded"
              :class="p.commandRunning || !getCommandInput(p.path).trim()
                ? 'bg-gray-700 text-gray-400 cursor-not-allowed opacity-60'
                : 'bg-cyan-600 hover:bg-cyan-500 text-white'"
            >
              执行
            </button>
            <button
              @click="emit('stop-command', p)"
              :disabled="!p.commandRunning"
              class="px-3 py-2 text-xs font-bold transition rounded"
              :class="p.commandRunning
                ? 'bg-red-600 hover:bg-red-500 text-white'
                : 'bg-gray-700 text-gray-400 cursor-not-allowed opacity-60'"
            >
              停止
            </button>
          </div>
        </div>
        </TerminalView>
        <div
          v-if="hasRunningScripts(p) && isTunnelActiveProject(p) && isCloudflaredRunning() && getTunnelPublicUrl()"
          class="px-4 py-2 border-b border-cyan-700/40 bg-cyan-900/15"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] font-bold text-cyan-300">Tunnel URL</span>
            <a
              :href="getTunnelPublicUrl()"
              target="_blank"
              rel="noopener noreferrer"
              class="text-[11px] font-mono text-cyan-200 underline break-all hover:text-cyan-100"
              :title="getTunnelPublicUrl()"
            >
              {{ getTunnelPublicUrl() }}
            </a>
          </div>
        </div>
        </div>
        </template>
      </div>
    </div>

    <div v-if="showGitModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div class="w-full max-w-lg p-6 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl">
        <h3 class="flex items-center gap-2 mb-4 text-lg font-bold text-purple-400">
          <Sparkles class="w-4 h-4" /> AI 智能提交
        </h3>
        
        <div v-if="isGenerating" class="flex flex-col items-center justify-center h-32 space-y-3">
          <div class="w-8 h-8 border-4 border-purple-500 rounded-full border-t-transparent animate-spin"></div>
          <p class="text-sm text-gray-400">正在分析代码变更...</p>
        </div>

        <div v-else>
          <textarea
            v-model="commitMessage"
            rows="4"
            class="w-full p-3 mb-4 font-mono text-sm text-gray-200 bg-gray-900 border border-gray-600 rounded focus:border-purple-500 focus:outline-none"
            placeholder="生成的提交信息将显示在这里..."
          ></textarea>
          
          <div class="flex items-center gap-2 mb-3 text-xs text-gray-500">
            <span>由</span>
            <span class="text-purple-400">{{ gitModelConfig.name || 'AI' }}</span>
            <span>·</span>
            <span class="font-mono text-gray-400">{{ gitModelConfig.model }}</span>
            <span>提供</span>
          </div>

          <div class="flex items-center justify-between gap-3">
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" v-model="autoPush" class="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-0">
              <span class="text-xs text-gray-400">Pull → Commit → Push</span>
            </label>
            <div class="flex gap-3">
            <button @click="showGitModal = false" class="px-4 py-2 text-sm text-gray-400 hover:text-gray-100">取消</button>
            <button
              @click="confirmCommit"
              class="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-purple-600 rounded hover:bg-purple-500"
              :disabled="isCommitting"
            >
              <Loader2 v-if="isCommitting" class="w-4 h-4 animate-spin" />
              {{ isCommitting ? '执行中...' : (autoPush ? '提交并推送' : '确认并提交') }}
            </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick } from 'vue';
import TerminalView from './TerminalView.vue'
import { callKuyepClaude } from '../utils/ai' // 引入通用的 AI 工具
import { FolderOpen, Sparkles, Skull, Loader2 } from 'lucide-vue-next';
import { socket } from "../utils/socket";
import { useAiConfig } from '../utils/useAiConfig';

const { activeConfig, getSceneConfig } = useAiConfig();

// Git 场景使用的模型配置
const gitModelConfig = computed(() => getSceneConfig('git'));

const props = defineProps({
  projects: { type: Array, default: () => [] },
  stats: { type: Object, default: () => ({}) }, // 监控数据
  logs: { type: Object, default: () => ({}) },  // 日志数据
  hiddenSet: { type: Set, default: () => new Set() },
  installedNodeVersions: { type: Array, default: () => [] },
  nvmDetected: { type: Boolean, default: false },
  wechatDevtoolsConfigured: { type: Boolean, default: false },
  tunnelState: { type: Object, default: () => ({}) },
  tunnelPublicDomain: { type: String, default: '' },
  tunnelActiveProjectPath: { type: String, default: '' }
})

const emit = defineEmits([
  'run',
  'stop',
  'run-command',
  'stop-command',
  'open-folder',
  'open-terminal',
  'open-in-editor',
  'open-file',
  'toggle-hide',
  'open-wechat-devtools',
  'node-version-change'
])

const commandInputs = ref({})

// 折叠面板：同一时间最多展开一个项目
const expandedPath = ref('')
// 曾经展开过的项目：面板一旦挂载就常驻，仅用 v-show 切换，
// 避免 TerminalView 被销毁导致 AI 诊断等内部状态丢失
const openedPaths = ref(new Set())

const isExpanded = (p) => expandedPath.value === p.path

const hasBeenOpened = (p) => openedPaths.value.has(p.path)

// 卡片元素引用，用于展开后滚动定位
const cardRefs = new Map()

const setCardRef = (el, projectPath) => {
  if (el) cardRefs.set(projectPath, el)
  else cardRefs.delete(projectPath)
}

const togglePanel = async (p) => {
  const next = isExpanded(p) ? '' : p.path
  if (next) openedPaths.value.add(p.path)
  expandedPath.value = next

  // 仅展开时定位；收起不动，避免视线被拽走
  if (!next) return

  // 等 DOM 更新（同时可能有上一个面板收起导致高度变化）
  await nextTick()

  const el = cardRefs.get(p.path)
  if (!el) return

  // nearest：卡片已完整可见时不会产生滚动，避免抖动
  const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
  el.scrollIntoView({ block: 'nearest', behavior: prefersReduced ? 'auto' : 'smooth' })
}

// 脚本按钮点击（带诊断日志）
const handleScriptClick = (p, key) => {
  console.log('[ProjectList] 按钮点击:', p.name, key, 'disabled:', !!p.runningScripts?.[key])
  emit('run', p, key)
}

const getCommandInput = (projectPath) => {
  return String(commandInputs.value[projectPath] || '')
}

const setCommandInput = (projectPath, value) => {
  commandInputs.value[projectPath] = String(value || '')
}

// 命令行历史：内存态，按项目路径隔离，只保留最近 50 条
const HISTORY_LIMIT = 50
const commandHistory = ref({})
const historyIndex = ref({})

const pushHistory = (projectPath, command) => {
  const list = commandHistory.value[projectPath] || []
  if (list[list.length - 1] !== command) list.push(command)
  commandHistory.value[projectPath] = list.slice(-HISTORY_LIMIT)
  historyIndex.value[projectPath] = -1
}

const handleCommandInput = (projectPath, value) => {
  setCommandInput(projectPath, value)
  historyIndex.value[projectPath] = -1
}

// ↑ 取上一条历史，↓ 取下一条；越过最新一条回到空输入
const navigateHistory = (project, direction) => {
  const projectPath = project.path
  const list = commandHistory.value[projectPath] || []
  if (!list.length) return

  const current = historyIndex.value[projectPath] ?? -1
  let next

  if (current === -1) {
    next = direction < 0 ? list.length - 1 : -1
  } else {
    next = current + direction
    if (next > list.length - 1) {
      next = -1 // 越过最新一条 → 回到空输入
    } else if (next < 0) {
      next = 0 // 越过最早一条 → 停在最早
    }
  }

  historyIndex.value[projectPath] = next
  setCommandInput(projectPath, next === -1 ? '' : list[next])
}

const handleRunCommand = (project) => {
  if (project.commandRunning) return
  const command = getCommandInput(project.path).trim()
  if (!command) return
  pushHistory(project.path, command)
  emit('run-command', { project, command })
}

// Git 状态
const showGitModal = ref(false);
const isGenerating = ref(false);
const isCommitting = ref(false);
const commitMessage = ref('');
const currentGitProject = ref(null);
const autoPush = ref(false);

// 1. 点击 Git 按钮：获取 Diff -> 让 AI 写
const handleAiCommit = (p) => {
  currentGitProject.value = p;
  showGitModal.value = true;
  isGenerating.value = true;
  commitMessage.value = '';

  // 1. 请求后端获取 diff
  socket.emit('git:get-diff', { projectPath: p.path }, async ({ diff, error }) => {
    if (error) {
      $toast.warning('获取 Git 变更失败，请确认该项目是一个 Git 仓库');
      showGitModal.value = false;
      return;
    }
    
    if (!diff || diff.trim() === '') {
      commitMessage.value = 'chore: no changes detected';
      isGenerating.value = false;
      return;
    }

    // 2. 发送给 AI
    try {
      const systemPrompt = `你是一个资深代码提交助手。
      请根据用户的 git diff 内容，生成一条符合 Angular 规范的 Commit Message。
      格式要求：<type> <emoji>(<scope>): <subject>
      type 与 emoji 的对应关系：
      - feat ✨  - fix 🐛  - docs 📝  - style 💄
      - refactor ♻️  - perf ⚡️  - test ✅  - build 📦
      - ci 👷  - chore 🔧  - revert ⏪
      示例：feat ✨(auth): 新增登录页面
      规则：
      1. 只返回 Message 文本，不要包含 Markdown 代码块。
      2. 语言使用中文。
      3. 保持简练，subject 不超过 50 字。`;

      const gitConfig = getSceneConfig('git');
      const result = await callKuyepClaude(diff, systemPrompt, gitConfig?.id);
      commitMessage.value = result.replace(/`/g, '').trim(); // 清理一下可能的多余符号
    } catch (e) {
      commitMessage.value = `feat: update code\n\n(AI 生成失败: ${e.message})`;
    } finally {
      isGenerating.value = false;
    }
  });
};

// 2. 确认提交：发送给后端执行 git commit
const confirmCommit = () => {
  if (!commitMessage.value) return;
  isCommitting.value = true;
  
  socket.emit('git:commit', {
    projectPath: currentGitProject.value.path,
    message: commitMessage.value,
    autoPush: autoPush.value
  }, ({ success, error }) => {
    isCommitting.value = false;
    if (success) {
      showGitModal.value = false;
      $toast.success(autoPush.value ? '提交并推送成功！' : '提交成功！');
    } else {
      $toast.error(`操作失败: ${error}`);
    }
  });
};

// 辅助函数
const hasRunningScripts = (p) => {
  return p.runningScripts && Object.values(p.runningScripts).some(Boolean)
}

const isHidden = (path) => {
  return props.hiddenSet.has(normalizePath(path))
}

const getRunnerBadgeStyle = (runner) => {
  switch (runner) {
    case 'pnpm': return 'bg-orange-500/20 text-orange-400 border-orange-500/50'
    case 'yarn': return 'bg-blue-500/20 text-blue-400 border-blue-500/50'
    case 'bun': return 'bg-pink-500/20 text-pink-400 border-pink-500/50'
    default: return 'bg-red-500/20 text-red-400 border-red-500/50'
  }
}

// 格式化内存
const formatBytes = (bytes) => {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

const calcMemPercent = (bytes) => {
  const limit = 500 * 1024 * 1024 // 500MB 基准
  return Math.min((bytes / limit) * 100, 100)
}

// Node 版本标签样式
const getNodeVersionBadgeStyle = (source) => {
  switch (source) {
    case 'auto': return 'bg-green-500/20 text-green-400 border-green-500/50'
    case 'manual': return 'bg-purple-500/20 text-purple-400 border-purple-500/50'
    default: return 'bg-gray-500/20 text-gray-400 border-gray-500/50'
  }
}

const getNodeVersionLabel = (p) => {
  if (p.effectiveNodeVersion) {
    return `v${p.effectiveNodeVersion}`
  }
  return 'system'
}

const getNodeVersionTooltip = (p) => {
  if (p.nodeVersionSource === 'manual') {
    return `手动指定: v${p.effectiveNodeVersion}`
  }
  if (p.nodeVersionSource === 'auto' && p.detectedNodeVersion) {
    return `自动检测: ${p.detectedNodeVersion.raw} (来源: ${p.detectedNodeVersion.source})`
  }
  return '使用系统默认 Node 版本'
}

const canOpenWechatDevtools = (project) => {
  return !!(project.isMiniProgram && props.wechatDevtoolsConfigured)
}

const getWechatDevtoolsTooltip = (project) => {
  if (!project.isMiniProgram) return '未检测到 project.config.json，不视为小程序项目'
  if (!props.wechatDevtoolsConfigured) return '请先在 设置 → 开发工具 中配置微信开发者工具路径'
  return '启动微信开发者工具'
}

const normalizePath = (value = '') =>
  String(value || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase()

const isTunnelActiveProject = (project) => {
  const state = props.tunnelState || {}
  const activeTarget = state.activeTarget || {}
  const normalizedProjectPath = normalizePath(project.path)

  const activePath = normalizePath(activeTarget.projectPath)
  if (activePath) {
    return normalizedProjectPath === activePath
  }

  const savedActivePath = normalizePath(props.tunnelActiveProjectPath)
  if (savedActivePath) {
    return normalizedProjectPath === savedActivePath
  }

  if (activeTarget.projectName) {
    return activeTarget.projectName === project.name
  }

  return false
}

const getTunnelPublicUrl = () => {
  const raw = String(props.tunnelPublicDomain || '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  return `http://${raw}`
}

const isCloudflaredRunning = () => {
  return !!props.tunnelState?.cloudflaredRunning
}
</script>
