import { ref, computed, watch } from 'vue';
import { socket } from './socket';

export type ThemeMode = 'dark' | 'light' | 'auto';

const STORAGE_KEY_THEME = 'theme_mode';

const themeMode = ref<ThemeMode>('auto');
const systemPrefersDark = ref(true);
const isLoaded = ref(false);

const mediaQuery =
  typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

if (mediaQuery) systemPrefersDark.value = mediaQuery.matches;

const resolveTheme = (mode: ThemeMode): 'dark' | 'light' => {
  if (mode === 'auto') return systemPrefersDark.value ? 'dark' : 'light';
  return mode;
};

const applyTheme = () => {
  if (typeof document === 'undefined') return;
  const resolved = resolveTheme(themeMode.value);
  const root = document.documentElement;
  root.classList.toggle('theme-light', resolved === 'light');
  root.classList.toggle('theme-dark', resolved === 'dark');
  root.style.colorScheme = resolved;
};

// 系统主题变化时，仅在 auto 模式下重新应用
mediaQuery?.addEventListener?.('change', (event) => {
  systemPrefersDark.value = event.matches;
  if (themeMode.value === 'auto') applyTheme();
});

// 立即应用一次，避免首屏闪烁
applyTheme();

socket.emit('config:load', STORAGE_KEY_THEME, (saved: unknown) => {
  if (saved === 'dark' || saved === 'light' || saved === 'auto') {
    themeMode.value = saved;
  }
  isLoaded.value = true;
  applyTheme();
});

watch(themeMode, (value) => {
  applyTheme();
  if (isLoaded.value) {
    socket.emit('config:save', { key: STORAGE_KEY_THEME, value });
  }
});

export function useTheme() {
  const resolvedTheme = computed<'dark' | 'light'>(() => resolveTheme(themeMode.value));

  return {
    themeMode,
    resolvedTheme,
    systemPrefersDark
  };
}

export { applyTheme };
