import { onUnmounted, ref, watch } from 'vue';
import { socket } from './socket';
import { useAiConfig } from './useAiConfig';
import {
  getNextReminderAt,
  normalizeCountdownReminderConfig,
  type CountdownReminderConfig,
} from './countdownReminder';

type NotificationResult = {
  success?: boolean;
  error?: string;
};

const MAX_TIMEOUT_MS = 2_147_483_647;
const nextReminderAt = ref<Date | null>(null);
let reminderTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

const clearReminderTimer = () => {
  if (reminderTimer) {
    clearTimeout(reminderTimer);
    reminderTimer = null;
  }
};

const showSystemNotification = (config: CountdownReminderConfig) => {
  socket.emit(
    'notification:show',
    {
      title: config.title,
      body: config.body,
    },
    (result: NotificationResult = {}) => {
      if (!result.success) {
        // 系统通知不可用时（例如浏览器调试）退回到页面提示，
        // 内容仍是提醒本身，而不是「环境不支持」这类错误信息
        window.$toast?.warning?.(`${config.title}：${config.body}`, 8000);
      }
    }
  );
};

const scheduleNextReminder = (rawConfig: CountdownReminderConfig) => {
  clearReminderTimer();
  const config = normalizeCountdownReminderConfig(rawConfig);
  const next = getNextReminderAt(new Date(), config);
  nextReminderAt.value = next;

  if (!next) return;

  const delay = Math.max(0, next.getTime() - Date.now());
  reminderTimer = setTimeout(() => {
    if (delay > MAX_TIMEOUT_MS) {
      scheduleNextReminder(config);
      return;
    }

    showSystemNotification(config);
    scheduleNextReminder(config);
  }, Math.min(delay, MAX_TIMEOUT_MS));
};

export function useCountdownReminder() {
  const { countdownReminderConfig } = useAiConfig();

  if (!started) {
    started = true;
    watch(
      countdownReminderConfig,
      (config) => scheduleNextReminder(config),
      { deep: true, immediate: true }
    );
  }

  onUnmounted(() => {
    clearReminderTimer();
    nextReminderAt.value = null;
    started = false;
  });

  return {
    nextReminderAt,
  };
}
