<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { socket } from '../../utils/socket'
import { useAiConfig } from '../../utils/useAiConfig'
import { ChevronDown, X } from 'lucide-vue-next'
import { defaultDateRange, groupCommits, toggleCommitSelection, toDateInput, type WeeklyReportCommit } from '../../utils/weeklyReport'

type Repository = { id: string; name: string; path: string; enabled: boolean }
type Identity = { name: string; emails: string[] }
type Activity = { commits: WeeklyReportCommit[]; errors: Array<{ repositoryId: string; message: string }> }
type HistoryReport = { id: string; createdAt: string; startDate?: string; endDate?: string; markdown: string }

const repositories = ref<Repository[]>([])
const identities = ref<Identity[]>([])
const selectedIdentities = ref<string[]>([])
const activity = ref<Activity>({ commits: [], errors: [] })
const selectedCommits = ref<Set<string>>(new Set())
const reportMarkdown = ref('')
const history = ref<HistoryReport[]>([])
const rootPath = ref('')
const loading = ref(false)
const generating = ref(false)
const { getSceneConfig } = useAiConfig()
const dates = ref(defaultDateRange())

const grouped = computed(() => groupCommits(activity.value.commits))
const selectedCount = computed(() => selectedCommits.value.size)

// 最后一次汇报的结束日期；没有可用的历史区间时不显示快捷入口
const lastReportEndDate = computed(() => history.value[0]?.endDate || '')

const emitRequest = <T,>(event: string, payload: unknown = {}) => new Promise<T>((resolve, reject) => {
  socket.emit(event, payload, (response: any) => {
    if (response?.success === false) reject(new Error(response.error?.message || response.error || '操作失败'))
    else resolve(response?.data as T)
  })
})

const loadRepositories = async () => {
  repositories.value = await emitRequest<Repository[]>('weekly-report:repositories:list')
  const result = await emitRequest<{ selected: Identity[]; candidates: Identity[] }>('weekly-report:identities:list')
  identities.value = result.candidates
  selectedIdentities.value = result.selected.map((identity) => identity.name)
  history.value = await emitRequest<HistoryReport[]>('weekly-report:history:list')
}

const importRoot = async () => {
  if (!rootPath.value.trim()) return
  try {
    await emitRequest('weekly-report:repositories:import-root', { rootPath: rootPath.value.trim() })
    rootPath.value = ''
    await loadRepositories()
  } catch (error: any) { window.$toast?.warning?.(error.message) }
}

const toggleRepository = async (repository: Repository) => {
  try {
    await emitRequest('weekly-report:repositories:set-enabled', { id: repository.id, enabled: !repository.enabled })
    repository.enabled = !repository.enabled
  } catch (error: any) { window.$toast?.warning?.(error.message) }
}

const removeRepository = async (repository: Repository) => {
  const ok = await window.$confirm(`确定从列表中移除「${repository.name}」？`, '从列表移除', {
    type: 'warning',
    confirmText: '移除'
  })
  if (!ok) return
  try {
    await emitRequest('weekly-report:repositories:remove', { id: repository.id })
    await loadRepositories()
  } catch (error: any) { window.$toast?.warning?.(error.message) }
}

const saveIdentities = async () => {
  const selected = identities.value.filter((identity) => selectedIdentities.value.includes(identity.name))
  await emitRequest('weekly-report:identities:save', { identities: selected })
}

const collect = async () => {
  loading.value = true
  try {
    activity.value = await emitRequest<Activity>('weekly-report:activity:collect', dates.value)
    selectedCommits.value = new Set(activity.value.commits.map((commit) => commit.hash))
  } catch (error: any) { window.$toast?.warning?.(error.message) }
  finally { loading.value = false }
}

// 以上次汇报的结束日期为起点，到今天为止，并立即采集
const applyLastReportRange = async () => {
  if (!lastReportEndDate.value) return
  dates.value = { startDate: lastReportEndDate.value, endDate: toDateInput(new Date()) }
  await collect()
}

const toggleCommit = (hash: string) => { selectedCommits.value = toggleCommitSelection(selectedCommits.value, hash) }

// 仓库折叠：各自独立，可同时展开多个
const expandedRepos = ref<Set<string>>(new Set())
const isRepoOpen = (name: string) => expandedRepos.value.has(name)
const toggleRepo = (name: string) => {
  const next = new Set(expandedRepos.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  expandedRepos.value = next
}

// 整仓选择：折叠状态下也可直接勾选
const repoSelectedCount = (commits: WeeklyReportCommit[]) => commits.filter((c) => selectedCommits.value.has(c.hash)).length
const repoAllSelected = (commits: WeeklyReportCommit[]) => commits.length > 0 && repoSelectedCount(commits) === commits.length
const toggleRepoSelection = (commits: WeeklyReportCommit[]) => {
  const next = new Set(selectedCommits.value)
  const selectAll = !repoAllSelected(commits)
  commits.forEach((c) => { if (selectAll) next.add(c.hash); else next.delete(c.hash) })
  selectedCommits.value = next
}

const generate = async () => {
  generating.value = true
  try {
    await saveIdentities()
    const selected = activity.value.commits.filter((commit) => selectedCommits.value.has(commit.hash))
    const context = await emitRequest('weekly-report:generate-context', { activity: { ...activity.value, commits: selected } })
    const config = getSceneConfig('weeklyReport')
    const result = await emitRequest<string>('weekly-report:generate', {
      context,
      configId: config?.id,
      systemPrompt: '你是工作汇报助手。只根据 Git 活动事实生成简洁中文 Markdown 工作汇报，按项目归类，避免夸大和重复。'
    })
    reportMarkdown.value = result
  } catch (error: any) { window.$toast?.error?.(error.message) }
  finally { generating.value = false }
}

const copyReport = async () => {
  if (!reportMarkdown.value) return
  await navigator.clipboard?.writeText(reportMarkdown.value)
  window.$toast?.success?.('汇报已复制')
}

const saveReport = async () => {
  if (!reportMarkdown.value) return
  await emitRequest('weekly-report:history:save', { report: { ...dates.value, markdown: reportMarkdown.value } })
  history.value = await emitRequest<HistoryReport[]>('weekly-report:history:list')
}

const loadHistory = async (id: string) => {
  const report = await emitRequest<{ markdown: string }>('weekly-report:history:get', { id })
  if (report) reportMarkdown.value = report.markdown
}

onMounted(() => { loadRepositories().catch((error) => window.$toast?.warning?.(error.message)) })
</script>

<template>
  <div class="min-h-screen bg-gray-900 text-gray-100">
    <header class="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-gray-700 bg-gray-800 px-4 py-3">
      <h1 class="text-lg font-bold text-blue-400">工作汇报</h1>
      <button class="rounded bg-gray-700 px-3 py-2 text-sm text-gray-100 transition hover:bg-gray-600" @click="$router.push('/dashboard')">返回项目</button>
    </header>

    <div class="flex flex-wrap items-end gap-3 border-b border-gray-700 bg-gray-800 px-4 py-3">
      <label class="text-xs text-gray-400">开始日期
        <input v-model="dates.startDate" type="date" class="mt-1 block rounded border border-gray-600 bg-gray-900 px-2 py-1.5 text-sm text-gray-100" />
      </label>
      <label class="text-xs text-gray-400">结束日期
        <input v-model="dates.endDate" type="date" class="mt-1 block rounded border border-gray-600 bg-gray-900 px-2 py-1.5 text-sm text-gray-100" />
      </label>
      <button
        v-if="lastReportEndDate"
        class="rounded border border-blue-600/50 bg-blue-600/10 px-3 py-2 text-xs font-medium text-blue-400 transition hover:bg-blue-600/20"
        @click="applyLastReportRange"
      >上次汇报至今</button>
      <button class="rounded bg-gray-700 px-4 py-2 text-sm text-gray-100 transition hover:bg-gray-600 disabled:opacity-50" :disabled="loading" @click="collect">{{ loading ? '采集中…' : '刷新活动' }}</button>
      <button class="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50" :disabled="generating || !activity.commits.length" @click="generate">{{ generating ? '生成中…' : `生成汇报 (${selectedCount})` }}</button>
    </div>

    <main class="grid gap-4 p-4 lg:grid-cols-[320px_1fr]">
      <aside class="space-y-4">
        <section class="rounded border border-gray-700 bg-gray-800 p-4">
          <h2 class="mb-3 text-sm font-semibold">Git 仓库</h2>
          <div class="mb-3 flex gap-2">
            <input v-model="rootPath" class="min-w-0 flex-1 rounded border border-gray-600 bg-gray-900 px-2 py-1.5 text-xs text-gray-100" placeholder="扫描根目录" @keyup.enter="importRoot" />
            <button class="rounded bg-blue-600 px-3 text-xs font-medium text-white transition hover:bg-blue-500" @click="importRoot">导入</button>
          </div>
          <div class="max-h-64 overflow-y-auto">
            <div v-for="repository in repositories" :key="repository.id" class="flex items-center gap-2 border-t border-gray-700 py-1.5 text-sm">
              <input type="checkbox" class="shrink-0" :checked="repository.enabled" @change="toggleRepository(repository)" />
              <span class="min-w-0 flex-1 truncate" :title="repository.path">{{ repository.name }}</span>
              <button
                class="shrink-0 rounded p-1 text-gray-500 transition hover:bg-gray-700 hover:text-red-400"
                title="移除"
                @click="removeRepository(repository)"
              ><X class="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </section>

        <section class="rounded border border-gray-700 bg-gray-800 p-4">
          <h2 class="mb-3 text-sm font-semibold">本人作者名</h2>
          <label v-for="identity in identities" :key="identity.name" class="mb-2 flex items-start gap-2 text-sm">
            <input v-model="selectedIdentities" type="checkbox" :value="identity.name" class="mt-1 shrink-0" />
            <span class="min-w-0 flex-1">
              <span class="block truncate" :title="identity.name">{{ identity.name }}</span>
              <span class="block truncate text-[10px] text-gray-500" :title="identity.emails.join('\n')">{{ identity.emails.join(', ') }}</span>
            </span>
          </label>
        </section>

        <section v-if="history.length" class="rounded border border-gray-700 bg-gray-800 p-4">
          <h2 class="mb-2 text-sm font-semibold">历史汇报</h2>
          <div v-for="report in history" :key="report.id" class="flex items-center justify-between gap-2 border-t border-gray-700 py-2">
            <div class="min-w-0">
              <div class="text-xs text-gray-200">{{ report.createdAt.slice(0, 10) }}</div>
              <div v-if="report.startDate && report.endDate" class="text-[10px] text-gray-500">{{ report.startDate }} ~ {{ report.endDate }}</div>
            </div>
            <button class="shrink-0 rounded border border-gray-600 px-2 py-0.5 text-[11px] text-gray-300 transition hover:bg-gray-700" @click="loadHistory(report.id)">载入</button>
          </div>
        </section>
      </aside>

      <section class="space-y-4">
        <div v-if="activity.errors.length" class="rounded border border-yellow-700/50 bg-yellow-900/20 p-3 text-xs text-yellow-300">部分仓库采集失败：{{ activity.errors.map((error) => error.message).join('；') }}</div>

        <div class="space-y-2">
          <div v-for="(commits, name) in grouped" :key="name" class="rounded border border-gray-700 bg-gray-800">
            <div
              class="flex cursor-pointer select-none items-center gap-2 px-3 py-2 transition hover:bg-gray-700/30"
              @click="toggleRepo(String(name))"
            >
              <input
                type="checkbox"
                class="shrink-0"
                :checked="repoAllSelected(commits)"
                @click.stop
                @change="toggleRepoSelection(commits)"
              />
              <span class="min-w-0 flex-1 truncate text-sm font-semibold text-blue-300" :title="String(name)">{{ name }}</span>
              <span class="shrink-0 font-mono text-[11px] text-gray-500">{{ repoSelectedCount(commits) }}/{{ commits.length }}</span>
              <ChevronDown
                class="h-4 w-4 shrink-0 text-gray-500 transition-transform"
                :class="isRepoOpen(String(name)) ? 'rotate-180' : ''"
              />
            </div>

            <div v-show="isRepoOpen(String(name))" class="border-t border-gray-700/60">
              <label
                v-for="commit in commits"
                :key="commit.hash"
                class="flex gap-2 border-t border-gray-700/40 px-3 py-2 text-sm first:border-t-0"
              >
                <input type="checkbox" class="mt-1 shrink-0" :checked="selectedCommits.has(commit.hash)" @change="toggleCommit(commit.hash)" />
                <span class="min-w-0">
                  <span class="block">{{ commit.subject }}</span>
                  <span class="block truncate text-[10px] text-gray-500">{{ commit.hash.slice(0, 7) }} · {{ commit.authoredAt }}</span>
                </span>
              </label>
            </div>
          </div>
        </div>

        <section class="rounded border border-gray-700 bg-gray-800 p-4">
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-sm font-semibold">汇报内容</h2>
            <div class="flex gap-2">
              <button class="rounded bg-gray-700 px-3 py-1 text-xs text-gray-100 transition hover:bg-gray-600" @click="copyReport">复制</button>
              <button class="rounded bg-gray-700 px-3 py-1 text-xs text-gray-100 transition hover:bg-gray-600" @click="saveReport">保存历史</button>
            </div>
          </div>
          <textarea v-model="reportMarkdown" class="min-h-[360px] w-full rounded border border-gray-600 bg-gray-900 p-3 font-mono text-sm text-gray-100" placeholder="生成后可直接编辑…" />
        </section>
      </section>
    </main>
  </div>
</template>
