const express = require('express');
const http = require('http');
const net = require('net');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, exec, execFile } = require('child_process');

const monitor = require('./utils/monitor');
const nodeVersions = require('./utils/nodeVersions');
const nodeManager = require('./services/node/manager');
const appUpdater = require('./utils/appUpdater');
const { resolveConfigPath } = require('./utils/appPaths');
const gitBranches = require('./utils/gitBranches');
const { expandHome } = require('./utils/pathUtils');
const { isAvailable: isSecretStorageAvailable } = require('./utils/secretStore');
const { openAiConfigList, sealAiConfigList, migratePlaintextSecrets } = require('./utils/aiSecrets');
const { resolveCommandExecution } = require('./utils/commandExecution');
const {
  TERMINAL_CONFIG_KEY,
  normalizeTerminalConfig,
  getTerminalPresets,
  resolveTerminalCandidates,
} = require('./utils/terminalLauncher');
const { createWeeklyReportRuntime } = require('./services/weeklyReport/runtime');
const { createNginxRuntime } = require('./services/nginx/runtime');
const { discoverAuthors, collectActivity, runGit } = require('./services/weeklyReport/gitActivity');
const { buildReportContext } = require('./services/weeklyReport/reportContext');
const { generateText } = require('./services/ai/generateText');
const {
  WECHAT_DEVTOOLS_CONFIG_KEY,
  hasWeChatProjectConfig,
  normalizeWechatDevtoolsConfig,
  resolveWechatLaunchSpec,
} = require('./utils/projectTools');
const {
  EDITOR_CONFIG_KEY,
  normalizeEditorConfig,
  resolveEditorLaunch,
  describeLaunchError,
} = require('./utils/editors');

// 配置文件存在用户目录下，防止误删
const AI_CONFIG_LIST_KEY = 'ai_config_list';
const CONFIG_PATH = resolveConfigPath('config.json', '.devdock-config.json');
const WEEKLY_REPORT_STATE_PATH = resolveConfigPath('weekly-report.json', '.devdock-weekly-report.json');
const WEEKLY_REPORT_CACHE_PATH = resolveConfigPath('weekly-report-cache.json', '.devdock-weekly-report-cache.json');

const weeklyReportRuntime = createWeeklyReportRuntime({
  statePath: WEEKLY_REPORT_STATE_PATH,
  cachePath: WEEKLY_REPORT_CACHE_PATH
});
const app = express();
app.use(cors());

const clientDistPath = path.join(__dirname, '../client/dist');

if (fs.existsSync(clientDistPath)) {
    app.use(express.static(clientDistPath));
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// ✅ 1. 启动监控循环
monitor.startLoop(io);

// 应用更新状态广播（仅桌面打包环境可用）
appUpdater.setup();
appUpdater.onState((payload) => {
  io.emit('app:update:state', payload);
});

// 存储运行中的子进程: Map<taskKey, ChildProcess>
const processes = new Map();
const commandProcesses = new Map();
// --- 工具函数 ---
const killProcessTree = (child, taskKey) => {
  if (!child || !child.pid) return;
  console.log(`💀 [KILL] 正在终止: ${taskKey} (PID: ${child.pid})`);
  try {
    if (process.platform === 'win32') {
      exec(`taskkill /pid ${child.pid} /f /t`, (err) => {
         if (err && !err.message.includes('not found')) console.error(err.message);
      });
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch (e) { console.error(e); }
};

// 辅助函数：读取所有配置
const readConfigFile = () => {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch (e) {
    console.error('读取配置失败', e);
  }
  return {}; // 如果文件不存在或出错，返回空对象
};

// 辅助函数：写入配置
const writeConfigFile = (data) => {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('写入配置失败', e);
  }
};
// 启动时把历史明文 API Key 加密；加密不可用则保持原样（读取时视为空）
let aiSecretsMigrated = false;
// 首次读取时再迁移：safeStorage 在 app ready 之前不可用
const ensureAiSecretsMigrated = (allData) => {
  if (aiSecretsMigrated) return allData;
  aiSecretsMigrated = true;
  try {
    const result = migratePlaintextSecrets(allData[AI_CONFIG_LIST_KEY]);
    if (!result.changed) return allData;
    allData[AI_CONFIG_LIST_KEY] = result.list;
    writeConfigFile(allData);
    console.log('[secret] 已加密历史明文 API Key');
  } catch (error) {
    console.error('[secret] 迁移失败:', error.message);
  }
  return allData;
};

const readWechatDevtoolsConfig = () => {
  const allConfig = readConfigFile();
  return normalizeWechatDevtoolsConfig(allConfig[WECHAT_DEVTOOLS_CONFIG_KEY]);
};

const resolveTargetNodeVersion = (projectPath, requestedVersion) => {
  if (requestedVersion === 'system') return null;
  if (requestedVersion) return requestedVersion;
  const detected = nodeVersions.detectProjectNodeVersion(projectPath);
  const resolved = detected ? nodeVersions.resolveNodeVersion(detected.raw) : null;
  return resolved?.version || null;
};

const buildNodeVersionEnv = (targetNodeVersion) => {
  if (!targetNodeVersion) return null;
  return nodeVersions.buildEnvWithNodeVersion(targetNodeVersion);
};

const emitCommandStatus = (projectPath, projectName, running, command = '') => {
  io.emit('command:status-change', {
    projectPath,
    projectName,
    running,
    command
  });
};

// 命令输出原样透传，行首不再加 [command] 前缀；
// 输入与输出的区分交给带颜色的命令行本身
const formatCommandLogChunk = (chunk) => String(chunk || '');

const scanRecursively = (currentPath, depth = 0) => {
  if (depth > 4) return [];
  const folderName = path.basename(currentPath);
if (['node_modules', '.git', 'dist', 'build', '.idea', '.vscode', 'public', 'uni_modules', 'static'].includes(folderName)) {
    return [];
  }

  const pkgPath = path.join(currentPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      let runner = 'npm'; 
      if (fs.existsSync(path.join(currentPath, 'pnpm-lock.yaml'))) runner = 'pnpm';
      else if (fs.existsSync(path.join(currentPath, 'yarn.lock'))) runner = 'yarn';
      
      // 检测项目所需的 Node 版本
      const detected = nodeVersions.detectProjectNodeVersion(currentPath);
      const resolved = detected ? nodeVersions.resolveNodeVersion(detected.raw) : null;
      return [{
        name: folderName,
        path: currentPath,
        runner: runner,
        scripts: pkg.scripts || {},
        detectedNodeVersion: detected,   // { raw, source } | null
        resolvedNodeVersion: resolved     // { version, exact } | null
      }];
    } catch (e) { return []; }
  }

  let results = [];
  try {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        results = results.concat(scanRecursively(path.join(currentPath, entry.name), depth + 1));
      }
    }
  } catch (err) {}
  return results;
};

const scanProjects = (dirPath) => {
  if (!fs.existsSync(dirPath)) return [];
  return scanRecursively(dirPath);
};

const normalizeSelectedFolderPath = (selectedPath) =>
  String(selectedPath || '').trim().replace(/[\\\/]+$/, '');

const openFolderDialogByElectron = async () => {
  try {
    const electron = require('electron');
    const dialog = electron?.dialog;
    if (!dialog || typeof dialog.showOpenDialog !== 'function') {
      return { supported: false, selectedPath: '' };
    }

    const parentWindow =
      typeof electron?.BrowserWindow?.getFocusedWindow === 'function'
        ? electron.BrowserWindow.getFocusedWindow() || undefined
        : undefined;

    const { canceled, filePaths } = await dialog.showOpenDialog(parentWindow, {
      title: '请选择项目父目录',
      properties: ['openDirectory', 'createDirectory']
    });

    return {
      supported: true,
      selectedPath: canceled ? '' : (filePaths?.[0] || '')
    };
  } catch (e) {
    return { supported: false, selectedPath: '' };
  }
};

// --- Socket 逻辑 ---
const nginxRuntime = createNginxRuntime();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  socket.emit('app:update:state', appUpdater.getState());

  socket.on('app:get-version', (callback) => {
    const updaterState = appUpdater.getState();
    callback?.({
      appName: updaterState.appName || 'DevDock',
      version: updaterState.currentVersion || '0.0.0'
    });
  });

  socket.on('app:update:get-state', (callback) => {
    callback?.(appUpdater.getState());
  });

  socket.on('app:update:check', async (callback) => {
    const result = await appUpdater.checkForUpdates();
    callback?.(result);
  });

  socket.on('app:update:open-release', (callback) => {
    callback(appUpdater.openReleasePage());
  });
  socket.on('app:update:quit-install', (callback) => {
    const result = appUpdater.quitAndInstall();
    callback?.(result);
  });

// 1. 弹窗选择文件夹
  // 仅返回所选目录，不触发项目扫描等副作用
  socket.on('dialog:select-directory', async (callback) => {
    const respond = (payload) => {
      if (typeof callback === 'function') callback(payload);
    };

    const electronResult = await openFolderDialogByElectron();
    if (electronResult.supported) {
      const selectedPath = normalizeSelectedFolderPath(electronResult.selectedPath);
      respond({ success: Boolean(selectedPath), path: selectedPath || '' });
      return;
    }

    if (process.platform === 'win32') {
      const psScript = [
        'Add-Type -Name Win32 -Namespace Native -MemberDefinition \'[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();\'',
        '$hwnd = [Native.Win32]::GetForegroundWindow()',
        '$shell = New-Object -ComObject Shell.Application',
        "$folder = $shell.BrowseForFolder($hwnd, '请选择目录', 0x51, '')",
        'if ($folder) { $folder.Self.Path }',
      ].join('; ');
      const encodedCommand = Buffer.from(psScript, 'utf16le').toString('base64');
      const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand]);
      let output = '';
      child.stdout.on('data', (data) => { output += data.toString(); });
      child.on('error', (error) => respond({ success: false, error: error.message }));
      child.on('close', () => {
        const selectedPath = normalizeSelectedFolderPath(output.trim());
        respond({ success: Boolean(selectedPath), path: selectedPath || '' });
      });
      return;
    }

    const child = spawn('osascript', ['-e', 'POSIX path of (choose folder with prompt "请选择目录")']);
    let output = '';
    child.stdout.on('data', (data) => { output += data.toString(); });
    child.on('error', (error) => respond({ success: false, error: error.message }));
    child.on('close', () => {
      const selectedPath = normalizeSelectedFolderPath(output.trim());
      respond({ success: Boolean(selectedPath), path: selectedPath || '' });
    });
  });

  // 仅返回所选文件，供自定义路径类配置使用
  socket.on('dialog:select-file', async (callback) => {
    const respond = (payload) => {
      if (typeof callback === 'function') callback(payload);
    };

    try {
      const electron = require('electron');
      const dialog = electron?.dialog;
      if (dialog && typeof dialog.showOpenDialog === 'function') {
        const parentWindow =
          typeof electron?.BrowserWindow?.getFocusedWindow === 'function'
            ? electron.BrowserWindow.getFocusedWindow() || undefined
            : undefined;
        const { canceled, filePaths } = await dialog.showOpenDialog(parentWindow, {
          title: '请选择文件',
          properties: ['openFile'],
        });
        const selectedPath = canceled ? '' : (filePaths?.[0] || '');
        respond({ success: Boolean(selectedPath), path: selectedPath });
        return;
      }
    } catch (e) {
      // 非 Electron 环境，继续走系统原生弹窗
    }

    const command = process.platform === 'win32'
      ? {
          cmd: 'powershell',
          args: [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; if ($d.ShowDialog() -eq 'OK') { $d.FileName }",
          ],
        }
      : { cmd: 'osascript', args: ['-e', 'POSIX path of (choose file with prompt "请选择文件")'] };

    const child = spawn(command.cmd, command.args);
    let output = '';
    child.stdout.on('data', (data) => { output += data.toString(); });
    child.on('error', (error) => respond({ success: false, error: error.message }));
    child.on('close', () => {
      const selectedPath = output.trim().split('\n')[0] || '';
      respond({ success: Boolean(selectedPath), path: selectedPath });
    });
  });

  socket.on('open-folder-dialog', async () => {
    console.log('正在唤起文件夹选择弹窗...');

    const electronDialogResult = await openFolderDialogByElectron();
    if (electronDialogResult.supported) {
      const selectedPath = normalizeSelectedFolderPath(electronDialogResult.selectedPath);
      if (selectedPath) {
        socket.emit('folder-selected', selectedPath);
        const projects = scanProjects(selectedPath);
        socket.emit('projects-loaded', enrichProjects(projects));
      }
      return;
    }

    if (process.platform === 'win32') {
      // Windows: 用 Shell.Application COM 对象替代 WinForms，无需加载 .NET 程序集
      // 通过 GetForegroundWindow 获取当前前台窗口句柄，让弹窗置顶显示
      const psScript = `
Add-Type -Name Win32 -Namespace Native -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();'
$hwnd = [Native.Win32]::GetForegroundWindow()
$shell = New-Object -ComObject Shell.Application
$folder = $shell.BrowseForFolder($hwnd, '请选择项目父目录', 0x51, '')
if ($folder) { $folder.Self.Path }
`;
      const encodedCommand = Buffer.from(psScript, 'utf16le').toString('base64');
      const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodedCommand]);

      child.stdout.on('data', (data) => {
        const selectedPath = normalizeSelectedFolderPath(data.toString().trim());
        if (!selectedPath) return;
        socket.emit('folder-selected', selectedPath);
        const projects = scanProjects(selectedPath);
        socket.emit('projects-loaded', enrichProjects(projects));
      });
    } else {
      // macOS: 使用 osascript 原生弹窗
      const child = spawn('osascript', ['-e', 'POSIX path of (choose folder with prompt "请选择项目父目录")']);

      child.stdout.on('data', (data) => {
        const selectedPath = normalizeSelectedFolderPath(data.toString().trim());
        if (!selectedPath) return;
        socket.emit('folder-selected', selectedPath);
        const projects = scanProjects(selectedPath);
        socket.emit('projects-loaded', enrichProjects(projects));
      });
    }
  });

  // 辅助函数：为项目列表补充运行状态和 Node 版本覆盖信息
  const enrichProjects = (projects) => {
    const config = readConfigFile();
    const overrides = config.node_version_overrides || {};
    const devScripts = config.dev_script_by_project || {};

    return projects.map(p => {
      // 同步运行状态
      const runningScripts = {};
      for (const [taskKey] of processes) {
        if (taskKey.startsWith(`${p.name}:`)) {
          runningScripts[taskKey.split(':')[1]] = true;
        }
      }

      // 合并 Node 版本覆盖
      const override = overrides[p.path] || null;
      let effectiveNodeVersion = null;
      let nodeVersionSource = 'system';

      if (override && override !== 'system') {
        // 手动指定了具体版本
        effectiveNodeVersion = override;
        nodeVersionSource = 'manual';
      } else if (override === 'system') {
        // 显式选择系统默认，忽略自动检测
        effectiveNodeVersion = null;
        nodeVersionSource = 'system';
      } else if (p.resolvedNodeVersion) {
        // 无覆盖，使用自动检测
        effectiveNodeVersion = p.resolvedNodeVersion.version;
        nodeVersionSource = 'auto';
      }

      const commandEntry = commandProcesses.get(p.path);
      const isMiniProgram = hasWeChatProjectConfig(p.path);

      return {
        ...p,
        runningScripts,
        nodeVersionOverride: (override && override !== 'system') ? override : null,
        // 开发快捷按钮绑定的脚本；为空时前端自动猜
        devScriptOverride: devScripts[p.path] || null,
        effectiveNodeVersion,
        nodeVersionSource,
        isMiniProgram,
        commandRunning: !!commandEntry,
        runningCommand: commandEntry?.command || ''
      };
    });
  };

  // 1. 扫描目录
  socket.on('scan-dir', (dirPath) => {
    const projects = scanProjects(expandHome(dirPath));
    socket.emit('projects-loaded', enrichProjects(projects));
  });

  // 2. 启动任务 (核心修改：加入监控 + Node 版本切换)
  socket.on('start-task', ({ projectName, script, projectPath, runner, nodeVersion }) => {
    console.log(`📩 [start-task] 收到请求: ${projectName}:${script}, runner=${runner}, nodeVersion=${nodeVersion}`);
    const taskKey = `${projectName}:${script}`;
    if (processes.has(taskKey)) {
      console.warn(`⚠️ [start-task] 任务 ${taskKey} 已在运行中，忽略重复请求`);
      return;
    }

    const currentRunner = runner || 'npm';

    // 确定使用的 Node 版本和启动命令，整体包裹 try-catch 防止静默失败
    let targetNodeVersion = null;
    let customEnv = null; // null = 继承父进程环境（对 webpack HMR 更友好）
    let cmd = currentRunner;
    let spawnArgs = ['run', script];
    if (process.platform === 'win32') cmd = `${currentRunner}.cmd`;

    try {
      // 确定版本：手动指定 > 自动检测 > 系统默认
      targetNodeVersion = resolveTargetNodeVersion(projectPath, nodeVersion);

      if (targetNodeVersion) {
        // 仅在需要切换 Node 版本时才构建自定义 env（修改 PATH）
        customEnv = buildNodeVersionEnv(targetNodeVersion);

        const versionDir = nodeVersions.getVersionDir(targetNodeVersion);
        if (versionDir) {
          const nodeExe = nodeVersions.getNodeBin(versionDir);
          const cliJs = nodeVersions.getRunnerCliJs(versionDir, currentRunner);

          if (cliJs) {
            cmd = nodeExe;
            spawnArgs = [cliJs, 'run', script];
          } else {
            cmd = process.platform === 'win32' ? `${currentRunner}.cmd` : currentRunner;
            console.warn(`[Node切换] ${currentRunner} cli.js 未在 ${versionDir} 中找到，回退到 PATH 解析`);
          }
        }
      }
    } catch (e) {
      // 版本检测或命令解析出错时，回退到默认行为
      console.error(`[Node切换] 版本处理异常，回退到系统默认:`, e.message);
      targetNodeVersion = null;
      customEnv = null;
      cmd = currentRunner;
      spawnArgs = ['run', script];
      if (process.platform === 'win32') cmd = `${currentRunner}.cmd`;
    }

    console.log(`🚀 启动任务: ${taskKey}${targetNodeVersion ? ` (Node v${targetNodeVersion})` : ' (系统默认)'}`);
    console.log(`   命令: ${cmd} ${spawnArgs.join(' ')}`);

    // 构建 spawn 选项
    // 不切换 Node 版本时不传 env，让子进程自然继承父进程环境
    // 避免 { ...process.env } 展开后丢失 Windows 大小写不敏感特性
    // 这对 webpack-dev-server 的 HMR WebSocket 正常工作很重要
    const spawnOpts = {
      cwd: projectPath,
      shell: true,
      detached: process.platform !== 'win32',
      stdio: 'pipe'
    };
    if (customEnv) {
      spawnOpts.env = customEnv;
    }

    const child = spawn(cmd, spawnArgs, spawnOpts);

    processes.set(taskKey, child);
    
    if (child.pid) {
      // 注意：这里用 taskKey (如 VueAdmin:dev) 作为 ID
      monitor.addMonitor(taskKey, child.pid);
      console.log(`➕ 已添加监控: ${taskKey}, PID: ${child.pid}`);
    }

    io.emit('status-change', { name: projectName, script, running: true });

    const logHandler = (data) => {
      const text = data.toString();
      io.emit('log', { name: projectName, data: text });
    };
    child.stdout.on('data', logHandler);
    child.stderr.on('data', logHandler);
    child.on('error', (err) => {
       io.emit('log', { name: projectName, data: `❌ 启动失败: ${err.message}` });
    });

    child.on('close', (code) => {
      if (processes.has(taskKey)) {
          // ✅ 进程退出，移除监控
          monitor.removeMonitor(taskKey);
          processes.delete(taskKey);
          io.emit('status-change', { name: projectName, script, running: false });
          io.emit('log', { name: projectName, data: `\n[Exited with code ${code}]\n` });
      }
    });
  });

  // 3. 停止任务
  // --- 4. 停止任务 (修复版) ---
  socket.on('stop-task', (projectName) => {
    console.log(`🛑 [收到指令] 请求停止项目: ${projectName}`);

    // 1. 先把 Map 转成数组，防止在遍历时修改 Map 导致循环中断
    const allTasks = Array.from(processes.entries());
    let found = false;

    for (const [key, child] of allTasks) {
        // key 的格式是 "项目名:脚本名" (例如 "VueAdmin:dev")
        // 所以我们检查 key 是否以 "VueAdmin:" 开头
        if (key.startsWith(`${projectName}:`)) {
            found = true;
            const scriptName = key.split(':')[1];
            console.log(`   - 匹配到任务: ${key} (PID: ${child.pid})，正在终止...`);

            // 2. 移除监控
            try {
              monitor.removeMonitor(key);
            } catch (e) {
              console.error('   - 移除监控失败:', e.message);
            }
            
            // 3. 从内存移除
            processes.delete(key);
            
            // 4. 通知前端变红
            socket.emit('status-change', { name: projectName, script: scriptName, running: false });
            
            // 5. 杀进程
            killProcessTree(child, key);
        }
    }

    if (!found) {
        console.warn(`⚠️ 未找到项目 [${projectName}] 的任何运行任务。当前运行列表:`, Array.from(processes.keys()));
        // 强制告诉前端：这个项目没在跑，把它变红（防止前端卡在绿色状态）
        // 既然找不到具体的 script，我们无法精确变红，但通常这意味着后端重启过
        // 你可以选择发一个特殊的事件重置前端，或者忽略
    } else {
        socket.emit('log', { name: projectName, data: '\r\n\x1b[31m[ ☠️ 已执行强制终止指令 ]\x1b[0m\r\n' });
    }
  });

  socket.on('project:run-command', ({ projectPath, projectName, command, nodeVersion }, callback) => {
    const trimmedCommand = String(command || '').trim();
    if (!trimmedCommand) {
      callback?.({ success: false, error: '命令不能为空' });
      return;
    }

    if (!projectPath || !path.isAbsolute(projectPath)) {
      callback?.({ success: false, error: '项目路径无效，必须是绝对路径' });
      return;
    }

    if (commandProcesses.has(projectPath)) {
      callback?.({ success: false, error: '该项目已有自定义命令正在运行' });
      return;
    }

    let targetNodeVersion = null;
    let customEnv = null;
    let execution = {
      command: trimmedCommand,
      args: [],
      shell: true
    };
    try {
      targetNodeVersion = resolveTargetNodeVersion(projectPath, nodeVersion);
      if (targetNodeVersion) {
        customEnv = buildNodeVersionEnv(targetNodeVersion);
      }
      execution = resolveCommandExecution({
        command: trimmedCommand,
        projectPath,
        targetNodeVersion,
        platform: process.platform,
        nodeVersionsApi: nodeVersions
      });
    } catch (e) {
      console.error('[project:run-command] Node 版本处理失败，回退系统默认:', e.message);
      targetNodeVersion = null;
      customEnv = null;
      execution = {
        command: trimmedCommand,
        args: [],
        shell: true
      };
    }

    const spawnOptions = {
      cwd: projectPath,
      shell: execution.shell,
      detached: process.platform !== 'win32',
      stdio: 'pipe'
    };
    if (customEnv) {
      spawnOptions.env = customEnv;
    }

    const child = spawn(execution.command, execution.args, spawnOptions);
    const entry = {
      child,
      command: trimmedCommand,
      projectName
    };

    commandProcesses.set(projectPath, entry);
    emitCommandStatus(projectPath, projectName, true, trimmedCommand);

    io.emit('log', {
      name: projectName,
      data: `\n\x1b[1;36m$ ${trimmedCommand}\x1b[0m${targetNodeVersion ? `  \x1b[90m(Node v${targetNodeVersion})\x1b[0m` : ''}\n`
    });

    const appendCommandLog = (data) => {
      io.emit('log', {
        name: projectName,
        data: formatCommandLogChunk(data)
      });
    };

    const finalizeCommand = (payload = {}) => {
      const active = commandProcesses.get(projectPath);
      if (active?.child === child) {
        commandProcesses.delete(projectPath);
        emitCommandStatus(projectPath, projectName, false, trimmedCommand);
      }

      if (payload.logMessage) {
        io.emit('log', {
          name: projectName,
          data: payload.logMessage
        });
      }
    };

    child.stdout.on('data', appendCommandLog);
    child.stderr.on('data', appendCommandLog);

    child.on('error', (err) => {
      finalizeCommand({
        logMessage: `\x1b[31m启动失败: ${err.message}\x1b[0m\n`
      });
    });

    child.on('close', (code) => {
      finalizeCommand({
        logMessage: `\x1b[90m进程退出，code ${code}\x1b[0m\n`
      });
    });

    callback?.({
      success: true,
      targetNodeVersion
    });
  });

  socket.on('project:stop-command', ({ projectPath }, callback) => {
    const entry = commandProcesses.get(projectPath);
    if (!entry) {
      callback?.({ success: false, error: '该项目没有正在运行的自定义命令' });
      return;
    }

    commandProcesses.delete(projectPath);
    emitCommandStatus(projectPath, entry.projectName, false, entry.command);
    io.emit('log', {
      name: entry.projectName,
      data: '\x1b[90m已发送停止信号\x1b[0m\n'
    });
    killProcessTree(entry.child, `command:${entry.projectName}`);
    callback?.({ success: true });
  });

  // 5. 打开文件 (VS Code)
  socket.on('open-file', (filePath) => {
      // 防止命令注入的简单过滤
      if (!filePath || /[&|;]/.test(filePath)) return;
      exec(`code -g "${filePath}"`, (err) => {
          if (err) exec(`explorer /select,"${filePath.split(':')[0]}"`); // 降级方案
      });
  });
  // --- 打开项目所在的文件夹 (资源管理器) ---
  socket.on('open-project-folder', (projectPath) => {
    console.log('📂 请求打开文件夹:', projectPath);
    if (!projectPath) return;

    if (process.platform === 'win32') {
      // 通过 Shell.Application COM 对象打开，窗口能正确获得焦点置顶
      const escaped = projectPath.replace(/'/g, "''");
      exec(`powershell -NoProfile -NonInteractive -Command "(New-Object -ComObject Shell.Application).Explore('${escaped}')"`);
    } else if (process.platform === 'darwin') {
      exec(`open "${projectPath}"`);
    } else {
      exec(`xdg-open "${projectPath}"`);
    }
  });

  // --- 在项目路径下打开终端（终端类型由设置中的 terminal_config 决定）---
  socket.on('open-terminal', (projectPath, callback) => {
    const respond = typeof callback === 'function' ? callback : () => {};
    console.log('💻 请求打开终端:', projectPath);

    const config = normalizeTerminalConfig(readConfigFile()[TERMINAL_CONFIG_KEY]);
    const resolved = resolveTerminalCandidates(config, process.platform, projectPath);
    if (!resolved.success) {
      respond({ success: false, error: resolved.error });
      return;
    }

    const tryCandidate = (index) => {
      if (index >= resolved.candidates.length) {
        respond({ success: false, error: '未找到可用的终端，请在设置 → 开发工具中重新选择' });
        return;
      }

      const { command, args } = resolved.candidates[index];
      execFile(command, args, { windowsHide: true }, (err) => {
        if (err) {
          tryCandidate(index + 1);
          return;
        }
        respond({ success: true, command });
      });
    };

    tryCandidate(0);
  });

  socket.on('terminal:get-presets', (callback) => {
    callback?.({
      platform: process.platform,
      presets: getTerminalPresets(process.platform)
    });
  });

  socket.on('editor:open-project', ({ projectPath }, callback) => {
    const respond = (payload) => {
      if (typeof callback === 'function') callback(payload);
    };

    const target = String(projectPath || '').trim();
    if (!target || !fs.existsSync(target)) {
      respond({ success: false, error: '项目路径不存在：' + target });
      return;
    }

    const config = normalizeEditorConfig(readConfigFile()[EDITOR_CONFIG_KEY]);
    const spec = resolveEditorLaunch(config, target, process.platform);
    if (!spec) {
      respond({ success: false, error: '无法解析编辑器启动命令' });
      return;
    }

    execFile(spec.command, spec.args, { timeout: 15000 }, (error, stdout, stderr) => {
      if (error) {
        respond({ success: false, error: describeLaunchError(error, stderr, spec, config) });
        return;
      }
      respond({ success: true, preset: config.preset });
    });
  });

  socket.on('tool:open-wechat-devtools', ({ projectPath }, callback) => {
    if (!projectPath || !path.isAbsolute(projectPath)) {
      callback?.({ success: false, error: '项目路径无效，必须是绝对路径' });
      return;
    }

    if (!hasWeChatProjectConfig(projectPath)) {
      callback?.({ success: false, error: '该项目未检测到 project.config.json，不视为小程序项目' });
      return;
    }

    const launchResult = resolveWechatLaunchSpec(readWechatDevtoolsConfig(), process.platform);
    if (!launchResult.success || !launchResult.launchSpec) {
      callback?.({ success: false, error: launchResult.error });
      return;
    }

    if (process.platform !== 'win32' && process.platform !== 'darwin') {
      callback?.({ success: false, error: '当前平台暂不支持打开微信开发者工具' });
      return;
    }

    try {
      const { command, args } = launchResult.launchSpec;

      const child = spawn(command, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: process.platform === 'win32'
      });

      let responded = false;
      const finalize = (payload) => {
        if (responded) return;
        responded = true;
        callback?.(payload);
      };

      child.once('error', (err) => {
        finalize({ success: false, error: `启动微信开发者工具失败: ${err.message}` });
      });

      child.once('spawn', () => {
        child.unref();
        finalize({ success: true, command });
      });
    } catch (e) {
      callback?.({ success: false, error: `启动微信开发者工具失败: ${e.message}` });
    }
  });

  // 1. 获取 Git 变更 (用于发给 AI)
  // --- 分支管理 ---
  // 卡片上的当前分支：批量读取，避免逐个往返
  socket.on('git:current-branches', ({ projectPaths } = {}, callback) => {
    const branches = {};
    for (const projectPath of Array.isArray(projectPaths) ? projectPaths : []) {
      branches[projectPath] = gitBranches.readCurrentBranch(projectPath);
    }
    callback({ success: true, branches });
  });

  socket.on('git:branches', async ({ projectPath, fetch } = {}, callback) => {
    try {
      const result = await gitBranches.listBranches(projectPath, { fetch: fetch !== false });
      callback({ success: true, ...result });
    } catch (error) {
      callback({ success: false, error: error.message });
    }
  });

  socket.on('git:checkout', async ({ projectPath, branch, isRemote } = {}, callback) => {
    try {
      const current = await gitBranches.checkoutBranch(projectPath, branch, { isRemote: Boolean(isRemote) });
      callback({ success: true, current });
    } catch (error) {
      callback({ success: false, error: error.message });
    }
  });

  socket.on('git:create-branch', async ({ projectPath, branch } = {}, callback) => {
    try {
      const current = await gitBranches.createBranch(projectPath, branch);
      callback({ success: true, current });
    } catch (error) {
      callback({ success: false, error: error.message });
    }
  });

  socket.on('git:get-diff', ({ projectPath }, callback) => {
    // 最近提交只用于让 AI 判断该仓库的提交格式（有无 emoji、有无 scope、标点习惯），
    // 不参与内容生成，所以取 subject 即可
    exec('git log -20 --pretty=format:%s', { cwd: projectPath }, (logErr, logOut) => {
      const recentMessages = logErr
        ? []
        : String(logOut || '').split('\n').map((line) => line.trim()).filter(Boolean);

      const reply = (diff) => callback({ diff, error: null, recentMessages });

      // 获取未暂存和已暂存的所有变更
      // 限制 4000 字符，防止 Token 爆炸
      exec('git diff HEAD', { cwd: projectPath, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err) {
          // 可能是新仓库没有 HEAD，尝试 git status
          exec('git status -s', { cwd: projectPath }, (e, statusOut) => {
            reply(statusOut || '');
          });
        } else {
          reply(stdout.length > 4000 ? stdout.slice(0, 4000) + '\n...(截断)' : stdout);
        }
      });
    });
  });

  // 2. 执行 Git 提交（支持自动拉取和推送）
  socket.on('git:commit', ({ projectPath, message, autoPush }, callback) => {
    console.log(`📝 [Git] 正在提交项目: ${projectPath}${autoPush ? ' (Pull → Commit → Push)' : ''}`);

    // 封装 spawn 为 Promise，便于链式调用
    const runGit = (args) => new Promise((resolve, reject) => {
      const child = spawn('git', args, { cwd: projectPath });
      let stdout = '', stderr = '';
      child.stdout.on('data', d => stdout += d.toString());
      child.stderr.on('data', d => stderr += d.toString());
      child.on('close', code => code === 0 ? resolve(stdout) : reject(stderr || stdout));
    });

    (async () => {
      try {
        await runGit(['add', '.']);
        await runGit(['commit', '-m', message]);
        if (autoPush) {
          try {
            await runGit(['pull', '--rebase']);
          } catch (pullErr) {
            // rebase 冲突时自动回滚，避免仓库卡在中间状态
            await runGit(['rebase', '--abort']).catch(() => {});
            return callback({ success: false, error: `拉取冲突，提交已保留在本地，请手动解决冲突后推送\n${pullErr}` });
          }
          await runGit(['push']);
        }
        console.log('✅ Git 操作成功');
        callback({ success: true });
      } catch (err) {
        if (err.includes('nothing to commit')) {
          callback({ success: true, output: '没有检测到文件变化' });
        } else {
          console.error('❌ Git 操作失败:', err);
          callback({ success: false, error: err });
        }
      }
    })();
  });

  socket.on('ai:secret-storage', (callback) => {
    callback({ available: isSecretStorageAvailable() });
  });
  // 界面把 home 目录显示成 ~
  socket.on('app:home-dir', (callback) => {
    callback(os.homedir());
  });

  socket.on('config:load', (key, callback) => {
    const allData = readConfigFile();
    let value = allData[key] || null; // 取出对应 key 的值
    if (key === WECHAT_DEVTOOLS_CONFIG_KEY) {
      value = normalizeWechatDevtoolsConfig(value);
    } else if (key === TERMINAL_CONFIG_KEY) {
      value = normalizeTerminalConfig(value);
    } else if (key === AI_CONFIG_LIST_KEY) {
      value = openAiConfigList(ensureAiSecretsMigrated(allData)[AI_CONFIG_LIST_KEY]);
    }
    console.log(`📖 读取配置 [${key}]`);
    callback(value); // ✅ 发回前端
  });

  // 💾 【监听】前端请求保存配置
  socket.on('config:save', ({ key, value }) => {
    const allData = readConfigFile();
    let normalizedValue = value;
    if (key === WECHAT_DEVTOOLS_CONFIG_KEY) {
      normalizedValue = normalizeWechatDevtoolsConfig(value);
    } else if (key === TERMINAL_CONFIG_KEY) {
      normalizedValue = normalizeTerminalConfig(value);
    } else if (key === AI_CONFIG_LIST_KEY) {
      normalizedValue = sealAiConfigList(value, allData[AI_CONFIG_LIST_KEY]);
    }
    allData[key] = normalizedValue; // 更新对应的 key
    writeConfigFile(allData); // 写入硬盘
    console.log(`💾 保存配置 [${key}] Success`);
  });

  const weeklyCallback = (callback, operation) => {
    Promise.resolve().then(operation).then(
      (data) => callback?.({ success: true, data }),
      (error) => callback?.({
        success: false,
        error: { code: error.code || 'WEEKLY_REPORT_ERROR', message: error.message || String(error) }
      })
    );
  };

  socket.on('weekly-report:repositories:list', (_payload, callback) =>
    weeklyCallback(callback, () => weeklyReportRuntime.registry.list()));
  socket.on('weekly-report:repositories:add', ({ projectPath } = {}, callback) =>
    weeklyCallback(callback, () => weeklyReportRuntime.registry.add(projectPath)));
  socket.on('weekly-report:repositories:import-root', ({ rootPath, maxDepth = 5 } = {}, callback) =>
    weeklyCallback(callback, () => weeklyReportRuntime.registry.importRoot(expandHome(rootPath), { maxDepth })));
  socket.on('weekly-report:repositories:set-enabled', ({ id, enabled } = {}, callback) =>
    weeklyCallback(callback, () => weeklyReportRuntime.registry.setEnabled(id, enabled)));
  socket.on('weekly-report:repositories:remove', ({ id } = {}, callback) =>
    weeklyCallback(callback, () => weeklyReportRuntime.registry.remove(id)));

  socket.on('weekly-report:identities:list', (_payload, callback) => weeklyCallback(callback, async () => {
    const selected = await weeklyReportRuntime.identities.list();
    const repositories = (await weeklyReportRuntime.registry.list()).filter((item) => item.enabled !== false);
    const candidates = await discoverAuthors(repositories, { months: 12 });
    return { selected, candidates };
  }));
  socket.on('weekly-report:identities:save', ({ identities } = {}, callback) =>
    weeklyCallback(callback, () => weeklyReportRuntime.identities.save(identities)));

  socket.on('weekly-report:activity:collect', ({ startDate, endDate } = {}, callback) => weeklyCallback(callback, async () => {
    const repositories = await weeklyReportRuntime.registry.list();
    const identities = await weeklyReportRuntime.identities.list();
    const result = await collectActivity({
      repositories,
      authorNames: identities.map((item) => item.name),
      startDate,
      endDate
    });
    const names = new Map(repositories.map((item) => [item.id, item.name]));
    result.commits = result.commits.map((commit) => ({ ...commit, repositoryName: names.get(commit.repositoryId) || commit.repositoryId }));
    return result;
  }));
  socket.on('weekly-report:generate-context', ({ activity, limits } = {}, callback) =>
    weeklyCallback(callback, () => buildReportContext(activity, limits)));
  socket.on('weekly-report:generate', ({ context, systemPrompt, configId } = {}, callback) => weeklyCallback(callback, async () => {
    const allConfig = readConfigFile();
    const configList = openAiConfigList(allConfig.ai_config_list || []);
    const sceneId = configId || allConfig.ai_scene_configs?.weeklyReport || allConfig.ai_active_id || '';
    const config = configList.find((item) => item.id === sceneId) || configList[0];
    return generateText({
      config,
      systemPrompt: systemPrompt || '根据提供的 Git 活动生成简洁、事实准确的中文周报 Markdown。',
      userContent: JSON.stringify(context || {})
    });
  }));
  socket.on('weekly-report:commit:details', ({ repositoryId, hash } = {}, callback) => weeklyCallback(callback, async () => {
    const repository = (await weeklyReportRuntime.registry.list()).find((item) => item.id === repositoryId && item.enabled !== false);
    if (!repository) throw Object.assign(new Error('Repository is not registered'), { code: 'REPOSITORY_NOT_ALLOWED' });
    const patchText = await runGit(repository.path, ['show', '--format=', '--stat', '--patch', String(hash || '')]);
    return { repositoryId, hash: String(hash || ''), patch: patchText.slice(0, 8000), truncated: patchText.length > 8000 };
  }));
  socket.on('weekly-report:history:list', (_payload, callback) =>
    weeklyCallback(callback, () => weeklyReportRuntime.reports.listReports()));
  socket.on('weekly-report:history:get', ({ id } = {}, callback) =>
    weeklyCallback(callback, () => weeklyReportRuntime.reports.getReport(id)));
  socket.on('weekly-report:history:save', ({ report } = {}, callback) =>
    weeklyCallback(callback, () => weeklyReportRuntime.reports.saveReport(report)));

  socket.on('notification:show', ({ title, body } = {}, callback = () => {}) => {
    try {
      const electron = require('electron');
      const Notification = electron?.Notification;
      const safeTitle = String(title || 'DevDock').trim() || 'DevDock';
      const safeBody = String(body || '').trim() || '倒计时结束';

      if (!Notification || typeof Notification.isSupported !== 'function' || !Notification.isSupported()) {
        callback({ success: false, error: '当前环境不支持系统通知' });
        return;
      }

      const notification = new Notification({
        title: safeTitle,
        body: safeBody,
        silent: false
      });

      notification.show();
      callback({ success: true });
    } catch (err) {
      console.error('系统通知发送失败:', err);
      callback({ success: false, error: '系统通知发送失败' });
    }
  });

  // --- Node 版本管理事件 ---
  socket.on('node:get-versions', (callback) => {
    const nvmHome = nodeVersions.getNvmHome();
    const details = nodeManager.listInstalled();
    const versions = details.map((item) => item.version);
    console.log(`📦 [Node] 已安装版本: ${versions.length > 0 ? versions.join(', ') : '未检测到 nvm'}`);
    callback({
      nvmDetected: !!nvmHome,
      nvmHome: nvmHome || '',
      managedDir: nodeManager.getManagedDir(),
      versions,
      details
    });
  });

  socket.on('node:available', async (callback) => {
    try {
      callback({ success: true, versions: await nodeManager.listAvailable() });
    } catch (error) {
      callback({ success: false, error: error.message });
    }
  });

  socket.on('node:install', async ({ version } = {}, callback) => {
    try {
      const result = await nodeManager.install(version, (progress) => {
        socket.emit('node:install:progress', { version, ...progress });
      });
      socket.emit('node:install:progress', { version, percent: 100, done: true });
      io.emit('node:versions:changed');
      callback({ success: true, ...result });
    } catch (error) {
      callback({ success: false, error: error.message, code: error.code || '' });
    }
  });

  socket.on('node:remove', ({ version } = {}, callback) => {
    try {
      const result = nodeManager.remove(version);
      io.emit('node:versions:changed');
      callback({ success: true, ...result });
    } catch (error) {
      callback({ success: false, error: error.message, code: error.code || '' });
    }
  });

  socket.on('node:detect-version', ({ projectPath }, callback) => {
    const detected = nodeVersions.detectProjectNodeVersion(projectPath);
    const resolved = detected ? nodeVersions.resolveNodeVersion(detected.raw) : null;
    callback({ detected, resolved });
  });

  socket.on('proxy:claude', async ({ message, systemPrompt, configId }, callback) => {
    // 从配置文件读取 AI 配置，支持场景级指定
    const allConfig = readConfigFile();
    const configList = openAiConfigList(allConfig['ai_config_list'] || []);
    const targetId = configId || allConfig['ai_active_id'] || '';
    const aiConfig = configList.find(c => c.id === targetId) || configList[0];

    if (!aiConfig || !aiConfig.baseURL || !aiConfig.apiKey) {
      return callback({ success: false, error: '请先在设置中配置 AI 模型的 Base URL 和 API Key' });
    }

    const provider = aiConfig.provider || 'openai';
    const base = aiConfig.baseURL.replace(/\/+$/, '');
    const model = aiConfig.model || 'gpt-3.5-turbo';
    console.log(`🕵️‍♀️ [proxy:claude] provider=${provider}, model=${model}`);

    let url, headers, body;

    if (provider === 'anthropic') {
      // Anthropic 原生协议 (/v1/messages)
      url = base + '/v1/messages';
      headers = {
        "Content-Type": "application/json",
        "x-api-key": aiConfig.apiKey,
        "anthropic-version": "2023-06-01"
      };
      body = { model, max_tokens: 4096, messages: [{ role: "user", content: message }] };
      if (systemPrompt) body.system = systemPrompt;
    } else if (provider === 'gemini') {
      // Google Gemini (/v1beta/models/xxx:generateContent)
      url = `${base}/v1beta/models/${model}:generateContent?key=${aiConfig.apiKey}`;
      headers = { "Content-Type": "application/json" };
      const parts = [{ text: message }];
      if (systemPrompt) parts.unshift({ text: systemPrompt });
      body = { contents: [{ parts }] };
    } else {
      // OpenAI 兼容协议 (openai / deepseek / codex 等)
      url = base + '/v1/chat/completions';
      headers = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${aiConfig.apiKey}`
      };
      body = { model, messages: [{ role: "user", content: message }], stream: false };
      if (systemPrompt) body.messages.unshift({ role: "system", content: systemPrompt });
    }

    try {
      const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      const rawText = await response.text();
      console.log(`[Status] ${response.status}`);

      let data;
      try { data = JSON.parse(rawText); } catch {
        console.error("❌ 返回非 JSON:", rawText.substring(0, 200));
        return callback({ success: false, error: "API 返回非 JSON 数据" });
      }

      if (data.error) {
        console.error("❌ API 错误:", data.error);
        return callback({ success: false, error: data.error.message || JSON.stringify(data.error) });
      }

      // 按 provider 提取内容
      let content;
      if (provider === 'anthropic') {
        content = data.content?.[0]?.text;
      } else if (provider === 'gemini') {
        content = data.candidates?.[0]?.content?.parts?.[0]?.text;
      } else {
        content = data.choices?.[0]?.message?.content;
      }

      if (content) {
        console.log("✅ 成功拿到内容！");
        callback({ success: true, data: content });
      } else {
        console.error("❌ 结构异常:", JSON.stringify(data).substring(0, 300));
        callback({ success: false, error: "返回数据结构异常" });
      }
    } catch (e) {
      console.error("❌ 网络请求失败:", e);
      callback({ success: false, error: e.message });
    }
  });

  // 在项目目录下执行单条命令（供 AI 修复功能使用）
  socket.on('exec:run', ({ command, cwd }, callback) => {
    if (!command || !cwd) {
      return callback({ success: false, error: '缺少 command 或 cwd 参数' });
    }
    console.log(`🔧 [exec:run] 在 ${cwd} 执行: ${command}`);
    exec(command, { cwd, shell: true, timeout: 60000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      callback({
        success: !error,
        stdout: stdout?.toString() || '',
        stderr: stderr?.toString() || '',
        error: error?.message || ''
      });
    });
  });

  // 读取文件内容（供 AI 修复读取源文件）
  socket.on('file:read', ({ filePath }, callback) => {
    try {
      if (!fs.existsSync(filePath)) {
        return callback({ success: false, error: `文件不存在: ${filePath}` });
      }
      const content = fs.readFileSync(filePath, 'utf-8');
      callback({ success: true, content });
    } catch (e) {
      callback({ success: false, error: e.message });
    }
  });

  // 写入文件（供 AI 修复应用代码变更）
  socket.on('file:write', ({ filePath, content }, callback) => {
    try {
      fs.writeFileSync(filePath, content, 'utf-8');
      console.log(`📝 [file:write] 已写入: ${filePath}`);
      callback({ success: true });
    } catch (e) {
      callback({ success: false, error: e.message });
    }
  });

  // ---------- Nginx 路由管理 ----------
  const nginxReply = (callback, payload) => {
    if (typeof callback === 'function') callback(payload);
  };
  const nginxGuard = (callback, fn) => {
    try {
      nginxReply(callback, { success: true, data: fn() });
    } catch (e) {
      nginxReply(callback, { success: false, error: e.message });
    }
  };
  const nginxGuardAsync = async (callback, fn) => {
    try {
      nginxReply(callback, { success: true, data: await fn() });
    } catch (e) {
      nginxReply(callback, { success: false, error: e.message });
    }
  };

  // 写盘 + 校验 + 重载；失败时广播给前端提示，避免改动「看起来生效了其实没有」
  const applyConfig = async (options = {}) => {
    const applied = await nginxRuntime.apply({ force: options.force || [] });
    if (applied.error) {
      console.warn('⚠️ nginx 配置已写入但未生效:', applied.error);
      io.emit('nginx:apply-error', { error: applied.error });
    }
    return applied;
  };

  const nginxSync = async (options = {}) => {
    const applied = await applyConfig({ force: options.force || [] });
    return {
      applied,
      tested: applied.tested,
      reloaded: applied.reloaded,
      reason: applied.running ? undefined : 'not-running',
      error: applied.error,
    };
  };

  socket.on('nginx:overview', (callback) => nginxGuard(callback, () => nginxRuntime.overview()));

  socket.on('nginx:export', (callback) => nginxGuard(callback, () => nginxRuntime.exportPayload()));

  socket.on('nginx:import-json', ({ payload }, callback) => nginxGuardAsync(callback, async () => {
    const result = nginxRuntime.importPayload(payload);
    if (!result.ok) throw new Error(result.error);
    await applyConfig();
    return result;
  }));

  socket.on('nginx:route:save', ({ route }, callback) => nginxGuardAsync(callback, async () => {
    const saved = nginxRuntime.upsertRoute(route);
    await applyConfig();
    return saved;
  }));

  socket.on('nginx:routes:reorder', ({ ids } = {}, callback) => nginxGuardAsync(callback, async () => {
    const routes = nginxRuntime.reorderRoutes(ids);
    await applyConfig();
    return routes;
  }));
  socket.on('nginx:route:remove', ({ id }, callback) => nginxGuardAsync(callback, async () => {
    const removed = nginxRuntime.removeRoute(id);
    await applyConfig();
    return { removed };
  }));


  socket.on('nginx:target:add', ({ routeId, target }, callback) => nginxGuardAsync(callback, async () => {
    const route = nginxRuntime.addTarget(routeId, target);
    await applyConfig();
    return route;
  }));

  socket.on('nginx:target:remove', ({ routeId, targetId }, callback) => nginxGuardAsync(callback, async () => {
    const route = nginxRuntime.removeTarget(routeId, targetId);
    await applyConfig();
    return route;
  }));

  socket.on('nginx:target:active', ({ routeId, targetId }, callback) => nginxGuardAsync(callback, async () => {
    const route = nginxRuntime.setActiveTarget(routeId, targetId);
    await applyConfig();
    return route;
  }));

  socket.on('nginx:conflict:resolve', ({ id, action }, callback) => nginxGuardAsync(callback, async () => {
    const result = nginxRuntime.resolveConflict(id, action);
    await applyConfig();
    return result;
  }));

  socket.on('nginx:settings:save', ({ nginx }, callback) => nginxGuardAsync(callback, async () => {
    const state = nginxRuntime.store.load();
    const incoming = { ...(nginx || {}) };
    if (incoming.routesDir) incoming.routesDir = expandHome(incoming.routesDir);
    if (incoming.logDir) incoming.logDir = expandHome(incoming.logDir);
    state.nginx = { ...state.nginx, ...incoming };
    nginxRuntime.store.save(state);
    await applyConfig();
    return state.nginx;
  }));

  socket.on('nginx:sync', (options, callback) => nginxGuardAsync(callback, () => nginxSync(options || {})));
  socket.on('nginx:validate', (callback) => nginxGuardAsync(callback, () => nginxRuntime.validate()));
  socket.on('nginx:reload', (callback) => nginxGuardAsync(callback, () => nginxRuntime.reload()));
  socket.on('nginx:start', (callback) => nginxGuardAsync(callback, () => nginxRuntime.start()));
  socket.on('nginx:stop', (callback) => nginxGuardAsync(callback, () => nginxRuntime.stop()));
  socket.on('nginx:restart', (callback) => nginxGuardAsync(callback, () => nginxRuntime.restart()));

  socket.on('nginx:open-path', ({ which }, callback) => nginxGuard(callback, () => {
    const target = nginxRuntime.controller.paths();
    const map = {
      prefix: target.prefixDir,
      routes: target.routesDir,
      logs: target.logDir,
      conf: target.confPath,
    };
    const openTarget = map[which] || target.prefixDir;
    if (which === 'conf') {
      const editor = nginxRuntime.store.load().nginx.editor;
      const editorCommands = { vscode: 'code', cursor: 'cursor', sublime: 'subl' };
      const command = editorCommands[editor];
      if (command) {
        execFile(command, ['-g', openTarget], () => {});
        return { opened: openTarget, via: command };
      }
    }
    if (process.platform === 'win32') {
      exec(`explorer "${openTarget}"`);
    } else if (process.platform === 'darwin') {
      execFile('open', [openTarget], () => {});
    } else {
      execFile('xdg-open', [openTarget], () => {});
    }
    return { opened: openTarget, via: 'system' };
  }));
});

// --- ✨ 核心修复：监听主进程退出事件 ---
let isCleaningUp = false;
let cleanupPromise = null;
const cleanup = ({ exitProcess = false } = {}) => {
  if (isCleaningUp) return cleanupPromise || Promise.resolve();
  isCleaningUp = true;

  cleanupPromise = new Promise((resolve) => {
    for (const [key, child] of processes) {
      killProcessTree(child, key);
    }

    // nginx 以 daemon 方式运行（父进程是 launchd），不显式停止会留在后台继续监听端口
    const stopNginx = Promise.resolve(nginxRuntime.stop()).catch((error) => {
      console.error('⚠️ 退出前停止 nginx 失败:', error && error.message ? error.message : error);
    });

    Promise.all([stopNginx, new Promise((done) => setTimeout(done, 600))]).then(() => {
      if (exitProcess) {
        process.exit(0);
      }
      resolve();
    });
  });

  return cleanupPromise;
};

process.on('SIGINT', () => cleanup({ exitProcess: true }));
process.on('SIGTERM', () => cleanup({ exitProcess: true }));

// 防止未捕获异常导致 server 崩溃重启（--watch 模式下崩溃会丢失所有进程追踪）
process.on('uncaughtException', (err) => {
  console.error('⚠️ [uncaughtException] 捕获未处理异常（已阻止崩溃）:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ [unhandledRejection] 捕获未处理 Promise 拒绝:', reason);
});
// 👇 2. 在文件最底部，server.listen 之前，添加“兜底路由”
// 作用：无论用户访问什么 URL，如果不是 API，都返回 index.html (支持 Vue Router history 模式)
app.get(/.*/, (req, res) => {
    const indexPath = path.join(clientDistPath, 'index.html');
    
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send('Backend is running, but index.html not found.');
    }
});
if (require.main === module) {
    server.listen(2117, () => console.log('Server running on 2117'));
}

server.cleanupManagedProcesses = () => cleanup({ exitProcess: false });

module.exports = server;
