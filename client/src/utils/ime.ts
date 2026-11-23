// 输入法处于组合态时，Enter 是确认候选词、上下键是切换候选，
// 都不应触发提交或历史导航
export const isImeComposing = (event?: KeyboardEvent): boolean =>
  Boolean(event && (event.isComposing || event.keyCode === 229));
