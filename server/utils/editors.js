const EDITOR_CONFIG_KEY = 'editor_config';

const EDITOR_OPTIONS = [
  { id: 'vscode', label: 'VS Code' },
  { id: 'system', label: '系统默认' },
];

const normalizeEditorConfig = (rawConfig) => {
  const source = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const editorId = EDITOR_OPTIONS.some((item) => item.id === source.editorId)
    ? source.editorId
    : 'vscode';
  return { editorId };
};

// macOS 用 open -a 不依赖 PATH；Windows 需要 code.cmd 才能被 execFile 找到
const resolveEditorLaunch = (editorId, targetPath, platform = process.platform) => {
  if (!targetPath) return null;

  if (editorId === 'system') {
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

const describeLaunchError = (error, stderr, spec) => {
  const detail = String(stderr || '').trim();
  if (detail) return detail;

  if (error && error.code === 'ENOENT') {
    if (spec && spec.command === 'open') {
      return '未找到「Visual Studio Code」，请确认已安装或改用系统默认打开';
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
