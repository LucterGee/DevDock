const fs = require('fs');
const os = require('os');
const path = require('path');

const TERMINAL_CONFIG_KEY = 'terminal_config';

const DARWIN_PRESETS = [
  { id: 'terminal', label: 'Terminal.app（系统默认）', bundleId: 'com.apple.Terminal', appName: 'Terminal' },
  { id: 'iterm2', label: 'iTerm2', bundleId: 'com.googlecode.iterm2', appName: 'iTerm' },
  { id: 'warp', label: 'Warp', bundleId: 'dev.warp.Warp-Stable', appName: 'Warp' },
  { id: 'ghostty', label: 'Ghostty', bundleId: 'com.mitchellh.ghostty', appName: 'Ghostty' },
  { id: 'wezterm', label: 'WezTerm', bundleId: 'com.github.wez.wezterm', appName: 'WezTerm' },
  { id: 'kitty', label: 'kitty', bundleId: 'net.kovidgoyal.kitty', appName: 'kitty' },
  { id: 'alacritty', label: 'Alacritty', bundleId: 'org.alacritty', appName: 'Alacritty' },
];

const WIN32_PRESETS = [
  { id: 'cmd', label: '命令提示符（cmd）' },
  { id: 'powershell', label: 'PowerShell' },
  { id: 'wt', label: 'Windows Terminal（wt）' },
  {
    id: 'gitbash',
    label: 'Git Bash',
    probePaths: [
      'C:\\Program Files\\Git\\git-bash.exe',
      'C:\\Program Files (x86)\\Git\\git-bash.exe',
    ],
  },
];

const LINUX_PRESETS = [
  { id: 'auto', label: '自动检测' },
  { id: 'gnome-terminal', label: 'GNOME Terminal' },
  { id: 'konsole', label: 'Konsole' },
  { id: 'kitty', label: 'kitty' },
  { id: 'alacritty', label: 'Alacritty' },
  { id: 'xterm', label: 'xterm' },
];

const DEFAULT_PRESET = { darwin: 'terminal', win32: 'cmd', linux: 'auto' };

const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

const getPlatformKey = (platform = process.platform) => {
  if (platform === 'darwin') return 'darwin';
  if (platform === 'win32') return 'win32';
  return 'linux';
};

const getPresetList = (platform = process.platform) => {
  const key = getPlatformKey(platform);
  if (key === 'darwin') return DARWIN_PRESETS;
  if (key === 'win32') return WIN32_PRESETS;
  return LINUX_PRESETS;
};

const expandHome = (value) => {
  const raw = normalizeText(value);
  if (!raw) return '';
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
  return raw;
};

const getTerminalPresets = (platform = process.platform) => {
  return getPresetList(platform).map((preset) => ({
    id: preset.id,
    label: preset.label,
  }));
};

const normalizePlatformConfig = (raw, platform) => {
  const fallbackPreset = DEFAULT_PRESET[getPlatformKey(platform)];
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const presetId = normalizeText(source.preset);
  const known = getPresetList(platform).some((item) => item.id === presetId);

  return {
    preset: known || presetId === 'custom' ? presetId : fallbackPreset,
    customApp: normalizeText(source.customApp),
  };
};

const normalizeTerminalConfig = (raw) => {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    darwin: normalizePlatformConfig(source.darwin, 'darwin'),
    win32: normalizePlatformConfig(source.win32, 'win32'),
    linux: normalizePlatformConfig(source.linux, 'linux'),
  };
};

const buildDarwinCandidates = (config, projectPath) => {
  const customApp = expandHome(config.customApp);

  if (config.preset === 'custom') {
    if (!customApp) {
      return { success: false, error: '已选择自定义终端，但未填写应用名称或路径' };
    }
    return { success: true, candidates: [{ command: 'open', args: ['-a', customApp, projectPath] }] };
  }

  const preset = DARWIN_PRESETS.find((item) => item.id === config.preset) || DARWIN_PRESETS[0];
  if (preset.bundleId) {
    return {
      success: true,
      candidates: [
        { command: 'open', args: ['-b', preset.bundleId, projectPath] },
        { command: 'open', args: ['-a', preset.appName, projectPath] },
      ],
    };
  }

  return { success: true, candidates: [{ command: 'open', args: ['-a', preset.appName, projectPath] }] };
};

const buildWin32Candidates = (config, projectPath) => {
  const customApp = expandHome(config.customApp);

  if (config.preset === 'custom') {
    if (!customApp) {
      return { success: false, error: '已选择自定义终端，但未填写可执行文件路径' };
    }
    return {
      success: true,
      candidates: [{ command: 'cmd.exe', args: ['/c', 'start', '', '/D', projectPath, customApp] }],
    };
  }

  if (config.preset === 'wt') {
    return {
      success: true,
      candidates: [
        { command: 'wt.exe', args: ['-d', projectPath] },
        { command: 'cmd.exe', args: ['/c', 'start', '', '/D', projectPath, 'cmd', '/K'] },
      ],
    };
  }

  if (config.preset === 'powershell') {
    return {
      success: true,
      candidates: [
        { command: 'cmd.exe', args: ['/c', 'start', '', '/D', projectPath, 'powershell', '-NoExit'] },
      ],
    };
  }

  if (config.preset === 'gitbash') {
    const preset = WIN32_PRESETS.find((item) => item.id === 'gitbash');
    const found = (preset.probePaths || []).find((item) => fs.existsSync(item));
    if (!found) {
      return { success: false, error: '未找到 Git Bash，请确认安装路径或改用自定义终端' };
    }
    return { success: true, candidates: [{ command: found, args: [`--cd=${projectPath}`] }] };
  }

  return {
    success: true,
    candidates: [
      { command: 'cmd.exe', args: ['/c', 'start', '', '/D', projectPath, 'cmd', '/K'] },
    ],
  };
};

const buildLinuxCandidates = (config, projectPath) => {
  const customApp = expandHome(config.customApp);

  if (config.preset === 'custom') {
    if (!customApp) {
      return { success: false, error: '已选择自定义终端，但未填写可执行文件路径' };
    }
    return { success: true, candidates: [{ command: customApp, args: ['--working-directory', projectPath] }] };
  }

  if (config.preset === 'auto') {
    return {
      success: true,
      candidates: [
        { command: 'x-terminal-emulator', args: ['--working-directory', projectPath] },
        { command: 'gnome-terminal', args: ['--working-directory', projectPath] },
        { command: 'konsole', args: ['--workdir', projectPath] },
        { command: 'kitty', args: ['--directory', projectPath] },
        { command: 'alacritty', args: ['--working-directory', projectPath] },
        { command: 'xterm', args: ['-cd', projectPath] },
      ],
    };
  }

  if (config.preset === 'gnome-terminal') {
    return { success: true, candidates: [{ command: 'gnome-terminal', args: ['--working-directory', projectPath] }] };
  }

  if (config.preset === 'konsole') {
    return { success: true, candidates: [{ command: 'konsole', args: ['--workdir', projectPath] }] };
  }

  if (config.preset === 'kitty') {
    return { success: true, candidates: [{ command: 'kitty', args: ['--directory', projectPath] }] };
  }

  if (config.preset === 'alacritty') {
    return { success: true, candidates: [{ command: 'alacritty', args: ['--working-directory', projectPath] }] };
  }

  return { success: true, candidates: [{ command: 'xterm', args: ['-cd', projectPath] }] };
};

const resolveTerminalCandidates = (rawConfig, platform = process.platform, projectPath = '') => {
  const targetPath = normalizeText(projectPath);
  const pathApi = getPlatformKey(platform) === 'win32' ? path.win32 : path.posix;
  if (!targetPath || !pathApi.isAbsolute(targetPath)) {
    return { success: false, error: '项目路径无效，必须是绝对路径' };
  }

  const normalized = normalizeTerminalConfig(rawConfig);
  const platformKey = getPlatformKey(platform);
  const platformConfig = normalized[platformKey];

  if (platformKey === 'darwin') return buildDarwinCandidates(platformConfig, targetPath);
  if (platformKey === 'win32') return buildWin32Candidates(platformConfig, targetPath);
  return buildLinuxCandidates(platformConfig, targetPath);
};

module.exports = {
  TERMINAL_CONFIG_KEY,
  normalizeTerminalConfig,
  getTerminalPresets,
  resolveTerminalCandidates,
  getPlatformKey,
};
