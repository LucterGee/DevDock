import { ref, computed, watch } from 'vue';
import {
  DEFAULT_COUNTDOWN_REMINDER_CONFIG,
  normalizeCountdownReminderConfig,
  type CountdownReminderConfig,
} from './countdownReminder';
import { socket } from './socket'; // 👈 引入刚才创建的 socket 单例

// 定义存储在 JSON 文件里的 Key 名称
const STORAGE_KEY_LIST = 'ai_config_list';
const STORAGE_KEY_ACTIVE = 'ai_active_id';
const STORAGE_KEY_SCENES = 'ai_scene_configs';
const STORAGE_KEY_WECHAT_DEVTOOLS = 'wechat_devtools_config';
const STORAGE_KEY_TERMINAL = 'terminal_config';
const STORAGE_KEY_EDITOR = 'editor_config';
const STORAGE_KEY_COUNTDOWN_REMINDER = 'countdown_reminder_config';

const DEFAULT_CONFIG: any = {
  id: 'default',
  name: 'DeepSeek (默认)',
  provider: 'openai',
  baseURL: 'https://api.deepseek.com',
  apiKey: '',
  model: 'deepseek-chat',
};

// 响应式状态
const configList = ref([DEFAULT_CONFIG]);
const activeId = ref('default');
const sceneConfigs = ref<Record<string, string>>({ git: '', diagnosis: '', weeklyReport: '' });
const wechatDevtoolsConfig = ref({
  path: ''
});
const editorConfig = ref({
  preset: 'vscode',
  customCommand: ''
});

export type TerminalPlatformConfig = { preset: string; customApp: string };

const normalizeTerminalPlatform = (input: any, fallbackPreset: string): TerminalPlatformConfig => {
  const source = input && typeof input === 'object' ? input : {};
  return {
    preset: typeof source.preset === 'string' && source.preset ? source.preset : fallbackPreset,
    customApp: typeof source.customApp === 'string' ? source.customApp : ''
  };
};

const terminalConfig = ref({
  darwin: { preset: 'terminal', customApp: '' } as TerminalPlatformConfig,
  win32: { preset: 'cmd', customApp: '' } as TerminalPlatformConfig,
  linux: { preset: 'auto', customApp: '' } as TerminalPlatformConfig
});
const countdownReminderConfig = ref<CountdownReminderConfig>({
  ...DEFAULT_COUNTDOWN_REMINDER_CONFIG
});
const isLoaded = ref(false); // 标记是否加载完成

// 🔄 初始化：从后端加载数据
const init = () => {
  // 1. 加载列表
  socket.emit('config:load', STORAGE_KEY_LIST, (data: any) => {
    if (data && Array.isArray(data) && data.length > 0) {
      configList.value = data;
    } else {
      // 如果后端没数据，保持默认
      configList.value = [DEFAULT_CONFIG];
    }
    isLoaded.value = true;
  });

  // 2. 加载选中的 ID
  socket.emit('config:load', STORAGE_KEY_ACTIVE, (id: any) => {
    if (id) activeId.value = id;
  });

  // 3. 加载场景配置
  socket.emit('config:load', STORAGE_KEY_SCENES, (data: any) => {
    if (data && typeof data === 'object') {
      sceneConfigs.value = { git: '', diagnosis: '', weeklyReport: '', ...data };
    }
  });

  socket.emit('config:load', STORAGE_KEY_WECHAT_DEVTOOLS, (data: any) => {
    if (data && typeof data === 'object') {
      // 旧配置里按系统拆分的字段读一次兼容
      const legacyPath =
        typeof data.macosPath === 'string' && data.macosPath
          ? data.macosPath
          : typeof data.windowsPath === 'string'
            ? data.windowsPath
            : '';
      wechatDevtoolsConfig.value = {
        path: typeof data.path === 'string' && data.path ? data.path : legacyPath
      };
    }
  });

  socket.emit('config:load', STORAGE_KEY_EDITOR, (data: any) => {
    if (data && typeof data === 'object') {
      editorConfig.value = {
        preset: typeof data.preset === 'string' && data.preset ? data.preset : (typeof data.editorId === 'string' && data.editorId ? data.editorId : 'vscode'),
        customCommand: typeof data.customCommand === 'string' ? data.customCommand : ''
      };
    }
  });

  socket.emit('config:load', STORAGE_KEY_COUNTDOWN_REMINDER, (data: any) => {
    countdownReminderConfig.value = normalizeCountdownReminderConfig(data);
  });

  socket.emit('config:load', STORAGE_KEY_TERMINAL, (data: any) => {
    if (data && typeof data === 'object') {
      terminalConfig.value = {
        darwin: normalizeTerminalPlatform(data.darwin, 'terminal'),
        win32: normalizeTerminalPlatform(data.win32, 'cmd'),
        linux: normalizeTerminalPlatform(data.linux, 'auto')
      };
    }
  });
};

// 立即启动加载
init();

// 💾 监听变化 -> 发送给后端保存
watch(configList, (newVal) => {
  // 只有当加载完成后才允许保存（防止空数据覆盖了服务器数据）
  if (isLoaded.value) {
    socket.emit('config:save', { key: STORAGE_KEY_LIST, value: newVal });
  }
}, { deep: true });

watch(activeId, (newVal) => {
  if (isLoaded.value) {
    socket.emit('config:save', { key: STORAGE_KEY_ACTIVE, value: newVal });
  }
});

watch(sceneConfigs, (newVal) => {
  if (isLoaded.value) {
    socket.emit('config:save', { key: STORAGE_KEY_SCENES, value: newVal });
  }
}, { deep: true });

watch(wechatDevtoolsConfig, (newVal) => {
  if (isLoaded.value) {
    socket.emit('config:save', { key: STORAGE_KEY_WECHAT_DEVTOOLS, value: newVal });
  }
}, { deep: true });

watch(editorConfig, (newVal) => {
  if (isLoaded.value) {
    socket.emit('config:save', { key: STORAGE_KEY_EDITOR, value: newVal });
  }
}, { deep: true });

watch(terminalConfig, (newVal) => {
  if (isLoaded.value) {
    socket.emit('config:save', { key: STORAGE_KEY_TERMINAL, value: newVal });
  }
}, { deep: true });

watch(countdownReminderConfig, (newVal) => {
  if (isLoaded.value) {
    socket.emit('config:save', {
      key: STORAGE_KEY_COUNTDOWN_REMINDER,
      value: normalizeCountdownReminderConfig(newVal)
    });
  }
}, { deep: true });

export function useAiConfig() {
  const activeConfig = computed(() => {
    return configList.value.find(c => c.id === activeId.value) || configList.value[0];
  });

  const addConfig = (config: any) => {
    const newConfig = { ...config, id: Date.now().toString() };
    configList.value.push(newConfig);
    activeId.value = newConfig.id;
  };

  const updateConfig = (id: any, newFields: any) => {
    const index = configList.value.findIndex(c => c.id === id);
    if (index !== -1) {
      configList.value[index] = { ...configList.value[index], ...newFields };
    }
  };

  const removeConfig = (id: any) => {
    configList.value = configList.value.filter(c => c.id !== id);
    if (activeId.value === id && configList.value.length > 0) {
      activeId.value = configList.value[0].id;
    }
  };

  // 根据场景获取对应的配置对象（无场景配置时回退到全局）
  const getSceneConfig = (scene: string) => {
    const sceneId = sceneConfigs.value[scene];
    if (sceneId) {
      return configList.value.find(c => c.id === sceneId) || activeConfig.value;
    }
    return activeConfig.value;
  };

  return {
    configList,
    activeId,
    activeConfig,
    sceneConfigs,
    wechatDevtoolsConfig,
    editorConfig,
    terminalConfig,
    countdownReminderConfig,
    getSceneConfig,
    addConfig,
    removeConfig,
    updateConfig
  };
}
