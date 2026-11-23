const { expandHome } = require('./pathUtils');

const EDITOR_CONFIG_KEY = 'editor_config';

const EDITOR_OPTIONS = [
  { id: 'vscode', label: 'VS Code' },
  { id: 'system', label: '系统默认' },
  { id: 'custom', label: '自定义…' },
];

const BUILTIN_IDS = EDITOR_OPTIONS.map((item) => item.id);

const normalizeEditorConfig = (rawConfig) => {
  const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};

  // 兼容早期的 editorId 字段
  const preset = BUILTIN_IDS.includes(source.preset)
    ? source.preset
    : BUILTIN_IDS.includes(source.editorId)
      ? source.editorId
      : 'vscode';

  return {
    preset,
    customCommand: expandHome(typeof source.customCommand === 'string' ? source.customCommand : ''),
  };
};

const isAppBundle = (value) => String(value || '').toLowerCase().endsWith('.app');

// macOS 用 open -a 不依赖 PATH；Windows 需要 code.cmd 才能被 execFile 找到
const resolveEditorLaunch = (config, targetPath, platform = process.platform) => {
  if (!targetPath) return null;

  const normalized = normalizeEditorConfig(config);

  if (normalized.preset === 'custom') {
    const command = normalized.customCommand;
    if (!command) return null;
    if (platform === 'darwin' && isAppBundle(command)) {
      return { command: 'open', args: ['-a', command, targetPath] };
    }
    return { command, args: [targetPath] };
  }

  if (normalized.preset === 'system') {
    if (platform === 'darwin') return { command: 'open', args: [targetPath] };
    if (platform === 'win32') return { command: 'explorer', args: [targetPath] };
    return { command: 'xdg-open', args: [targetPath] };
  }

  if (platform === 'darwin') {
    return { command: 'open', args: ['-a', 'Visual Studio Code', targetPath] };
  }
  if (platform === 'win32') {
    return { command: 'code.cmd', args: [targetPath] };
  }
  return { command: 'code', args: [targetPath] };
};

const describeLaunchError = (error, stderr, spec, config) => {
  const detail = String(stderr || '').trim();
  if (detail) return detail;

  const normalized = normalizeEditorConfig(config);
  if (normalized.preset === 'custom' && !normalized.customCommand) {
    return '请先填写自定义编辑器的命令或应用路径';
  }

  if (error && error.code === 'ENOENT') {
    if (spec && spec.command === 'open') {
      return '未找到指定的编辑器，请确认已安装或改用其它方式打开';
    }
    return '未找到编辑器命令，请在 VS Code 中执行「Shell Command: Install \'code\' command in PATH」后重试';
  }

  return (error && error.message) || '启动编辑器失败';
};

module.exports = {
  EDITOR_CONFIG_KEY,
  EDITOR_OPTIONS,
  normalizeEditorConfig,
  resolveEditorLaunch,
  describeLaunchError,
};
