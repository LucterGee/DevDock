import { ref } from 'vue';
import { socket } from './socket';

const homeDir = ref('');
let requested = false;

export const ensureHomeDir = () => {
  if (requested) return;
  requested = true;
  socket.emit('app:home-dir', (home: string) => {
    homeDir.value = typeof home === 'string' ? home : '';
  });
};

// 把 home 目录前缀换成 ~，仅用于展示；保存时后端会再展开
export const toDisplayPath = (value: string) => {
  const raw = String(value || '').trim();
  const home = homeDir.value;
  if (!raw || !home) return raw;
  if (raw === home) return '~';
  if (!raw.startsWith(home + '/')) return raw;
  return '~/' + raw.slice(home.length + 1);
};
