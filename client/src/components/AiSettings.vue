<template>
  <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" @mousedown.self="closeDialog" @keydown.esc="closeDialog" tabindex="-1" ref="backdrop">
    <div class="w-full max-w-5xl bg-surface border border-gray-700 rounded-lg shadow-2xl overflow-hidden flex flex-col h-[80vh] max-h-[760px]">

      <div class="flex items-center justify-between p-4 border-b border-gray-700 bg-surface-raised">
        <h3 class="flex items-center gap-2 text-lg font-bold text-gray-100">
          <Settings class="w-5 h-5 text-gray-400" />
          全局设置
        </h3>
        <button @click="closeDialog" class="px-2 text-gray-400 hover:text-gray-100">✕</button>
      </div>

      <div class="flex flex-1 min-h-0 overflow-hidden">

        <!-- 左侧边栏 -->
        <div class="flex flex-col w-64 overflow-hidden border-r border-gray-700 bg-surface-sunken">

          <!-- 组一：模型 -->
          <div class="flex flex-col flex-1 min-h-0">
            <div class="px-4 pt-3 pb-1 text-[10px] font-bold tracking-wider text-gray-500 uppercase">模型</div>

            <div class="flex-1 min-h-0 px-2 space-y-1 overflow-y-auto">
              <div
                v-for="config in configList"
                :key="config.id"
                @click="handleSelect(config)"
                class="px-2.5 py-2 transition rounded cursor-pointer select-none"
                :class="currentView === 'model' && currentEditId === config.id ? 'bg-surface-hover text-gray-100' : 'text-gray-400 hover:bg-surface-hover'"
              >
                <!-- 第一行：名称 + 全局默认标记 -->
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm font-medium truncate">{{ config.name }}</span>
                  <div
                    v-if="activeId === config.id"
                    class="flex-shrink-0 w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]"
                    title="当前全局使用"
                  ></div>
                </div>

                <!-- 第二行：provider 徽章 + 模型名 -->
                <div class="flex items-center gap-1.5 mt-0.5 min-w-0">
                  <span class="flex-shrink-0 text-[9px] font-mono px-1 py-px rounded bg-gray-700/60 text-gray-300">{{ config.provider }}</span>
                  <span class="text-[10px] font-mono text-gray-500 truncate">{{ config.model }}</span>
                </div>

                <!-- 第三行：场景徽章（无场景时不渲染该行） -->
                <div v-if="sceneUsage[config.id]" class="flex items-center gap-1 mt-1 min-w-0">
                  <span
                    v-for="badge in sceneUsage[config.id]"
                    :key="badge.key"
                    class="flex items-center justify-center flex-shrink-0 w-4 h-4 text-[9px] font-bold rounded"
                    :class="badge.tone"
                    :title="badge.label"
                  >{{ badge.letter }}</span>
                </div>
              </div>
            </div>

            <div class="p-2">
              <button
                @click="handleCreateNew"
                class="flex items-center justify-center w-full gap-1.5 px-3 py-2 text-xs text-blue-400 transition border border-gray-600 border-dashed rounded hover:bg-blue-500/10 hover:border-blue-500"
              >
                <Plus class="w-3.5 h-3.5" /> 添加新模型
              </button>
            </div>
          </div>

          <!-- 组二：场景 -->
          <div class="flex-shrink-0 px-2 pb-2 border-t border-gray-700">
            <div class="px-2 pt-2 pb-1 text-[10px] font-bold tracking-wider text-gray-500 uppercase">场景</div>
            <div
              @click="showSceneView"
              class="flex items-center gap-2 px-3 py-2 transition rounded cursor-pointer select-none"
              :class="currentView === 'scene' ? 'bg-purple-500/20 text-purple-300' : 'text-gray-400 hover:bg-surface-hover'"
            >
              <Target class="w-3.5 h-3.5" />
              <span class="text-sm font-medium">场景配置</span>
            </div>
          </div>

          <!-- 组三：集成 -->
          <div class="flex-shrink-0 px-2 pb-2 border-t border-gray-700">
            <div class="px-2 pt-2 pb-1 text-[10px] font-bold tracking-wider text-gray-500 uppercase">集成</div>
            <div
              @click="showTunnelView"
              class="flex items-center gap-2 px-3 py-2 transition rounded cursor-pointer select-none"
              :class="currentView === 'tunnel' ? 'bg-cyan-500/20 text-cyan-300' : 'text-gray-400 hover:bg-surface-hover'"
            >
              <span class="text-sm">T</span>
              <span class="text-sm font-medium">Tunnel</span>
            </div>
            <div
              @click="showNodeView"
              class="flex items-center gap-2 px-3 py-2 transition rounded cursor-pointer select-none"
              :class="currentView === 'node' ? 'bg-lime-500/20 text-lime-300' : 'text-gray-400 hover:bg-surface-hover'"
            >
              <span class="text-sm">N</span>
              <span class="text-sm font-medium">Node 版本</span>
            </div>
            <div
              @click="showToolView"
              class="flex items-center gap-2 px-3 py-2 transition rounded cursor-pointer select-none"
              :class="currentView === 'tool' ? 'bg-emerald-500/20 text-emerald-300' : 'text-gray-400 hover:bg-surface-hover'"
            >
              <span class="text-sm">W</span>
              <span class="text-sm font-medium">开发工具</span>
            </div>
          </div>

          <!-- 组四：外观与应用 -->
          <div class="flex-shrink-0 px-2 pb-3 border-t border-gray-700">
            <div class="px-2 pt-2 pb-1 text-[10px] font-bold tracking-wider text-gray-500 uppercase">外观与应用</div>
            <div
              @click="showAppearanceView"
              class="flex items-center gap-2 px-3 py-2 transition rounded cursor-pointer select-none"
              :class="currentView === 'appearance' ? 'bg-indigo-500/20 text-indigo-300' : 'text-gray-400 hover:bg-surface-hover'"
            >
              <Palette class="w-3.5 h-3.5" />
              <span class="text-sm font-medium">外观</span>
            </div>
            <div
              @click="showReminderView"
              class="flex items-center gap-2 px-3 py-2 transition rounded cursor-pointer select-none"
              :class="currentView === 'reminder' ? 'bg-amber-500/20 text-amber-300' : 'text-gray-400 hover:bg-surface-hover'"
            >
              <Timer class="w-3.5 h-3.5" />
              <span class="text-sm font-medium">倒计时提醒</span>
            </div>
            <div
              @click="showAppView"
              class="flex items-center gap-2 px-3 py-2 transition rounded cursor-pointer select-none"
              :class="currentView === 'app' ? 'bg-blue-500/20 text-blue-300' : 'text-gray-400 hover:bg-surface-hover'"
            >
              <span class="text-sm">U</span>
              <span class="text-sm font-medium">应用更新</span>
            </div>
          </div>
        </div>

        <!-- 右侧面板 -->
        <div class="flex flex-col flex-1 min-w-0 bg-surface">

          <!-- 模型编辑视图 -->
          <template v-if="currentView === 'model' && formData">
            <div class="flex-1 overflow-y-auto">
              <div class="px-6 pt-5 pb-3 border-b border-gray-700">
                <h4 class="flex items-center gap-2 text-base font-bold text-gray-100">
                  <component :is="isCreating ? Plus : Pencil" class="w-4 h-4 text-gray-400" />
                  {{ isCreating ? '新增配置' : '编辑配置' }}
                </h4>
              </div>

              <div v-if="!secretStorageAvailable" class="mx-6 mt-4 flex items-start gap-2 rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                <AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>当前环境不支持加密存储，已清空磁盘上的 API Key。本次填写的密钥只保留在内存中，重启应用后需要重新输入。</span>
              </div>
              <div class="px-6 py-5 space-y-6">

                <!-- 分区：基础信息 -->
                <section>
                  <div class="pb-1.5 mb-3 border-b border-gray-700">
                    <h5 class="text-[11px] font-bold tracking-wider text-gray-500 uppercase">基础信息</h5>
                  </div>
                  <div class="space-y-4">
                    <div>
                      <label class="block mb-1 text-xs text-gray-500">显示名称 (别名)</label>
                      <input v-model="formData.name" type="text" class="w-full bg-surface-raised border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none transition">
                    </div>

                    <div>
                      <label class="block mb-1 text-xs text-gray-500">API 协议</label>
                      <select v-model="formData.provider" class="w-full bg-surface-raised border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none transition">
                        <option value="openai">OpenAI 兼容 (DeepSeek / GPT)</option>
                        <option value="openai-responses">OpenAI Responses (Codex / GPT)</option>
                        <option value="anthropic">Anthropic (Claude)</option>
                        <option value="gemini">Google Gemini</option>
                      </select>
                    </div>

                    <div>
                      <label class="block mb-1 text-xs text-gray-500">Model (模型名)</label>
                      <input v-model="formData.model" type="text" class="w-full bg-surface-raised border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 font-mono focus:border-blue-500 focus:outline-none transition">
                    </div>
                  </div>
                </section>

                <!-- 分区：连接 -->
                <section>
                  <div class="pb-1.5 mb-3 border-b border-gray-700">
                    <h5 class="text-[11px] font-bold tracking-wider text-gray-500 uppercase">连接</h5>
                  </div>
                  <div class="space-y-4">
                    <div>
                      <label class="block mb-1 text-xs text-gray-500">Base URL (API 地址)</label>
                      <input v-model="formData.baseURL" type="text" class="w-full bg-surface-raised border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 font-mono focus:border-blue-500 focus:outline-none transition">
                    </div>

                    <div>
                      <label class="block mb-1 text-xs text-gray-500">API Key</label>
                      <input v-model="formData.apiKey" type="password" placeholder="API Key..." class="w-full bg-surface-raised border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 font-mono focus:border-blue-500 focus:outline-none transition">
                    </div>
                  </div>
                </section>

                <!-- 分区：使用情况 -->
                <section>
                  <div class="pb-1.5 mb-3 border-b border-gray-700">
                    <h5 class="text-[11px] font-bold tracking-wider text-gray-500 uppercase">使用情况</h5>
                  </div>

                  <div class="p-4 space-y-3 border border-gray-700 rounded-lg bg-surface-raised">
                    <div class="flex items-start justify-between gap-3">
                      <div class="min-w-0">
                        <div class="text-sm text-gray-200">全局默认模型</div>
                      </div>
                      <button
                        v-if="!isCreating && activeId !== formData.id"
                        @click="setActive(formData.id)"
                        class="flex-shrink-0 px-3 py-1 text-xs text-green-400 transition border border-green-800 rounded bg-green-900/30 hover:bg-green-800"
                      >
                        设为全局默认
                      </button>
                      <span v-else-if="!isCreating" class="flex items-center flex-shrink-0 gap-1 px-2 py-1 text-xs font-bold text-green-500 border rounded border-green-500/30 bg-green-500/10">
                        <Check class="w-3 h-3" /> 全局默认
                      </span>
                      <span v-else class="flex-shrink-0 text-[11px] text-gray-500">保存后可设为默认</span>
                    </div>

                    <div class="pt-3 border-t border-gray-700">
                      <div class="mb-1.5 text-sm text-gray-200">被以下场景使用</div>
                      <div v-if="formSceneUsage.length" class="flex flex-wrap gap-1.5">
                        <span
                          v-for="badge in formSceneUsage"
                          :key="badge.key"
                          class="px-2 py-0.5 text-[11px] rounded"
                          :class="badge.tone"
                        >{{ badge.label }}</span>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </div>

            <div class="flex items-center justify-between p-4 border-t border-gray-700 bg-surface-raised">
              <button
                v-if="!isCreating"
                @click="handleDelete"
                class="text-xs text-red-400 underline hover:text-red-300"
              >
                删除配置
              </button>
              <div v-else></div>
              <div class="flex gap-3">
                <button
                  @click="save"
                  class="px-5 py-2 text-xs font-bold text-white transition bg-blue-600 rounded shadow-sm hover:bg-blue-500"
                >
                  保存配置
                </button>
              </div>
            </div>
          </template>

          <!-- 场景配置视图 -->
          <template v-else-if="currentView === 'scene'">
            <div class="flex-1 p-6 overflow-y-auto">
              <div class="pb-2 mb-5 border-b border-gray-700">
                <h4 class="flex items-center gap-2 text-base font-bold text-gray-100">
                  <Target class="w-4 h-4 text-purple-400" />
                  场景配置
                </h4>
              </div>

              <div class="space-y-4">
                <!-- Git 提交 -->
                <div class="p-4 border border-gray-700 rounded-lg bg-surface-raised transition hover:border-gray-600">
                  <div class="flex items-start gap-3">
                    <div class="flex items-center justify-center flex-shrink-0 text-lg text-orange-400 rounded-lg w-9 h-9 bg-orange-500/15">
                      G
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center justify-between mb-1">
                        <span class="text-sm font-medium text-gray-100">Git 提交消息</span>
                        <span class="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400/80">git commit</span>
                      </div>
                      <select
                        v-model="sceneConfigs.git"
                        class="w-full bg-surface border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 focus:border-orange-500/50 focus:outline-none transition"
                      >
                        <option value="">跟随全局默认 ({{ globalModelName }})</option>
                        <option v-for="c in configList" :key="c.id" :value="c.id">{{ c.name }} — {{ c.model }}</option>
                      </select>
                    </div>
                  </div>
                </div>

                <!-- 报错诊断 -->
                <div class="p-4 border border-gray-700 rounded-lg bg-surface-raised transition hover:border-gray-600">
                  <div class="flex items-start gap-3">
                    <div class="flex items-center justify-center flex-shrink-0 text-lg text-red-400 rounded-lg w-9 h-9 bg-red-500/15">
                      D
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center justify-between mb-1">
                        <span class="text-sm font-medium text-gray-100">提问及诊断</span>
                        <span class="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400/80">diagnosis</span>
                      </div>
                      <select
                        v-model="sceneConfigs.diagnosis"
                        class="w-full bg-surface border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 focus:border-red-500/50 focus:outline-none transition"
                      >
                        <option value="">跟随全局默认 ({{ globalModelName }})</option>
                        <option v-for="c in configList" :key="c.id" :value="c.id">{{ c.name }} — {{ c.model }}</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div class="p-4 border border-gray-700 rounded-lg bg-surface-raised transition hover:border-gray-600">
                  <div class="flex items-start gap-3">
                    <div class="flex items-center justify-center flex-shrink-0 text-lg text-blue-400 rounded-lg w-9 h-9 bg-blue-500/15">W</div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center justify-between mb-1">
                        <span class="text-sm font-medium text-gray-100">工作汇报</span>
                        <span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400/80">weekly report</span>
                      </div>
                      <select v-model="sceneConfigs.weeklyReport" class="w-full bg-surface border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 focus:border-blue-500/50 focus:outline-none transition">
                        <option value="">跟随全局默认 ({{ globalModelName }})</option>
                        <option v-for="c in configList" :key="c.id" :value="c.id">{{ c.name }} - {{ c.model }}</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <!-- Tunnel 视图 -->
          <template v-else-if="currentView === 'tunnel'">
            <div class="flex-1 p-6 overflow-y-auto">
              <div class="pb-2 mb-5 border-b border-gray-700">
                <h4 class="text-base font-bold text-gray-100">Tunnel Config</h4>
              </div>

              <div class="space-y-4">
                <div>
                  <label class="block mb-1 text-xs text-gray-500">cloudflared Token</label>
                  <input
                    v-model="tunnelConfig.token"
                    type="password"
                    class="w-full bg-surface-raised border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 font-mono focus:border-cyan-500 focus:outline-none transition"
                    placeholder="Paste cloudflared tunnel run token"
                  >
                </div>

                <div>
                  <label class="block mb-1 text-xs text-gray-500">Public Domain</label>
                  <input
                    v-model="tunnelConfig.publicDomain"
                    type="text"
                    class="w-full bg-surface-raised border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 font-mono focus:border-cyan-500 focus:outline-none transition"
                    placeholder="e.g. https://dev.example.com"
                  >
                </div>

                <label class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    v-model="tunnelConfig.autoSwitchOnRun"
                    class="w-4 h-4 bg-gray-700 border-gray-600 rounded text-cyan-500 focus:ring-0"
                  >
                  运行项目脚本自动切换隧道映射
                </label>

                <div class="p-3 border border-gray-700 rounded bg-surface-raised text-xs text-gray-300 space-y-2">
                  <div class="flex items-center justify-between">
                    <span>Gateway</span>
                    <span class="font-mono">127.0.0.1:{{ tunnelState.gatewayPort || 26324 }}</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span>Gateway Status</span>
                    <span :class="tunnelState.gatewayRunning ? 'text-green-400' : 'text-yellow-400'">
                      {{ tunnelState.gatewayRunning ? 'RUNNING' : 'STOPPED' }}
                    </span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span>Cloudflared</span>
                    <span :class="tunnelState.cloudflaredRunning ? 'text-green-400' : 'text-gray-400'">
                      {{ tunnelState.cloudflaredRunning ? 'RUNNING' : 'STOPPED' }}
                    </span>
                  </div>
                  <div v-if="tunnelState.activeTarget?.projectName" class="pt-2 border-t border-gray-700">
                    Active: {{ tunnelState.activeTarget.projectName }} :{{ tunnelState.activeTarget.port }}
                  </div>
                  <div v-if="tunnelState.gatewayError" class="text-red-400">
                    {{ tunnelState.gatewayError }}
                  </div>
                </div>

                <div class="flex gap-3">
                  <button
                    @click="handleTunnelStart"
                    :disabled="tunnelState.cloudflaredRunning"
                    class="px-4 py-2 text-xs font-bold text-white rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50"
                  >
                    Start cloudflared
                  </button>
                  <button
                    @click="handleTunnelStop"
                    :disabled="!tunnelState.cloudflaredRunning"
                    class="px-4 py-2 text-xs font-bold text-gray-100 bg-gray-600 rounded hover:bg-gray-500 disabled:opacity-50"
                  >
                    Stop cloudflared
                  </button>
                </div>
              </div>
            </div>
          </template>

          <!-- 开发工具视图 -->
          <template v-else-if="currentView === 'tool'">
            <div class="flex-1 p-6 overflow-y-auto">
              <div class="pb-2 mb-5 border-b border-gray-700">
                <h4 class="text-base font-bold text-gray-100">开发工具</h4>
              </div>

              <div class="space-y-5">
                <div class="p-4 border border-gray-700 rounded-lg bg-surface-raised">
                  <label class="block mb-2 text-sm font-medium text-gray-100">微信开发者工具路径</label>
                  <div class="flex gap-2">
                    <input
                      v-model="wechatDevtoolsConfig.path"
                      type="text"
                      :placeholder="serverPlatform === 'win32' ? '支持目录、cli.bat 或 微信开发者工具.exe' : '支持 .app、cli 或安装目录'"
                      class="min-w-0 flex-1 bg-surface border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 font-mono focus:border-emerald-500 focus:outline-none transition"
                    >
                    <button
                      class="shrink-0 rounded border border-gray-600 px-3 text-xs text-gray-300 transition hover:border-emerald-500 hover:text-emerald-400"
                      @click="pickFilePath((p) => (wechatDevtoolsConfig.path = p))"
                    >选择</button>
                  </div>
                </div>

                <div class="p-4 border border-gray-700 rounded-lg bg-surface-raised">
                  <label class="block mb-2 text-sm font-medium text-gray-100">打开终端</label>
                  <select
                    :value="activeTerminalConfig.preset"
                    @change="updateTerminalPreset($event.target.value)"
                    class="w-full bg-surface border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 focus:border-emerald-500 focus:outline-none transition"
                  >
                    <option
                      v-for="preset in terminalPresets"
                      :key="preset.id"
                      :value="preset.id"
                    >
                      {{ preset.label }}
                    </option>
                    <option value="custom">自定义…</option>
                  </select>
                  <div v-if="activeTerminalConfig.preset === 'custom'" class="mt-2 flex gap-2">
                    <input
                      :value="activeTerminalConfig.customApp"
                      @input="updateTerminalCustomApp($event.target.value)"
                      type="text"
                      :placeholder="serverPlatform === 'win32' ? '可执行文件路径，例如 C:\Program Files\Alacritty\alacritty.exe' : '应用名称或 .app 路径，例如 iTerm 或 /Applications/iTerm.app'"
                      class="min-w-0 flex-1 bg-surface border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 font-mono focus:border-emerald-500 focus:outline-none transition"
                    >
                    <button
                      class="shrink-0 rounded border border-gray-600 px-3 text-xs text-gray-300 transition hover:border-emerald-500 hover:text-emerald-400"
                      @click="pickFilePath((p) => updateTerminalCustomApp(p))"
                    >选择</button>
                  </div>
                </div>

                <div class="p-4 border border-gray-700 rounded-lg bg-surface-raised">
                  <label class="block mb-2 text-sm font-medium text-gray-100">用编辑器打开</label>
                  <select
                    :value="editorConfig.preset"
                    @change="editorConfig.preset = $event.target.value"
                    class="w-full bg-surface border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 focus:border-emerald-500 focus:outline-none transition"
                  >
                    <option value="vscode">VS Code</option>
                    <option value="system">系统默认</option>
                    <option value="custom">自定义…</option>
                  </select>
                  <div v-if="editorConfig.preset === 'custom'" class="mt-2 flex gap-2">
                    <input
                      v-model="editorConfig.customCommand"
                      type="text"
                      :placeholder="serverPlatform === 'win32' ? '可执行文件路径，例如 C:\\Program Files\\Zed\\zed.exe' : '命令或 .app 路径，例如 zed 或 /Applications/Zed.app'"
                      class="min-w-0 flex-1 bg-surface border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 font-mono focus:border-emerald-500 focus:outline-none transition"
                    >
                    <button
                      class="shrink-0 rounded border border-gray-600 px-3 text-xs text-gray-300 transition hover:border-emerald-500 hover:text-emerald-400"
                      @click="pickFilePath((p) => (editorConfig.customCommand = p))"
                    >选择</button>
                  </div>
                </div>

              </div>
            </div>
          </template>

          <!-- Node 版本视图 -->
          <template v-else-if="currentView === 'node'">
            <div class="flex-1 p-6 overflow-y-auto">
              <div class="pb-2 mb-5 border-b border-gray-700">
                <h4 class="flex items-center gap-2 text-base font-bold text-gray-100">
                  <span class="text-sm">N</span>
                  Node 版本
                </h4>
              </div>

              <section class="mb-6">
                <div class="pb-1.5 mb-3 border-b border-gray-700">
                  <h5 class="text-[11px] font-bold tracking-wider text-gray-500 uppercase">已安装</h5>
                </div>
                <div v-if="!nodeVersions.length" class="py-2 text-xs text-gray-500">未检测到任何 Node 版本</div>
                <div
                  v-for="item in nodeVersions"
                  :key="item.version"
                  class="flex items-center gap-3 border-b border-gray-700/60 py-2 text-sm last:border-b-0"
                >
                  <span class="w-24 font-mono text-gray-100">v{{ item.version }}</span>
                  <span class="text-xs" :class="item.source === 'managed' ? 'text-lime-400' : 'text-gray-500'">
                    {{ item.source === 'managed' ? '应用内' : 'nvm' }}
                  </span>
                  <button
                    v-if="item.removable"
                    class="ml-auto rounded px-2 py-1 text-xs text-gray-400 transition hover:bg-surface-hover hover:text-red-400"
                    @click="removeNode(item.version)"
                  >删除</button>
                </div>
              </section>

              <section>
                <div class="pb-1.5 mb-3 border-b border-gray-700">
                  <h5 class="text-[11px] font-bold tracking-wider text-gray-500 uppercase">安装新版本</h5>
                </div>
                <div class="flex gap-2">
                  <select
                    v-model="nodeSelectedVersion"
                    class="min-w-0 flex-1 rounded border border-gray-600 bg-surface-raised px-3 py-2 text-sm text-gray-100 focus:border-lime-500 focus:outline-none transition"
                  >
                    <option value="">选择版本…</option>
                    <option v-for="item in nodeAvailable" :key="item.version" :value="item.version">
                      v{{ item.version }}{{ item.lts ? ' · LTS ' + item.lts : '' }}
                    </option>
                  </select>
                  <button
                    class="shrink-0 rounded bg-lime-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-lime-500 disabled:opacity-50"
                    :disabled="!nodeSelectedVersion || nodeInstalling"
                    @click="installNode"
                  >{{ nodeInstalling ? '安装中…' : '安装' }}</button>
                </div>
                <div v-if="nodeInstalling" class="mt-3">
                  <div class="h-1.5 w-full overflow-hidden rounded bg-surface-sunken">
                    <div class="h-full bg-lime-500 transition-all" :style="{ width: nodeProgress + '%' }"></div>
                  </div>
                  <div class="mt-1 text-xs text-gray-500">v{{ nodeInstallingVersion }} · {{ nodeProgress }}%</div>
                </div>
              </section>
            </div>
          </template>

          <!-- 外观视图 -->
          <template v-else-if="currentView === 'appearance'">
            <div class="flex-1 p-6 overflow-y-auto">
              <div class="pb-2 mb-5 border-b border-gray-700">
                <h4 class="flex items-center gap-2 text-base font-bold text-gray-100">
                  <Palette class="w-4 h-4 text-indigo-400" />
                  外观
                </h4>
              </div>

              <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <button
                  v-for="option in themeOptions"
                  :key="option.value"
                  @click="selectTheme(option.value)"
                  class="p-4 text-left transition border rounded-lg"
                  :class="themeMode === option.value ? 'border-indigo-500 bg-indigo-500/10' : 'border-gray-700 bg-surface-raised hover:border-gray-600'"
                >
                  <div class="flex items-center justify-between mb-2">
                    <component :is="option.icon" class="w-5 h-5" :class="themeMode === option.value ? 'text-indigo-400' : 'text-gray-400'" />
                    <Check v-if="themeMode === option.value" class="w-4 h-4 text-indigo-400" />
                  </div>
                  <div class="text-sm font-medium" :class="themeMode === option.value ? 'text-indigo-300' : 'text-gray-200'">{{ option.label }}</div>
                </button>
              </div>
            </div>
          </template>

          <!-- 倒计时提醒视图 -->
          <template v-else-if="currentView === 'reminder'">
            <div class="flex-1 p-6 overflow-y-auto">
              <div class="pb-2 mb-5 border-b border-gray-700">
                <h4 class="flex items-center gap-2 text-base font-bold text-gray-100">
                  <Timer class="w-4 h-4 text-amber-400" />
                  倒计时提醒
                </h4>
              </div>

              <div class="space-y-5">
                <label class="flex items-center gap-3 text-sm text-gray-300 cursor-pointer">
                  <input
                    type="checkbox"
                    v-model="countdownReminderConfig.enabled"
                    class="w-4 h-4 bg-gray-700 border-gray-600 rounded text-amber-500 focus:ring-0"
                  >
                  启用系统倒计时提醒
                </label>

                <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label class="block mb-1 text-xs text-gray-500">开始时间</label>
                    <input
                      v-model="countdownReminderConfig.startTime"
                      type="time"
                      class="w-full bg-surface-raised border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none transition"
                    >
                  </div>

                  <div>
                    <label class="block mb-1 text-xs text-gray-500">结束时间</label>
                    <input
                      v-model="countdownReminderConfig.endTime"
                      type="time"
                      class="w-full bg-surface-raised border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none transition"
                    >
                  </div>

                  <div>
                    <label class="block mb-1 text-xs text-gray-500">间隔分钟</label>
                    <input
                      v-model.number="countdownReminderConfig.intervalMinutes"
                      type="number"
                      min="1"
                      max="720"
                      step="1"
                      class="w-full bg-surface-raised border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none transition"
                    >
                  </div>
                </div>

                <div>
                  <label class="block mb-1 text-xs text-gray-500">通知标题</label>
                  <input
                    v-model="countdownReminderConfig.title"
                    type="text"
                    class="w-full bg-surface-raised border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 focus:border-amber-500 focus:outline-none transition"
                  >
                </div>

                <div>
                  <label class="block mb-1 text-xs text-gray-500">通知内容</label>
                  <textarea
                    v-model="countdownReminderConfig.body"
                    rows="3"
                    class="w-full bg-surface-raised border border-gray-600 rounded px-3 py-2 text-sm text-gray-100 resize-none focus:border-amber-500 focus:outline-none transition"
                  ></textarea>
                </div>

                <div class="p-3 text-xs text-gray-400 border border-gray-700 rounded bg-surface-raised">
                  只要应用仍在运行，提醒会通过系统通知发出；应用完全退出后不会继续倒计时。
                </div>
              </div>
            </div>
          </template>

          <!-- 应用更新视图 -->
          <template v-else-if="currentView === 'app'">
            <div class="flex-1 p-6 overflow-y-auto">
              <div class="pb-2 mb-5 border-b border-gray-700">
                <h4 class="text-base font-bold text-gray-100">应用更新</h4>
              </div>

              <div class="space-y-4">
                <div class="p-4 border border-gray-700 rounded bg-surface-raised space-y-2 text-sm">
                  <div class="flex items-center justify-between">
                    <span class="text-gray-400">应用名称</span>
                    <span class="font-medium text-gray-100">{{ appUpdate.appName || '-' }}</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-gray-400">当前版本</span>
                    <span class="font-mono text-cyan-300">v{{ appUpdate.currentVersion || '-' }}</span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-gray-400">最新版本</span>
                    <span class="font-mono text-gray-100">
                      {{ appUpdate.latestVersion ? `v${appUpdate.latestVersion}` : '-' }}
                    </span>
                  </div>
                  <div class="flex items-center justify-between">
                    <span class="text-gray-400">状态</span>
                    <span
                      :class="appUpdate.downloaded ? 'text-green-400' : appUpdate.error ? 'text-red-400' : appUpdate.hasUpdate ? 'text-orange-400' : 'text-gray-300'"
                    >
                      {{ appUpdate.message || '尚未检查' }}
                    </span>
                  </div>
                  <div v-if="appUpdate.hasUpdate && appUpdate.installSupported" class="pt-2 border-t border-gray-700">
                    <div class="flex items-center justify-between text-xs text-gray-400 mb-1">
                      <span>下载进度</span>
                      <span>{{ Number(appUpdate.progress || 0).toFixed(0) }}%</span>
                    </div>
                    <div class="h-2 bg-gray-700 rounded overflow-hidden">
                      <div
                        class="h-full bg-blue-500 transition-all"
                        :style="{ width: `${Math.min(100, Math.max(0, Number(appUpdate.progress || 0)))}%` }"
                      ></div>
                    </div>
                  </div>
                  <div v-if="appUpdate.lastCheckedAt" class="text-xs text-gray-500">
                    最后检查时间：{{ appUpdate.lastCheckedAt }}
                  </div>
                </div>

                <div class="flex gap-3">
                  <button
                    @click="checkAppUpdate"
                    :disabled="appUpdate.checking || !appUpdate.enabled"
                    class="px-4 py-2 text-xs font-bold text-white rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
                  >
                    {{ appUpdate.checking ? '检查中...' : (appUpdate.installSupported ? '检查并下载更新' : '检查更新') }}
                  </button>

                  <button
                    v-if="appUpdate.installSupported"
                    @click="installUpdateNow"
                    :disabled="!appUpdate.downloaded"
                    class="px-4 py-2 text-xs font-bold text-white rounded bg-green-600 hover:bg-green-500 disabled:opacity-50"
                  >
                    立即重启并安装
                  </button>
                  <button
                    v-else-if="appUpdate.hasUpdate"
                    @click="openReleasePage"
                    class="px-4 py-2 text-xs font-bold text-white rounded bg-green-600 hover:bg-green-500"
                  >
                    打开下载页
                  </button>
                </div>

                <div v-if="appUpdate.error" class="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded p-3">
                  {{ appUpdate.error }}
                </div>
                <div v-else-if="!appUpdate.enabled" class="text-xs text-yellow-300 bg-yellow-500/10 border border-yellow-500/20 rounded p-3">
                  {{ appUpdate.message || '当前环境不支持自动更新（仅打包后的桌面应用可用）' }}
                </div>
              </div>
            </div>
          </template>

          <div v-else class="flex flex-col items-center justify-center h-full text-gray-600">
            <Settings class="w-10 h-10 mb-2 opacity-30" />
            <p class="text-sm">请在左侧选择模型，或点击添加</p>
          </div>

        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch, computed, nextTick, onMounted, onUnmounted } from 'vue';
import { Settings, Target, Timer, Plus, Pencil, Check, AlertTriangle, Moon, Sun, Monitor, Palette } from 'lucide-vue-next';
import { useAiConfig } from '../utils/useAiConfig';
import { useTheme } from '../utils/useTheme';
import { socket } from '../utils/socket';

const props = defineProps({ visible: Boolean });
const secretStorageAvailable = ref(true);
const emit = defineEmits(['close']);

const backdrop = ref(null);

const {
  configList,
  activeId,
  sceneConfigs,
  activeConfig,
  tunnelConfig,
  wechatDevtoolsConfig,
  editorConfig,
  terminalConfig,
  countdownReminderConfig,
  addConfig,
  updateConfig,
  removeConfig
} = useAiConfig();

const { themeMode } = useTheme();

const currentView = ref('model'); // 'model' | 'scene' | 'tunnel' | 'tool' | 'appearance' | 'reminder' | 'app'
const currentEditId = ref(null);
const formData = ref(null);
const isCreating = ref(false);
const appUpdate = ref({
  appName: 'DevDock',
  currentVersion: '',
  supported: false,
  enabled: false,
  installSupported: true,
  checking: false,
  hasUpdate: false,
  downloaded: false,
  progress: 0,
  status: 'idle',
  latestVersion: '',
  message: '',
  error: '',
  lastCheckedAt: ''
});
const tunnelState = ref({
  gatewayPort: 26324,
  gatewayRunning: false,
  gatewayError: '',
  activeTarget: null,
  cloudflaredRunning: false
});

// --- 终端设置 ---
const terminalPresets = ref([]);
const serverPlatform = ref('');

const activeTerminalKey = computed(() => {
  if (serverPlatform.value === 'darwin') return 'darwin';
  if (serverPlatform.value === 'win32') return 'win32';
  return 'linux';
});

// 兜底对象：即使配置缺失也保证模板能读到 preset / customApp，避免渲染期崩溃
const activeTerminalConfig = computed(() => {
  const config = terminalConfig.value || {};
  return config[activeTerminalKey.value] || { preset: 'custom', customApp: '' };
});

const applyTerminalPresets = (payload) => {
  if (!payload) return;
  serverPlatform.value = payload.platform || '';
  terminalPresets.value = Array.isArray(payload.presets) ? payload.presets : [];
};

const loadTerminalPresets = () => {
  socket.emit('terminal:get-presets', applyTerminalPresets);
};

const updateTerminalPreset = (value) => {
  activeTerminalConfig.value.preset = value;
};

const updateTerminalCustomApp = (value) => {
  activeTerminalConfig.value.customApp = value;
};

const pickFilePath = (apply) => {
  socket.emit('dialog:select-file', (result) => {
    if (result?.success && result.path) apply(result.path);
  });
};

// 全局默认模型名称（用于场景配置的下拉提示）
const globalModelName = computed(() => activeConfig.value?.name || '未配置');

// --- 场景徽章 ---
const SCENE_META = [
  { key: 'git', letter: 'G', label: 'Git 提交', tone: 'bg-orange-500/15 text-orange-400' },
  { key: 'diagnosis', letter: 'D', label: 'AI 诊断', tone: 'bg-red-500/15 text-red-400' },
  { key: 'weeklyReport', letter: 'W', label: '工作汇报', tone: 'bg-blue-500/15 text-blue-400' }
];

// 模型 id -> 使用了该模型的场景列表
const sceneUsage = computed(() => {
  const map = {};
  for (const meta of SCENE_META) {
    const id = sceneConfigs.value ? sceneConfigs.value[meta.key] : '';
    if (!id) continue;
    if (!map[id]) map[id] = [];
    map[id].push(meta);
  }
  return map;
});

// 当前编辑中的模型被哪些场景使用（新增态没有 id，自然为空）
const formSceneUsage = computed(() => {
  const id = formData.value ? formData.value.id : '';
  return id && sceneUsage.value[id] ? sceneUsage.value[id] : [];
});

// --- 外观 ---
const themeOptions = [
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'auto', label: '跟随系统', icon: Monitor }
];

const selectTheme = (value) => {
  themeMode.value = value;
};

// 点击左侧模型列表项
const handleSelect = (config) => {
  applyFormData();
  currentView.value = 'model';
  isCreating.value = false;
  currentEditId.value = config.id;
  formData.value = { ...config };
};

// 切换到场景配置视图
const showSceneView = () => {
  applyFormData();
  currentView.value = 'scene';
  currentEditId.value = null;
  formData.value = null;
  isCreating.value = false;
};

const showTunnelView = () => {
  applyFormData();
  currentView.value = 'tunnel';
  currentEditId.value = null;
  formData.value = null;
  isCreating.value = false;
  socket.emit('tunnel:get-state', (state) => {
    if (state) tunnelState.value = state;
  });
};

const showAppView = () => {
  applyFormData();
  currentView.value = 'app';
  currentEditId.value = null;
  formData.value = null;
  isCreating.value = false;
  socket.emit('app:update:get-state', applyAppUpdateState);
};

const showToolView = () => {
  applyFormData();
  currentView.value = 'tool';
  currentEditId.value = null;
  formData.value = null;
  isCreating.value = false;
};

// --- Node 版本 ---
const nodeVersions = ref([]);
const nodeAvailable = ref([]);
const nodeSelectedVersion = ref('');
const nodeInstalling = ref(false);
const nodeInstallingVersion = ref('');
const nodeProgress = ref(0);

const loadNodeVersions = () => {
  socket.emit('node:get-versions', (result) => {
    nodeVersions.value = (result && result.details) || [];
  });
};

const loadNodeAvailable = () => {
  socket.emit('node:available', (result) => {
    if (result && result.success) nodeAvailable.value = result.versions || [];
    else if (result && result.error) window.$toast?.warning?.(result.error);
  });
};

const showNodeView = () => {
  applyFormData();
  currentView.value = 'node';
  currentEditId.value = null;
  formData.value = null;
  isCreating.value = false;
  loadNodeVersions();
  if (!nodeAvailable.value.length) loadNodeAvailable();
};

const installNode = () => {
  const version = nodeSelectedVersion.value;
  if (!version || nodeInstalling.value) return;
  nodeInstalling.value = true;
  nodeInstallingVersion.value = version;
  nodeProgress.value = 0;
  socket.emit('node:install', { version }, (result) => {
    nodeInstalling.value = false;
    if (result && result.success) {
      window.$toast?.success?.(`Node v${version} 安装完成`);
      nodeSelectedVersion.value = '';
      loadNodeVersions();
    } else {
      window.$toast?.warning?.((result && result.error) || '安装失败');
    }
  });
};

const removeNode = (version) => {
  socket.emit('node:remove', { version }, (result) => {
    if (result && result.success) {
      window.$toast?.success?.(`已删除 Node v${version}`);
      loadNodeVersions();
    } else {
      window.$toast?.warning?.((result && result.error) || '删除失败');
    }
  });
};

const handleNodeInstallProgress = (payload) => {
  if (!payload) return;
  if (payload.version && payload.version !== nodeInstallingVersion.value) return;
  nodeProgress.value = payload.percent || 0;
};

const showAppearanceView = () => {
  applyFormData();
  currentView.value = 'appearance';
  currentEditId.value = null;
  formData.value = null;
  isCreating.value = false;
};

const showReminderView = () => {
  applyFormData();
  currentView.value = 'reminder';
  currentEditId.value = null;
  formData.value = null;
  isCreating.value = false;
};

// 点击新增按钮
const handleCreateNew = () => {
  currentView.value = 'model';
  isCreating.value = true;
  currentEditId.value = 'NEW_TEMP_ID';
  formData.value = {
    name: 'New Model',
    provider: 'openai',
    baseURL: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-3.5-turbo'
  };
};

// 设为激活
const setActive = (id) => {
  activeId.value = id;
};

// 保存逻辑
// 把编辑中的表单写回配置列表；新增态要求必填项齐全才落库
const applyFormData = () => {
  const data = formData.value;
  if (!data) return false;

  if (isCreating.value) {
    if (!data.name || !data.baseURL || !data.apiKey) return false;
    addConfig({ ...data });
    const last = configList.value[configList.value.length - 1];
    currentEditId.value = last.id;
    formData.value = { ...last };
    isCreating.value = false;
    return true;
  }

  updateConfig(data.id, data);
  return true;
};

const save = () => {
  if (!formData.value.name) return $toast.warning('名称不能为空');
  if (!formData.value.baseURL) return $toast.warning('Base URL 不能为空');
  if (!formData.value.apiKey) return $toast.warning('API Key 不能为空');
  applyFormData();
  $toast.success('保存成功');
};

const closeDialog = () => {
  applyFormData();
  emit('close');
};

const handleDelete = async () => {
  const ok = await window.$confirm('确定要删除吗？', '警告', {
    type: 'error',
    confirmText: '狠狠地删'
  });
  if (ok) {
    removeConfig(formData.value.id);
    formData.value = null;
    currentEditId.value = null;
  }
};

// 每次打开弹窗，默认选中当前正在使用的那个
const handleTunnelStart = () => {
  const token = tunnelConfig.value?.token?.trim();
  if (!token) {
    $toast.warning('Please enter cloudflared token first');
    return;
  }
  socket.emit('tunnel:start', { token }, ({ success, error }) => {
    if (success) $toast.success('cloudflared started');
    else $toast.error(error || 'Failed to start cloudflared');
  });
};

const handleTunnelStop = () => {
  socket.emit('tunnel:stop', ({ success, error }) => {
    if (success) $toast.success('cloudflared stop signal sent');
    else $toast.warning(error || 'cloudflared is not running');
  });
};

const handleTunnelState = (state) => {
  if (state) tunnelState.value = state;
};

const applyAppUpdateState = (payload) => {
  if (!payload) return;
  appUpdate.value = {
    ...appUpdate.value,
    ...payload
  };
};

const checkAppUpdate = () => {
  if (appUpdate.value.checking || !appUpdate.value.enabled) return;
  appUpdate.value.checking = true;
  appUpdate.value.error = '';
  appUpdate.value.lastCheckedAt = new Date().toLocaleString();

  socket.emit('app:update:check', (result) => {
    if (!result?.success) {
      appUpdate.value.checking = false;
      appUpdate.value.error = result?.error || '检查更新失败';
      $toast.warning(appUpdate.value.error);
      return;
    }
    if (result?.state) applyAppUpdateState(result.state);
  });
};

const openReleasePage = () => {
  socket.emit('app:update:open-release', (result) => {
    if (!result?.success) {
      $toast.error(result?.error || '打开下载页失败');
      return;
    }
  });
};

const installUpdateNow = () => {
  if (!appUpdate.value.downloaded) {
    $toast.warning('更新包尚未下载完成');
    return;
  }
  socket.emit('app:update:quit-install', ({ success, error }) => {
    if (!success) {
      $toast.error(error || '安装失败');
      return;
    }
    $toast.success('正在重启并安装更新...');
  });
};

onMounted(() => {
  socket.on('tunnel:state', handleTunnelState);
  socket.on('app:update:state', applyAppUpdateState);
  socket.on('node:install:progress', handleNodeInstallProgress);
  socket.emit('tunnel:get-state', handleTunnelState);
  socket.emit('ai:secret-storage', (result) => {
    secretStorageAvailable.value = result ? result.available !== false : true;
  });
  socket.emit('app:update:get-state', applyAppUpdateState);
  loadTerminalPresets();
});

onUnmounted(() => {
  socket.off('tunnel:state', handleTunnelState);
  socket.off('app:update:state', applyAppUpdateState);
});

watch(() => props.visible, (val) => {
  if (val) {
    document.body.style.overflow = 'hidden';
    nextTick(() => backdrop.value?.focus());
    currentView.value = 'model';
    const active = configList.value.find(c => c.id === activeId.value);
    if (active) {
      handleSelect(active);
    } else if (configList.value.length > 0) {
      handleSelect(configList.value[0]);
    } else {
      handleCreateNew();
    }
    socket.emit('tunnel:get-state', handleTunnelState);
    socket.emit('app:update:get-state', applyAppUpdateState);
  } else {
    document.body.style.overflow = '';
  }
});
</script>
