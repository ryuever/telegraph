---
id: A-007
title: Telegraph 多进程架构全貌
description: Telegraph 桌面应用的完整多进程架构文档。涵盖进程拓扑、Panel/Pagelet/PageletProcess 三层机制、侧边栏 IPC 面板切换、MessagePort 通信、Resume 断线重连、生命周期管理，以及 Monitor/Chat/Design 的具体渲染策略。
category: architecture
created: 2026-05-06
updated: 2026-05-06
tags: [architecture, pagelet, daemon, MessagePort, IPC, resume, monitor, chat, design, Panel, BrowserView, lifecycle]
status: superseded
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
  - id: A-008
    rel: superseded-by
    file: ./20260509-telegraph-final-process-architecture.md
    note: 本文描述的是改造期现状与踩坑记录；A-008 是目标态权威架构定义
---

# Telegraph 多进程架构全貌

## 1. 全局架构图

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              electron-main process                              │
│                                                                                 │
│  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────────────────────┐  │
│  │  WindowManager   │  │   AcquirePort    │  │    AcquireProcessPortMain     │  │
│  │                  │  │      Main        │  │  (UtilityProcess 端口中介)     │  │
│  │  ┌────────────┐  │  └──────────────────┘  └────────────────────────────────┘  │
│  │  │MainWindow  │  │                                                           │
│  │  │ BrowserWin │  │  ┌──────────────────┐  ┌────────────────────────────────┐  │
│  │  │            │  │  │   MonitorBridge   │  │      Workbench               │  │
│  │  │ panelsStack│  │  │  (IPC 数据推送)   │  │  (BrowserViewConfig 注册)     │  │
│  │  └────────────┘  │  └──────────────────┘  └────────────────────────────────┘  │
│  │  ┌────────────┐  │                                                           │
│  │  │MonitorWin  │  │  ┌──────────────────────────────────────────────────────┐  │
│  │  │(独立窗口)   │  │  │  ipcMain.handle('telegraph:switch-panel')           │  │
│  │  └────────────┘  │  │  → 'home': hideAllPanelViews()                       │  │
│  └─────────────────┘  │  → 其他: mainWindow.createPanel({ projectName })      │  │
│                        └──────────────────────────────────────────────────────┘  │
└────────┬──────────────────────┬───────────────────────────┬─────────────────────┘
         │                      │                           │
         │ IPC / webContents    │ MessagePort               │ MessagePort
         │                      │                           │
┌────────┴─────────────┐  ┌────┴──────────────┐  ┌────────┴──────────────┐
│  Main Window          │  │  shared-process   │  │   daemon-process      │
│  (BrowserWindow)      │  │  (全局唯一)        │  │   (全局唯一)           │
│                       │  │                   │  │                       │
│  ┌─ Sidebar ────────┐ │  │  RPC 服务中转     │  │  Diagnostics (5s)     │
│  │ [Home]           │ │  │                   │  │  MonitorBridge Client  │
│  │ [Design] ←IPC    │ │  └───────────────────┘  │  其他后台服务           │
│  │ [Chat]   ←IPC    │ │                          └───────────────────────┘
│  └──────────────────┘ │
│                       │
│  ┌─ BrowserView 层 ─────────────────────────────────────────────────┐
│  │                                                                   │
│  │  ┌─────────────────────┐     ┌─────────────────────┐              │
│  │  │ Panel: design       │     │ Panel: chat         │              │
│  │  │ ┌─────────────────┐ │     │ ┌─────────────────┐ │              │
│  │  │ │ BrowserView     │ │     │ │ BrowserView     │ │  ← z-order  │
│  │  │ │ (DesignPanel)   │ │     │ │ (ChatPanel)     │ │    切换显示  │
│  │  │ └─────────────────┘ │     │ └─────────────────┘ │              │
│  │  │ ┌─────────────────┐ │     │ ┌─────────────────┐ │              │
│  │  │ │ PageletProcess  │ │     │ │ PageletProcess  │ │              │
│  │  │ │ (UtilityProcess)│ │     │ │ (UtilityProcess)│ │              │
│  │  │ └─────────────────┘ │     │ └─────────────────┘ │              │
│  │  └─────────────────────┘     └─────────────────────┘              │
│  │                                                                   │
│  │  Home 可见时：所有 BrowserView bounds 置零，主 renderer 内容透出   │
│  └───────────────────────────────────────────────────────────────────┘
│                       │
└───────────────────────┘

┌─ Monitor 独立窗口 ────────────────┐
│  BrowserWindow (fullscreen)       │
│  ┌──────────────────────────────┐ │
│  │ Panel: monitor               │ │
│  │ ┌──────────────────────────┐ │ │
│  │ │ BrowserView              │ │ │
│  │ │ (MonitorPanel, left=0)   │ │ │
│  │ └──────────────────────────┘ │ │
│  │ ┌──────────────────────────┐ │ │
│  │ │ PageletProcess           │ │ │
│  │ │ (UtilityProcess)         │ │ │
│  │ └──────────────────────────┘ │ │
│  └──────────────────────────────┘ │
└───────────────────────────────────┘
```

### 进程连接拓扑

```
renderer (PageletClientChannel)
    ├── acquirePort()        → shared-process     (MessagePort)
    ├── acquireDaemonPort()  → daemon-process     (MessagePort)
    └── IPC (webContents)    → electron-main      (ipcRenderer)

pagelet-process (ProcessClientChannel)
    ├── acquireSharedPort()  → shared-process     (MessagePort)
    └── acquireDaemonPort()  → daemon-process     (MessagePort)

electron-main
    ├── AcquirePortMain         → 为 renderer 中介 MessagePort
    ├── AcquireProcessPortMain  → 为 UtilityProcess 中介 MessagePort
    └── ipcMain.handle          → 处理 renderer IPC 请求（面板切换等）
```

## 2. 侧边栏面板切换机制

侧边栏导航通过 IPC 通知 main process 创建/切换 Panel，每个面板对应独立的 BrowserView + PageletProcess。

### 2.1 交互流程

```
用户点击 Sidebar [Design]
  → renderer: ipcRenderer.invoke('telegraph:switch-panel', 'design')
  → electron-main: WindowManager.registerSwitchPanelHandler()
    → mainWindow.createPanel({ projectName: 'design' })
      → 首次：创建 Panel + Pagelet（BrowserView + PageletProcess）
      → 再次：从 panelsStack 找到已有 Panel，setToTop() + 恢复 bounds

用户点击 Sidebar [Home]
  → renderer: ipcRenderer.invoke('telegraph:switch-panel', 'home')
  → electron-main: mainWindow.hideAllPanelViews()
    → 所有 BrowserView bounds 置零 { x:0, y:0, width:0, height:0 }
    → 主 renderer 的 HomePage 内容从下层透出可见
```

### 2.2 视觉层级模型

主窗口内，Sidebar 和 HomePage 由主 renderer 直接渲染（BrowserWindow 自身的 webContents）。Chat/Design 各自的 BrowserView 叠加在主 renderer 之上，通过 `setTopBrowserView()` 控制 z-order：

```
z-order（从上到下）：
  ┌─────────────────────────┐
  │ BrowserView: chat       │ ← 当前激活面板（setToTop）
  ├─────────────────────────┤
  │ BrowserView: design     │ ← 后台面板（被遮挡）
  ├─────────────────────────┤
  │ 主 renderer: Sidebar +  │ ← BrowserWindow 自身内容
  │             HomePage    │    切换到 Home 时 BrowserView bounds 置零，此层可见
  └─────────────────────────┘
```

BrowserView 的 bounds 从 `left=76` 开始（预留 Sidebar 宽度），所以 Sidebar 始终可见，不会被 BrowserView 遮挡。

### 2.3 已注册的面板配置

```typescript
// Workbench.getPageletConfigs()
[
  { projectName: 'monitor', loadURL: '/monitor', openDevTools: false },
  { projectName: 'chat',    loadURL: '/chat',    openDevTools: false },
  { projectName: 'design',  loadURL: '/design',  openDevTools: false },
  // ...项目配置通过 ProjectRegistry 扩展
]
```

- **monitor**：仅在独立窗口中使用（`fullscreen: true`，无 Sidebar 偏移）
- **chat / design**：在主窗口中由侧边栏 IPC 触发创建（`left=76`，预留 Sidebar）

### 2.4 关键实现细节

**Sidebar（renderer 端，`index.tsx`）**：

```typescript
function Sidebar() {
  const [current, setCurrent] = React.useState('home')

  const handleSwitch = (key: string) => {
    setCurrent(key)
    window.telegraph?.ipcRenderer?.invoke('telegraph:switch-panel', key)
  }

  // 渲染 Home / Design / Chat 按钮（不含 Monitor）
}
```

**IPC Handler（main process，`WindowManager.ts`）**：

```typescript
private registerSwitchPanelHandler() {
  ipcMain.handle(SWITCH_PANEL_CHANNEL, (_event, projectName: string) => {
    if (projectName === 'home') {
      this.mainWindow?.hideAllPanelViews()
    } else {
      this.mainWindow?.createPanel({ projectName })
    }
  })
}
```

**hideAllPanelViews（`BrowserWindow.ts`）**：

```typescript
hideAllPanelViews() {
  for (const stack of this.panelsStack) {
    for (const pagelet of stack.panel.pagelets) {
      pagelet.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    }
  }
}
```

**createPanel 恢复 bounds**：当已存在的 panel 被切换到顶层时，调用 `panel.updatePageletDimension()` 恢复正确的 bounds（可能之前被 `hideAllPanelViews` 置零）。

## 3. Panel/Pagelet/PageletProcess 三层架构

每个功能面板由三层组成：

```
BrowserWindow（宿主窗口）
  └── Panel（面板容器，管理布局和生命周期）
       └── Pagelet（BrowserView + PageletProcess 的组合）
            ├── BrowserView  → 独立 renderer 进程，渲染 UI
            └── PageletProcess → 独立 UtilityProcess (Node.js)，执行后台逻辑
```

### 3.1 创建流程

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

### 3.2 BrowserViewConfig

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

### 3.3 fullscreen 模式

`Panel` 默认 `_panelPos.left = 76`，为主窗口左侧 Sidebar 预留空间。独立窗口（如 Monitor）不需要 Sidebar，通过 `fullscreen: true` 将 `left` 设为 0，BrowserView 占满整个窗口。

### 3.4 Renderer 端路由

所有 pagelet 的 BrowserView 加载同一个 renderer 入口（`index.html`），通过 URL 中的 `TELEGRAPH_PAGELET_RENDERER_PROCESS_ID` 参数区分身份：

```typescript
// index.tsx
function Root() {
  const appId = RENDERER_PROCESS_ID
  const isPageletView = appId && appId.includes('pagelet.')

  if (isPageletView) {
    // Pagelet BrowserView：只渲染 PageletContent（通过 hash 路由匹配组件），无 Sidebar
    return <PageletContent />
  }

  // 主窗口：Sidebar + HomePage（Chat/Design 由 BrowserView 层覆盖渲染）
  return <Sidebar /> + <HomePage />
}

function PageletContent() {
  const hash = useHashRoute()
  if (hash.includes('/monitor')) return <MonitorPanel />
  if (hash.includes('/chat'))    return <ChatPanel />
  if (hash.includes('/design'))  return <DesignPanel />
  return <HomePage />
}
```

**ID 格式**：pagelet ID 形如 `window.2_panel.chat_pagelet.chat`，包含 `pagelet.` 片段用于身份识别。

`getRendererProcessId()` 同时从 `window.location.search` 和 hash 中的 query 提取参数，兼容 production（search）和 dev（hash routing）两种模式。

## 4. 各面板渲染策略对比

| 面板 | 宿主窗口 | Panel 模式 | 触发方式 | Sidebar | 说明 |
|------|----------|-----------|----------|---------|------|
| **Home** | 主窗口 | 无 Panel | IPC `'home'` → `hideAllPanelViews()` | 有 | 主 renderer 直接渲染，BrowserView 隐藏后透出 |
| **Chat** | 主窗口 | `left=76` | IPC `'chat'` → `createPanel()` | 有 | BrowserView 覆盖在主 renderer 之上 |
| **Design** | 主窗口 | `left=76` | IPC `'design'` → `createPanel()` | 有 | 同上 |
| **Monitor** | 独立窗口 | `fullscreen` (`left=0`) | `toggleMonitorWindow()` | 无 | 独立 BrowserWindow，BrowserView 占满 |

### 数据流差异

```
Chat / Design:
  Sidebar 点击
    → IPC 'telegraph:switch-panel'
    → main: createPanel() → Panel + Pagelet(BrowserView + PageletProcess)
    → BrowserView 加载 /#/chat 或 /#/design
    → PageletProcess 可选后台逻辑

Monitor:
  菜单 Toggle / 快捷键
    → WindowManager.toggleMonitorWindow()
    → 新建 BrowserWindow + Panel(fullscreen) + Pagelet
    → daemon Diagnostics (5s tick) → RPC → MonitorBridge → IPC → BrowserView
```

## 5. Monitor 窗口改造（案例研究）

### 5.1 改造前的问题

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

### 5.2 改造后的架构

```
改造后：
toggleMonitor
  → WindowManager.createMonitorWindow()
    → browserWindowFactory()           // 创建 BrowserWindow（宿主，不加载 URL）
    → monitorWindow.createPanel({ projectName: 'monitor', fullscreen: true })
      → Panel → Pagelet
        → BrowserView.loadURL('/monitor')  // UI 在 BrowserView 中渲染
        → PageletProcess                   // 独立 UtilityProcess
    → window.show()                    // 手动显示（见 §5.3）
```

### 5.3 开发过程中的踩坑记录

#### 坑 1：主窗口 Sidebar 消失

**现象**：打开主应用后 Sidebar（Home/Design/Chat 导航）消失。

**根因**：`Root` 组件用白名单 `isMainApp = appId === 'main-renderer-app' || appId === 'auxiliary-app'` 判断是否显示 Sidebar。但登录页的 `appId` 是 `main-renderer-login`，不在白名单中，走了 pagelet 分支（无 Sidebar）。

**修复**：反转判断逻辑——只有 ID 包含 `pagelet.` 模式的才是 pagelet BrowserView，其余所有情况都显示 Sidebar。这样无论未来新增什么 appId（登录、设置等），都不需要修改白名单。

#### 坑 2：Monitor 窗口不显示

**现象**：点击 Toggle Monitor 后没有任何窗口出现。

**根因**：改造后 BrowserWindow 自身不加载任何 URL（内容在 BrowserView 中），而 `BaseWindow.registerListeners()` 中的 `ready-to-show` 事件依赖窗口内容加载完成后触发 `window.show()`。空白窗口的 `ready-to-show` 可能不会可靠触发。

**修复**：在 `createPanel` 之后手动调用 `window.show()`。

#### 坑 3：DevTools 自动打开

**现象**：Monitor 窗口打开时自动弹出 DevTools。

**根因**：`Pagelet.createBrowserView()` 在 dev 模式下对所有 BrowserView 自动开启 DevTools。

**修复**：`BrowserViewConfig` 新增 `openDevTools?: boolean` 字段，判断 `openDevTools !== false` 才开启。

#### 坑 4：pagelet process 泄漏（关闭后残留）

**现象**：关闭 Monitor 窗口后重新打开，进程列表中出现两个 `monitor-pagelet-process`。

**根因**：窗口关闭时未清理 `panelsStack`，导致 PageletProcess（UtilityProcess）未被 kill。

**修复**：`BrowserWindow` 注册 `onWindowDidCloseHandler` → `disposeAllPanels()`，级联清理 Panel/Pagelet/PageletProcess。`PageletProcess.dispose` 时 `utilityProcess.process.kill()`。

#### 坑 5：Monitor 数据推送目标变更

**现象**：改造后 Monitor 面板收不到数据。

**根因**：`pushSnapshot` 发送到 BrowserWindow 的 webContents，但 UI 已在 BrowserView 的独立 webContents 中。

**修复**：遍历 BrowserView 的 webContents 推送。同时向主窗口 webContents 推送（支持 Sidebar 内嵌 Monitor 场景，已预留）。

## 6. 端口获取机制

### 6.1 Renderer 端 — PageletClientChannel

位置：`services/port-manager/browser/PageletClientChannel.ts`

renderer 进程通过 preload bridge 向 electron-main 请求 MessagePort：

```typescript
await this.portManager.acquirePort();       // → shared-process
await this.portManager.acquireDaemonPort(); // → daemon-process
```

底层调用 `window.telegraph.ipcRenderer.invoke('acquirePort', ...)`，electron-main 创建 `MessageChannelPair`，将一端通过 `webContents.postMessage` 传回 renderer，另一端通过 `UtilityProcess.postMessage` 传给目标进程。

### 6.2 Node 端 — ProcessClientChannel

位置：`services/port-manager/node/ProcessClientChannel.ts`

pagelet process（UtilityProcess）通过 `parentPort` 与 electron-main 通信：

```typescript
await this.portManager.acquireSharedPort();  // → shared-process
await this.portManager.acquireDaemonPort();  // → daemon-process
```

### 6.3 Electron-Main 端口中介

| 中介类 | 文件 | 服务对象 |
|--------|------|----------|
| `AcquirePortMain` | `services/port-manager/electron-main/AcquirePortMain.ts` | renderer（BrowserWindow） |
| `AcquireProcessPortMain` | `services/port-manager/electron-main/AcquireProcessPortMain.ts` | UtilityProcess（pagelet/shared/daemon） |

中介流程：
1. 收到端口请求 → 解析 `connectId`（包含源进程 ID 和目标进程类型）
2. 创建 `MessageChannelPair`（`services/port-manager/common/MessageChannelPair.ts`）
3. 将 port1 传给请求方，port2 传给目标进程
4. 在 `PortManager` 中记录连接对，用于后续 resume

### 6.4 connectId 格式

位置：`services/port-manager/common/connectId.ts`

`connectId` 编码了连接的源和目标信息，格式为 `{sourceProcessId}:{targetType}`，用于 electron-main 路由端口请求到正确的目标进程。

## 7. Pagelet → Daemon 直连

### 7.1 变更动机

之前 pagelet process 只连接 shared-process，需要 daemon 服务时要经过 shared 中转。新增直连后，pagelet 可直接调用 daemon 上的 RPC 服务（如 `MonitorBridgeClient`），减少一跳延迟。

### 7.2 关键变更

**PageletProcessNode.ts**（`services/process/pagelet-process/node/PageletProcessNode.ts:51`）：

```typescript
// 启动时自动连接 daemon
this.portManager.acquireDaemonPort();
```

**PageletProcessModule.ts**（`services/process/pagelet-process/node/PageletProcessModule.ts:55`）：

```typescript
// 将 MonitorBridgeClient 绑定到 daemonProcessChannelProtocol
bind(MonitorBridgeClient).toDynamicValue(({ container }) => {
  const channelClient = container.get(ProcessClientChannelId)
  return new ProxyRPCClient(monitorServicePath, {
    channel: channelClient.daemonProcessChannelProtocol,
  }).createProxy() as unknown as IMonitorBridge
})
```

## 8. Resume（断线重连）机制

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

## 9. 生命周期管理

### 9.1 主窗口面板生命周期

```
应用启动
  → Workbench.createMainWindow()
    → WindowManager.createMainWindow()
      → BrowserWindow 创建，loadURL('/app?...=main-renderer-app')
      → 主 renderer 渲染 Sidebar + HomePage
  → 用户点击 [Chat]
    → IPC → createPanel({ projectName: 'chat' })
      → Panel + Pagelet(BrowserView + PageletProcess) 创建
      → BrowserView 叠加在主 renderer 之上
  → 用户点击 [Home]
    → IPC → hideAllPanelViews()
      → 所有 BrowserView bounds 置零
      → HomePage 从下层透出
  → 用户再次点击 [Chat]
    → IPC → createPanel({ projectName: 'chat' })
      → panelsStack 中找到已有 Panel
      → setToTop() + updatePageletDimension() 恢复 bounds
```

### 9.2 独立窗口生命周期（Monitor）

```
WindowManager.createMonitorWindow()
  → browserWindowFactory({ isPrimary: false, fullscreen 参数... })
  → onDidWindowCreated:
    → monitorWindow.createPanel({ projectName: 'monitor', fullscreen: true })
    → window.show()

用户关闭 Monitor 窗口（或再次 Toggle）
  → BrowserWindow 'closed' 事件
    → BaseWindow.dispose()
      → BrowserWindow.disposeAllPanels()
        → Panel.disposePanel() → Pagelet.disposePagelet()
          → removeBrowserView + webContents.destroy()
        → PageletProcess.dispose() → utilityProcess.process.kill()
        → cachedPageletProcessMap.clear()
      → WindowManager: windowMap 清理，monitorWindow 置 null
```

### 9.3 PageletProcess 缓存策略

`BrowserWindow.cachedPageletProcessMap` 按 `projectName` 缓存 PageletProcess。同一窗口内多次 `addPagelet` 同名 project 会复用已有进程。

注意：缓存绑定到 BrowserWindow 实例。Monitor 每次 toggle 创建新 BrowserWindow，不会复用上次的 PageletProcess。主窗口的 Chat/Design Panel 一旦创建则持续存在于 panelsStack 中，再次切换时复用，不会重复创建。

## 10. Monitor 数据流（端到端）

```
daemon-process                    electron-main              renderer (BrowserView)
┌─────────────┐                  ┌──────────────┐           ┌──────────────┐
│ Diagnostics  │  RPC pushSnapshot │ MonitorBridge │  IPC send  │ MonitorPanel │
│ (每5秒 tick) │ ──────────────→ │              │ ────────→ │ (hooks.ts)   │
└─────────────┘                  └──────────────┘           └──────────────┘
```

1. **数据源**：`Diagnostics`（daemon-process）每 5 秒收集快照（CPU、内存、进程树，调用 `app.getAppMetrics()`）
2. **RPC 推送**：通过 `MonitorBridgeClient.pushSnapshot()` 调用 electron-main 的 `MonitorBridge`
3. **IPC 分发**：`MonitorBridge` 向主窗口 webContents + Monitor 独立窗口的 BrowserView webContents 推送
4. **UI 渲染**：renderer 中 `hooks.ts` 监听 `MONITOR_SNAPSHOT_CHANNEL`，更新 React state

## 11. 新增 Pagelet 功能开发指南

### 11.1 注册 BrowserViewConfig

在 `Workbench.getPageletConfigs()` 的 `builtinConfigs` 数组中添加：

```typescript
{
  projectName: 'your-feature',
  loadURL: '/your-feature',       // 对应 PageletContent 中的 hash 路由
  openDevTools: false,
  webPreferences: { preload },
  amdEntry: 'path/to/entry.js',  // 可选，pagelet process 的业务入口
}
```

### 11.2 添加 Renderer 路由

在 `index.tsx` 的 `PageletContent` 中添加 hash 路由：

```typescript
function PageletContent() {
  const hash = useHashRoute()
  if (hash.includes('/your-feature')) return <YourFeaturePanel />
  // ...
}
```

### 11.3 添加侧边栏入口（主窗口内面板）

在 `Sidebar` 的 `links` 数组中添加：

```typescript
const links = [
  // ...
  { key: 'your-feature', label: 'Your Feature', icon: YourIcon },
]
```

点击会自动触发 `ipcRenderer.invoke('telegraph:switch-panel', 'your-feature')`，main process 调用 `createPanel({ projectName: 'your-feature' })`。

### 11.4 创建独立窗口（可选）

参考 `createMonitorWindow`，在 `WindowManager` 中添加。使用 `fullscreen: true` 让 BrowserView 占满整个窗口。

### 11.5 核心检查清单

| 检查项 | 说明 |
|--------|------|
| BrowserViewConfig 已注册 | `Workbench.getPageletConfigs()` 返回配置 |
| Renderer 路由已添加 | `PageletContent` 中的 hash 匹配 |
| 侧边栏入口已添加（如需要） | `Sidebar` 的 `links` 数组 |
| 窗口关闭时资源释放 | `disposeAllPanels` 会级联清理（已内置） |
| DevTools 行为符合预期 | 通过 `openDevTools` 字段控制 |
| 数据推送目标正确 | 如果用 IPC 推数据，需发送到 BrowserView 的 webContents |

## 12. 关键文件速查

| 职责 | 文件路径 |
|------|----------|
| **侧边栏与面板切换** | |
| IPC 通道常量 | `services/window-manager/common/channels.ts` |
| IPC Handler 注册 | `services/window-manager/electron-main/WindowManager.ts` |
| Sidebar 组件 | `apps/telegraph/src/index.tsx` |
| hideAllPanelViews | `services/window-manager/electron-main/BrowserWindow.ts` |
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
