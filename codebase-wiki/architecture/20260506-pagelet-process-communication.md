---
id: A-007
title: Pagelet Process 通信架构与 Daemon 直连
description: 详解 pagelet process 如何通过 MessagePort 与 daemon/shared/electron-main 建立直连通道；Monitor 窗口改造为 Panel/Pagelet 机制的设计决策与实现；进程生命周期管理与新增 pagelet 功能的开发指南。
category: architecture
created: 2026-05-06
updated: 2026-05-06
tags: [pagelet, daemon, MessagePort, IPC, resume, monitor, Panel, BrowserView, lifecycle]
status: active
references:
  - id: A-002
    rel: extends
    note: 本文在多进程拓扑基础上深入 pagelet 层的端口管理与通信细节
  - id: A-003
    rel: related
    note: Monitor 数据推送依赖本文描述的 pagelet → daemon 连接
  - id: A-001
    rel: related
    note: DI 容器与跨进程 RPC 代理是 pagelet 通信的底层基础
---

# Pagelet Process 通信架构与 Daemon 直连

## 1. 概览

Telegraph 的核心设计原则：**每个 UI 功能面板（Monitor、Chat、Design 等）的 renderer 与 pagelet process 一一对应**，实现稳定性隔离。shared-process 和 daemon-process 是全局唯一的服务进程。

```
┌─────────────────────────────────────────────────────────┐
│                    electron-main                         │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ WindowManager │  │ AcquirePort  │  │ AcquireProcess│  │
│  │              │  │    Main      │  │   PortMain    │  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
└────────┬───────────────────┬──────────────────┬──────────┘
         │                   │                  │
    ┌────┴────┐         ┌────┴────┐        ┌────┴────┐
    │ renderer │         │ shared  │        │ daemon  │
    │(BrowserView)       │ process │        │ process │
    │ per pagelet│        │(全局唯一)│       │(全局唯一)│
    └────┬────┘         └─────────┘        └─────────┘
         │
    ┌────┴────┐
    │ pagelet │
    │ process │
    │(per panel)│
    └─────────┘
```

### 进程连接拓扑

```
renderer (PageletClientChannel)
    ├── acquirePort()        → shared-process
    ├── acquireDaemonPort()  → daemon-process
    └── IPC (webContents)    → electron-main

pagelet-process (ProcessClientChannel)
    ├── acquireSharedPort()  → shared-process
    └── acquireDaemonPort()  → daemon-process

electron-main
    ├── AcquirePortMain         → 为 renderer 中介 MessagePort
    └── AcquireProcessPortMain  → 为 UtilityProcess 中介 MessagePort
```

## 2. Panel/Pagelet/PageletProcess 三层架构

这是理解整个框架的核心。每个功能面板由三层组成：

```
BrowserWindow（宿主窗口）
  └── Panel（面板容器，管理布局和生命周期）
       └── Pagelet（BrowserView + PageletProcess 的组合）
            ├── BrowserView  → 独立 renderer 进程，渲染 UI
            └── PageletProcess → 独立 UtilityProcess (Node.js)，执行后台逻辑
```

### 2.1 创建流程

```
WindowManager.createPanel({ projectName, fullscreen? })
  → BrowserWindow.createPanel({ projectName, fullscreen? })
    → panelFactory({ projectName, workbench, browserWindow, fullscreen })
      → Panel 构造函数
        → 根据 fullscreen 决定 _panelPos（left=76 或 left=0）
        → 计算 dimension
    → panel.addPagelet({ projectName })
      → workbench.getPageletConfig(projectName)   // 获取 BrowserViewConfig
      → pageletFactory({ workbench, browserWindow, dimension, projectName, browserViewConfig, panel })
        → Pagelet 构造函数
          → createBrowserView()                   // 创建 BrowserView，loadURL
          → startupPageletProcess()               // 创建/复用 PageletProcess
            → pageletProcessFactory(projectName)  // 创建 PageletProcess
            → pageletProcess.createUtilityProcess({ id, amdEntry? })
            → browserWindow.setCachedPageletProcess(projectName, pageletProcess)
```

### 2.2 BrowserViewConfig

每个 pagelet 对应一个 `BrowserViewConfig`，定义其 renderer 和 process 的入口：

```typescript
// tabs/common/types/pagelet.ts
type BrowserViewConfig = {
  projectName: string               // 面板标识，如 'monitor'、'chat'
  loadURL: string                   // renderer 加载路径，如 '/monitor'
  webPreferences: {
    preload: string                 // preload 脚本路径
  }
  amdEntry?: string                 // pagelet process 入口（可选）
  openDevTools?: boolean            // dev 模式下是否自动开 DevTools（默认 true）
}
```

配置注册在 `Workbench.getPageletConfigs()` 中：
- 内置配置（如 monitor）直接在 `Workbench` 中定义
- 项目配置通过 `ProjectRegistry.getLoadConfigs()` 扩展

```typescript
// workbench/electron-main/Workbench.ts:97-108
getPageletConfigs(): BrowserViewConfig[] {
  const builtinConfigs: BrowserViewConfig[] = [
    {
      projectName: 'monitor',
      loadURL: '/monitor',
      openDevTools: false,
      webPreferences: {
        preload: this.fileAccess.asFileUri('@build/preload.js').fsPath,
      },
    },
  ]
  return [...builtinConfigs, ...this.projects.getLoadConfigs()]
}
```

### 2.3 fullscreen 模式

`Panel` 默认 `_panelPos.left = 76`，为主窗口左侧 Sidebar 预留空间。独立窗口（如 Monitor）不需要 Sidebar，通过 `fullscreen: true` 将 `left` 设为 0，BrowserView 占满整个窗口：

```typescript
// Panel.ts 构造函数
if (props.fullscreen) {
  this._panelPos = { left: 0, top: 0 }
}
```

### 2.4 Renderer 端路由

所有 pagelet 的 BrowserView 加载同一个 renderer 入口（`index.html`），通过 URL 中的 `TELEGRAPH_PAGELET_RENDERER_PROCESS_ID` 参数区分身份：

```typescript
// index.tsx
const RENDERER_PROCESS_ID = getRendererProcessId()

function Root() {
  const appId = RENDERER_PROCESS_ID

  // Pagelet BrowserView 的 ID 包含 'pagelet.' 模式
  // （如 window.2_panel.monitor_pagelet.monitor）
  const isPageletView = appId && appId.includes('pagelet.')

  if (isPageletView) {
    // 独立面板：只渲染 PageContent，无 Sidebar
    return <PageContent />
  }

  // 主窗口 / 登录页 / 辅助窗口：带 Sidebar
  return <Sidebar /> + <PageContent />
}
```

`PageContent` 根据 URL hash 路由渲染对应组件：
- `#/monitor` → `<MonitorPanel />`
- `#/chat` → `<ChatPanel />`
- `#/design` → `<DesignPanel />`

**ID 格式**：`buildId(entry, id)` 生成 `entry.id`，所以 pagelet ID 形如 `window.2_panel.monitor_pagelet.monitor`。

`getRendererProcessId()` 同时从 `window.location.search` 和 hash 中的 query 提取参数，兼容 production（search）和 dev（hash routing）两种模式。

## 3. Monitor 窗口改造（案例研究）

### 3.1 改造前的问题

改造前 Monitor 窗口通过 `WindowManager.createMonitorWindow()` 直接创建 BrowserWindow 并 `loadURL`，绕过了 Panel/Pagelet 机制：

```
改造前：
toggleMonitor
  → WindowManager.createMonitorWindow()
    → browserWindowFactory()           // 直接创建 BrowserWindow
    → window.loadURL('/monitor?...=monitor-window-app')  // 直接加载
    → 无 PageletProcess                // 进程列表中看不到 pagelet process
```

问题：
1. Monitor 窗口没有对应的 pagelet process，违反"renderer 与 pagelet process 一一对应"的设计原则
2. 没有稳定性隔离——Monitor 的 renderer 崩溃会影响 BrowserWindow 本身

### 3.2 改造后的架构

```
改造后：
toggleMonitor
  → WindowManager.createMonitorWindow()
    → browserWindowFactory()           // 创建 BrowserWindow（宿主，不加载 URL）
    → monitorWindow.createPanel({ projectName: 'monitor', fullscreen: true })
      → Panel → Pagelet
        → BrowserView.loadURL('/monitor')  // UI 在 BrowserView 中渲染
        → PageletProcess                   // 独立 UtilityProcess
    → window.show()                    // 手动显示（见 §3.3）
```

### 3.3 开发过程中的踩坑记录

#### 坑 1：主窗口 Sidebar 消失

**现象**：打开主应用后 Sidebar（Home/Design/Chat/Monitor 导航）消失。

**根因**：`Root` 组件用白名单 `isMainApp = appId === 'main-renderer-app' || appId === 'auxiliary-app'` 判断是否显示 Sidebar。但登录页的 `appId` 是 `main-renderer-login`，不在白名单中，走了 pagelet 分支（无 Sidebar）。

**修复**：反转判断逻辑——只有 ID 包含 `pagelet.` 模式的才是 pagelet BrowserView，其余所有情况都显示 Sidebar。这样无论未来新增什么 appId（登录、设置等），都不需要修改白名单。

#### 坑 2：Monitor 窗口不显示

**现象**：点击 Toggle Monitor 后没有任何窗口出现。

**根因**：改造后 BrowserWindow 自身不加载任何 URL（内容在 BrowserView 中），而 `BaseWindow.registerListeners()` 中的 `ready-to-show` 事件依赖窗口内容加载完成后触发 `window.show()`。空白窗口的 `ready-to-show` 可能不会可靠触发。

**修复**：在 `createPanel` 之后手动调用 `window.show()`：
```typescript
monitorWindow.createPanel({ projectName: 'monitor', fullscreen: true })
if (!monitorWindow.window.isVisible()) {
  monitorWindow.window.show()
}
```

#### 坑 3：DevTools 自动打开

**现象**：Monitor 窗口打开时自动弹出 DevTools。

**根因**：`Pagelet.createBrowserView()` 中有 `if (MAIN_WINDOW_VITE_DEV_SERVER_URL) this._view.webContents.openDevTools()`，dev 模式下对所有 BrowserView 自动开启 DevTools。之前 Monitor 不走 Pagelet，所以没触发。

**修复**：`BrowserViewConfig` 新增 `openDevTools?: boolean` 字段，Pagelet 中判断 `openDevTools !== false` 才开启。Monitor 配置设为 `false`。

#### 坑 4：pagelet process 泄漏（关闭后残留）

**现象**：关闭 Monitor 窗口后重新打开，进程列表中出现两个 `monitor-pagelet-process`。

**根因**：窗口关闭时 `BrowserWindow.dispose()` 没有清理 `panelsStack` 中的 Panel/Pagelet，导致 PageletProcess（UtilityProcess）未被 kill。再次 toggle 时创建新 BrowserWindow（新的 `cachedPageletProcessMap`），无法复用旧进程。

**修复（两层）**：

1. `BrowserWindow` 构造函数注册 `onWindowDidCloseHandler`，关闭时级联 dispose 所有 panel 和 cached pagelet process：
```typescript
// BrowserWindow.ts 构造函数
this.onWindowDidCloseHandler(() => {
  this.disposeAllPanels()
})

private disposeAllPanels() {
  const panels = this.panelsStack.splice(0)
  for (const stack of panels) {
    stack.panel.disposePanel()  // 级联 dispose pagelet → removeBrowserView + destroy webContents
  }
  for (const [_, pageletProcess] of this.cachedPageletProcessMap) {
    pageletProcess.dispose()   // kill UtilityProcess
  }
  this.cachedPageletProcessMap.clear()
}
```

2. `PageletProcess` 构造函数注册 dispose 回调，确保 UtilityProcess 被 kill：
```typescript
// PageletProcess.ts 构造函数
this.registerDisposable({
  dispose: () => {
    this.utilityProcess?.process?.kill()
  },
})
```

#### 坑 5：Monitor 数据推送目标变更

**现象**：改造后 Monitor 面板收不到数据。

**根因**：`MonitorBridge.pushSnapshot()` 通过 `monitor.window.webContents.send()` 推送到 BrowserWindow 的 webContents。改造后 UI 在 BrowserView 中渲染，BrowserView 有自己独立的 webContents。

**修复**：改为向 BrowserView 的 webContents 推送：
```typescript
// MonitorBridge.ts
const browserViews = monitor.window.getBrowserViews()
if (browserViews.length > 0) {
  for (const view of browserViews) {
    view.webContents?.send(MONITOR_SNAPSHOT_CHANNEL, snapshot)
  }
} else {
  monitor.window.webContents?.send(MONITOR_SNAPSHOT_CHANNEL, snapshot)
}
```

## 4. 端口获取机制

### 4.1 Renderer 端 — PageletClientChannel

位置：`services/port-manager/browser/PageletClientChannel.ts`

renderer 进程通过 preload bridge 向 electron-main 请求 MessagePort：

```typescript
// 获取 shared-process 端口
await this.portManager.acquirePort();
// 获取 daemon-process 端口（第133行）
await this.portManager.acquireDaemonPort();
```

底层调用 `window.telegraph.ipcRenderer.invoke('acquirePort', ...)`，electron-main 收到后创建 `MessageChannelPair`，将一端通过 `webContents.postMessage` 传回 renderer，另一端通过 `UtilityProcess.postMessage` 传给目标进程。

### 4.2 Node 端 — ProcessClientChannel

位置：`services/port-manager/node/ProcessClientChannel.ts`

pagelet process（UtilityProcess）通过 `parentPort` 与 electron-main 通信：

```typescript
// 获取 shared-process 端口
await this.portManager.acquireSharedPort();
// 获取 daemon-process 端口（第150行）
await this.portManager.acquireDaemonPort();
```

### 4.3 Electron-Main 端口中介

| 中介类 | 文件 | 服务对象 |
|--------|------|----------|
| `AcquirePortMain` | `services/port-manager/electron-main/AcquirePortMain.ts` | renderer（BrowserWindow） |
| `AcquireProcessPortMain` | `services/port-manager/electron-main/AcquireProcessPortMain.ts` | UtilityProcess（pagelet/shared/daemon） |

中介流程：
1. 收到端口请求 → 解析 `connectId`（包含源进程 ID 和目标进程类型）
2. 创建 `MessageChannelPair`（`services/port-manager/common/MessageChannelPair.ts`）
3. 将 port1 传给请求方，port2 传给目标进程
4. 在 `PortManager` 中记录连接对，用于后续 resume

### 4.4 connectId 格式

位置：`services/port-manager/common/connectId.ts`

`connectId` 编码了连接的源和目标信息，格式为 `{sourceProcessId}:{targetType}`，用于 electron-main 路由端口请求到正确的目标进程。

## 5. Pagelet → Daemon 直连

### 5.1 变更动机

之前 pagelet process 只连接 shared-process，需要 daemon 服务时要经过 shared 中转。新增直连后，pagelet 可直接调用 daemon 上的 RPC 服务（如 `MonitorBridgeClient`），减少一跳延迟。

### 5.2 关键变更

**PageletProcessNode.ts**（`services/process/pagelet-process/node/PageletProcessNode.ts:51`）：

```typescript
// 启动时自动连接 daemon
this.portManager.acquireDaemonPort();
```

**PageletProcessModule.ts**（`services/process/pagelet-process/node/PageletProcessModule.ts:55`）：

```typescript
// 将 MonitorBridgeClient 绑定到 daemonProcessChannelProtocol
// 通过 ProxyRPCClient 创建代理，调用会自动路由到 daemon 进程
bind(MonitorBridgeClient).toDynamicValue(({ container }) => {
  const channelClient = container.get(ProcessClientChannelId)
  return new ProxyRPCClient(monitorServicePath, {
    channel: channelClient.daemonProcessChannelProtocol,
  }).createProxy() as unknown as IMonitorBridge
})
```

**PageletProcess.ts**（electron-main 端）：

```typescript
// 新增 handleProcessDisposed() — 清理崩溃进程的端口资源
// 新增 handleResumeConnection() — 重建 pagelet → daemon 连接
// 私有 _createUtilityProcess() — 提取进程创建逻辑，复用于 resume
// dispose 时 kill UtilityProcess — 防止进程泄漏
```

## 6. Resume（断线重连）机制

当 daemon 进程崩溃并重启时，所有已建立的 MessagePort 连接失效，需要 resume：

```
daemon 崩溃
  → DaemonProcessMain.handleResumeConnection()
    → portManager.resumeConnection()
      → 遍历所有 consumer（renderer + pagelet）
        → 每个 consumer 调 toReconnect()
          → renderer: PageletClientChannel 重新 acquireDaemonPort()
          → pagelet: ProcessClientChannel 重新 acquireDaemonPort()
```

pagelet 进程自身崩溃时的恢复：

```
pagelet 崩溃
  → PageletProcess.handleProcessDisposed()
    → portManager.handleProcessDisposed()  // 清理旧端口记录
    → _createUtilityProcess()              // 重新创建进程
    → portManager.updateAcquirePortListener(newProcess)
    → portManager.resumeConnection()       // 重建所有连接
    → 新进程启动后自动执行 acquireSharedPort() + acquireDaemonPort()
```

## 7. Monitor 数据流（端到端）

Monitor 面板展示系统性能数据，其数据流跨越多个进程：

```
daemon-process                    electron-main              renderer (BrowserView)
┌─────────────┐                  ┌──────────────┐           ┌──────────────┐
│ Diagnostics  │  RPC pushSnapshot │ MonitorBridge │  IPC send  │ MonitorPanel │
│ (每5秒 tick) │ ──────────────→ │              │ ────────→ │ (hooks.ts)   │
└─────────────┘                  └──────────────┘           └──────────────┘
```

1. **数据源**：`Diagnostics`（`services/diagnostics/node/Diagnostics.ts`）在 daemon-process 中每 5 秒收集一次快照（CPU、内存、进程树等，调用 `app.getAppMetrics()`）
2. **RPC 推送**：通过 `MonitorBridgeClient.pushSnapshot()` 调用 electron-main 的 `MonitorBridge`
3. **IPC 分发**：`MonitorBridge`（`services/monitor/electron-main/MonitorBridge.ts`）遍历 Monitor 窗口的所有 `BrowserView`，向其 `webContents.send()` 推送快照
4. **UI 渲染**：renderer 中 `hooks.ts` 通过 `window.telegraph.ipcRenderer.on(MONITOR_SNAPSHOT_CHANNEL, ...)` 监听，更新 React state，驱动 `MonitorPanel` / `ProcessesTable` / `Sparkline` 等组件

## 8. 生命周期管理

### 8.1 创建阶段

```
WindowManager.createMonitorWindow()
  → browserWindowFactory({ isPrimary: false, fullscreen 参数... })
  → onDidWindowCreated 回调:
    → monitorWindow.createPanel({ projectName: 'monitor', fullscreen: true })
    → window.show()  // 手动显示，因为空 BrowserWindow 的 ready-to-show 不可靠
  → 注册 onWindowDidCloseHandler:
    → windowMap.delete() + monitorWindow = null
```

### 8.2 销毁阶段

```
用户关闭 Monitor 窗口（或再次 Toggle）
  → BrowserWindow 'closed' 事件
    → BaseWindow.dispose()
      → 触发 onWindowDidCloseHandler
        → WindowManager: windowMap 清理，monitorWindow 置 null
      → BrowserWindow.disposeAllPanels()
        → Panel.disposePanel()
          → Pagelet.disposePagelet()
            → mainProcess.handlePageletRendererDisposed(id)
            → window.removeBrowserView(view)
            → view.webContents.destroy()
            → panel.removePagelet(this)
        → PageletProcess.dispose()
          → utilityProcess.process.kill()  // kill Node.js UtilityProcess
        → cachedPageletProcessMap.clear()
```

### 8.3 PageletProcess 缓存策略

`BrowserWindow.cachedPageletProcessMap` 按 `projectName` 缓存 PageletProcess。同一窗口内多次 `addPagelet` 同名 project 会复用已有进程：

```typescript
// Pagelet.startupPageletProcess()
const reserved = this._browserWindow.getCachedPageletProcess(this.projectName)
if (reserved) {
  this.pageletProcess = reserved  // 复用
  return
}
// 否则新建并缓存
```

注意：缓存绑定到 BrowserWindow 实例。Monitor 每次 toggle 创建新 BrowserWindow，不会复用上次的 PageletProcess。

## 9. 新增 Pagelet 功能开发指南

### 9.1 注册 BrowserViewConfig

在 `Workbench.getPageletConfigs()` 的 `builtinConfigs` 数组中添加：

```typescript
{
  projectName: 'your-feature',
  loadURL: '/your-feature',       // 对应 index.tsx 中的 hash 路由
  openDevTools: false,            // 可选，默认 true
  webPreferences: {
    preload: this.fileAccess.asFileUri('@build/preload.js').fsPath,
  },
  amdEntry: 'path/to/entry.js',  // 可选，pagelet process 的业务入口
}
```

### 9.2 添加 Renderer 路由

在 `index.tsx` 的 `PageContent` 中添加 hash 路由：

```typescript
function PageContent() {
  const hash = useHashRoute()
  if (hash.includes('/your-feature')) return <YourFeaturePanel />
  // ...
}
```

### 9.3 创建独立窗口（可选）

参考 `createMonitorWindow`，在 `WindowManager` 中添加：

```typescript
createYourFeatureWindow() {
  const win = this.browserWindowFactory({ isPrimary: false, workbench: this.workbench, ... })
  this.registerDisposable(
    win.onDidWindowCreated(() => {
      win.createPanel({ projectName: 'your-feature', fullscreen: true })
      if (!win.window.isVisible()) win.window.show()
    })
  )
  this.registerDisposable(
    win.onWindowDidCloseHandler(() => { /* 清理 windowMap */ })
  )
  win.createWindow()
}
```

### 9.4 扩展 pagelet process 能力（可选）

如果 pagelet process 需要自定义后台逻辑：

1. 在 `BrowserViewConfig` 中设置 `amdEntry` 指向业务入口
2. 在 `PageletProcessModule.ts` 中绑定需要的 RPC 客户端
3. 在 `PageletProcessNode.ts` 中注册服务

### 9.5 核心检查清单

| 检查项 | 说明 |
|--------|------|
| BrowserViewConfig 已注册 | `Workbench.getPageletConfigs()` 返回配置 |
| Renderer 路由已添加 | `PageContent` 中的 hash 匹配 |
| 窗口关闭时资源释放 | `disposeAllPanels` 会级联清理（已内置） |
| DevTools 行为符合预期 | 通过 `openDevTools` 字段控制 |
| 数据推送目标正确 | 如果用 IPC 推数据，需发送到 BrowserView 的 webContents，而非 BrowserWindow |

## 10. 关键文件速查

| 职责 | 文件路径 |
|------|----------|
| **Panel/Pagelet 机制** | |
| Panel 容器 | `services/tabs/electron-main/Panel.ts` |
| Pagelet（BrowserView + Process） | `services/tabs/electron-main/Pagelet.ts` |
| BrowserViewConfig 类型 | `services/tabs/common/types/pagelet.ts` |
| 配置注册 | `services/workbench/electron-main/Workbench.ts` |
| BrowserWindow（Panel 栈管理） | `services/window-manager/electron-main/BrowserWindow.ts` |
| WindowManager（窗口管理） | `services/window-manager/electron-main/WindowManager.ts` |
| **端口管理** | |
| Renderer 端 | `services/port-manager/browser/PageletClientChannel.ts` |
| Node 端 | `services/port-manager/node/ProcessClientChannel.ts` |
| Renderer 端口中介 | `services/port-manager/electron-main/AcquirePortMain.ts` |
| Process 端口中介 | `services/port-manager/electron-main/AcquireProcessPortMain.ts` |
| 连接对抽象 | `services/port-manager/common/MessageChannelPair.ts` |
| connectId 编解码 | `services/port-manager/common/connectId.ts` |
| **进程管理** | |
| Pagelet 进程 Node 端 | `services/process/pagelet-process/node/PageletProcessNode.ts` |
| Pagelet 进程 DI 模块 | `services/process/pagelet-process/node/PageletProcessModule.ts` |
| Pagelet 进程 electron-main | `services/process/pagelet-process/electron-main/PageletProcess.ts` |
| Daemon 进程管理 | `services/process/daemon-process/electron-main/DaemonProcessMain.ts` |
| UtilityProcess 封装 | `core/electron-main/utility-process/utilityProcess.ts` |
| **Monitor** | |
| Monitor 数据桥接 | `services/monitor/electron-main/MonitorBridge.ts` |
| 性能诊断数据源 | `services/diagnostics/node/Diagnostics.ts` |
| Monitor UI | `packages/ui/src/components/monitor/` |
| **Renderer** | |
| Renderer 入口与路由 | `apps/telegraph/src/index.tsx` |
| DI 注册 | `application/telegraph-application-module.ts` |

> 所有路径相对于 `apps/telegraph/src/`，除非另有说明。
