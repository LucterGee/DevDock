import { onMounted, onUnmounted } from 'vue';

type EscapeEntry = {
  handler: () => void;
  when?: () => boolean;
};

// 用栈记录当前打开的弹层，Esc 只关最上面那一层，
// 避免确认框盖在设置弹窗上时一次把两层都关掉
const stack: EscapeEntry[] = [];

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || event.isComposing) return;

  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const entry = stack[index];
    if (entry.when && !entry.when()) continue;
    event.stopPropagation();
    entry.handler();
    return;
  }
};

/**
 * 注册 Esc 关闭当前弹层。
 * @param handler 关闭动作
 * @param when 可选，返回 false 时跳过该层（组件常驻但当前不可见时用）
 */
export const useEscapeKey = (handler: () => void, when?: () => boolean) => {
  const entry: EscapeEntry = { handler, when };

  onMounted(() => {
    if (stack.length === 0) window.addEventListener('keydown', handleKeydown);
    stack.push(entry);
  });

  onUnmounted(() => {
    const index = stack.indexOf(entry);
    if (index >= 0) stack.splice(index, 1);
    if (stack.length === 0) window.removeEventListener('keydown', handleKeydown);
  });
};
