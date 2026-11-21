# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 项目概述

terminalManage 是一个基于 Electron 33 + Vue 3 + Express 5 的跨平台桌面开发管理工具。用于可视化管理本地项目、执行脚本、监控进程资源、集成 AI 辅助功能。

## 常用命令

```bash
# 开发模式（同时启动 server:2117 + client:2118）
npm run dev

# 仅启动后端（固定监听 2117，无自动重载）
npm run server

# 仅启动前端
npm run client

# 前端构建
cd client && npm run build

# Electron 桌面应用启动
npm start

# 打包桌面安装程序（Windows NSIS / macOS DMG）
npm run dist
```

**注意：** 项目无 ESLint 配置。单元测试为 `node:test` 脚本（`server/utils/*.test.js`），需直接 `node --test <file>` 执行，根 `package.json` 未提供 `test` 脚本。

## 架构

### 整体结构：Electron 三层架构

```
main.js (Electron 主进程)
  ├── server/index.js (Express 后端，Electron 内嵌时端口自动分配)
  └── client/dist/ (Vue 3 前端，生产环境由 Express 静态托管)
```

- **Electron 主进程** (`main.js`)：创建 BrowserWindow，启动内嵌 Express 服务器，端口使用 `0` 自动分配可用端口。
- **开发模式**下前端独立运行在 2118 端口，通过 Socket.io 连接后端 2117 端口（`client/src/utils/socket.ts` 中硬编码，改端口需同步改 `server/index.js` 的 `listen`）。

### 前后端通信

所有前后端交互通过 **Socket.io** 实现，不使用 REST API。

关键 Socket 事件：
- `scan-dir` / `open-folder-dialog` — 项目扫描与目录选择
- `start-task` / `stop-task` — 脚本执行与进程管理
- `git:get-diff` / `git:commit` — Git 操作
- `config:load` / `config:save` — 持久化配置（存储于 `~/.terminalManage-config.json`）
- `proxy:claude` — AI 代理请求
- `monitor:update` — 进程资源监控广播（每 2 秒）

### 后端核心 (`server/index.js`)

单文件服务器，职责：
1. **项目扫描**：递归扫描目录查找 `package.json`（深度限制 4 层），自动检测包管理器（npm/pnpm/yarn）
2. **进程管理**：通过 `child_process.spawn` 启动子进程（`server/package.json` 里的 `node-pty-prebuilt-multiarch` 未被任何代码引用），用 `pidusage` + `pidtree` 监控资源
3. **Git 操作**：执行 `git diff`、`git status`、`git commit`
4. **AI 集成**：代理转发请求至 OpenAI 兼容 API
5. **静态文件服务**：生产环境托管 `client/dist/`

跨平台进程终止：Windows 用 `taskkill /pid <pid> /f /t`，Unix 用 `process.kill(-pid, 'SIGKILL')` 杀整个进程组。

### 前端核心 (`client/src/`)

- **框架**：Vue 3 + Vue Router 4（Hash 模式，兼容 Electron）
- **构建**：Vite（rolldown-vite）
- **样式**：Tailwind CSS 4 + 深色主题
- **终端**：xterm.js 渲染进程输出
- **Socket 连接**：`utils/socket.ts` 中根据 `import.meta.env.DEV` 判断连接地址
- **AI 工具**：`utils/ai.ts` 提供 `callKuyepClaude()` 调用 AI API

### 监控模块 (`server/utils/monitor.js`)

独立模块，聚合父子进程的 CPU/内存使用率，通过 Socket.io 广播给前端。

## UI 约定

- **不写说明性文案**：设置项、视图标题下不加副标题/描述段（如「选择配色方案，切换后立即生效…」）。控件自身的标签与 `placeholder` 不在此列。
- **不擅自增加兜底**：默认值、空态替代文案、回退显示等一律先询问，由人决定是否需要兜底。

## 技术栈要点

- **包管理器**：项目使用 pnpm（有 `pnpm-lock.yaml`），但 npm 也可用
- **NPM 镜像**：`.npmrc` 配置了 npmmirror.com 中国镜像
- **Node 版本**：要求 >= 20，推荐 v22 LTS
- **TypeScript**：仅前端使用，后端为纯 JavaScript
- **Electron 安全设置**：`contextIsolation: true`，`nodeIntegration: false`

## CI/CD

GitHub Actions（`.github/workflows/build.yml`）：
- 触发：仅推送 `v*` tag 或手动 `workflow_dispatch`（push 到 main 不会触发）
- 矩阵构建：Windows + macOS
- 产出：上传至 GitHub Releases
