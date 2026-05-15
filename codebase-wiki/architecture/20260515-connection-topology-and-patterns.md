---
id: A-011
title: Telegraph 连接拓扑与通信模式
description: >
  系统梳理 Telegraph 中所有进程间连接方式：三个通信层（IPC / Direct / Utility Control）、
  各进程启动后的连接建立时序、Pagelet 全生命周期连接演变、以及跨 Pagelet 高频交互的
  服务发现 + 直连方案。
category: architecture
created: 2026-05-15
updated: 2026-05-15
tags:
  - architecture
  - connection-topology
  - rpc
  - connection-orchestrator
  - pagelet
  - forwarding-proxy
  - inter-pagelet
status: draft
references:
  - id: A-008
    rel: extends
    file: ./20260509-telegraph-final-process-architecture.md
  - id: D-005
    rel: extends
    file: ../discussion/20260508-renderer-pagelet-channel-convergence.md
  - id: D-006
    rel: related-to
    file: ../discussion/20260508-x-oasis-orchestrator-capability-gaps.md
---

# Telegraph 连接拓扑与通信模式

> 本文是 A-008（最终进程架构）的连接层补充，聚焦"谁和谁怎么连"。
> A-008 定义进程职责与不变量，本文把每条线展开为拓扑图 + 建连时序 + RPC 约定。

---

## 1. 三个通信层

Telegraph 的所有进程间通信可归入三个正交层：

| 层 | 传输方式 | 承载内容 | 参与者 |
|----|----------|----------|--------|
| **IPC 层** | `ipcMain` ↔ `ipcRenderer`（经 contextBridge） | 主进程系统级服务（窗口控制、metrics、orchestrator 控制面板） | Main ↔ Renderer |
| **Direct 层** | MessagePort（经 orchestrator 中介建立） | Renderer ↔ Pagelet 的业务 RPC | Renderer ↔ Pagelet |
| **Utility Control 层** | MessagePort（经 `createParticipantProxy` 建立） | Pagelet ↔ Singleton（shared / daemon）的 RPC | Pagelet ↔ Shared, Pagelet ↔ Daemon |

```
┌───────────────────────────────────────────────────────────────────────┐
│                        Main Process (Orchestrator Host)               │
│                                                                       │
│  IPC 层 ──────────── ipcMain/ipcRenderer ────────────                 │
│    │  main-rpc / main-window / main-metrics / orchestrator 控制面板   │
│    │                                                                  │
│  Direct 层 ────────── MessagePort (orchestrator.connect) ──────────   │
│    │  pagelet-api / design-pagelet-api / chat-pagelet-api / ...      │
│    │                                                                  │
│  Utility Control 层 ── MessagePort (createParticipantProxy) ────────  │
│       shared-rpc / daemon-rpc                                        │
└───────────────────────────────────────────────────────────────────────┘
```

**核心约束**（A-008 §I1, §I4）：

- Renderer 同一时刻只与一个 Pagelet 有 Direct 层连接（单 channel 故障域）
- 所有跨进程调用必须走 ConnectionOrchestrator + RPC，禁止裸 `ipcMain.handle` / `ipcRenderer.invoke`
- Main 不是 participant——它是 orchestrator 宿主 + 路由器

---

## 2. 全局连接拓扑

### 2.1 当前已实现的拓扑

```
                    ┌───────────── Main (orchestrator) ─────────────┐
                    │  control plane: ORCHESTRATOR_CP_CHANNEL_NAME   │
                    └──┬────────┬────────┬────────┬────────┬────────┘
                       │        │        │        │        │
              utility  │        │        │        │        │
              port     │        │        │        │        │
                       ▼        ▼        ▼        ▼        ▼
                  ┌────────┐┌────────┐┌────────┐┌────────┐┌────────┐
                  │ shared ││ daemon ││  conn  ││design  ││  chat  │
                  │        ││        ││pagelet ││pagelet ││pagelet │
                  └───┬────┘└───┬────┘└───┬────┘└───┬────┘└───┬────┘
                      │         │         │         │         │
           shared-rpc │         │daemon-rpc│         │         │
                      │         │         │         │         │
                      ▼         ▼         │         │         │
                  ┌────────────────────┐  │         │         │
                  │ conn pagelet 连接   │  │         │         │
                  │  shared + daemon   │  │         │         │
                  └────────────────────┘  │         │         │
                                          │         │         │
              direct channel (MessagePort)│         │         │
              (renderer ↔ pagelet)        │         │         │
                                          ▼         ▼         ▼
                  ┌─────────────────────────────────────────────────┐
                  │              BrowserWindow Renderer              │
                  │  participant: renderer                          │
                  │                                                  │
                  │  ┌──────────┐ ┌──────────┐ ┌──────┐ ┌──────┐  │
                  │  │Connection│ │ Design   │ │Chat  │ │Monitor│  │
                  │  │Panel    │ │ Panel    │ │Panel │ │Panel │  │
                  │  └──────────┘ └──────────┘ └──────┘ └──────┘  │
                  └─────────────────────────────────────────────────┘
```

### 2.2 连接矩阵（已实现）

| From | To | 层 | Channel 类型 | Service Path | 建连方式 |
|------|----|----|-------------|-------------|---------|
| Renderer | Main | IPC | `ipcMain/ipcRenderer` | `main-rpc`, `main-window`, `main-metrics`, `orchestrator` | preload bridge 初始化 |
| Renderer | Connection | Direct | MessagePort | `pagelet-api` | `orchestrator.connect('renderer', 'connection')` |
| Renderer | Design | Direct | MessagePort | `design-pagelet-api` | `orchestrator.connect('renderer', 'design')` |
| Renderer | Chat | Direct | MessagePort | `chat-pagelet-api` | `orchestrator.connect('renderer', 'chat')` |
| Renderer | Monitor | Direct | MessagePort | `monitor-pagelet-api` | `orchestrator.connect('renderer', 'monitor')` |
| Connection | Shared | Utility Control | MessagePort | `shared-rpc` | `createParticipantProxy.connect('shared')` |
| Connection | Daemon | Utility Control | MessagePort | `daemon-rpc` | `createParticipantProxy.connect('daemon')` |
| Design | Shared | Utility Control | MessagePort | `shared-rpc` | `createParticipantProxy.connect('shared')` |
| Design | Daemon | Utility Control | MessagePort | `daemon-rpc` | `createParticipantProxy.connect('daemon')` |

---

## 3. 各进程启动后的连接时序

### 3.1 应用启动全序列

```
t=0ms   Main Process Boot
         │
t=10ms  MainCpServer.start()
         │  ├─ 创建 ElectronConnectionOrchestrator
         │  ├─ 创建 IPCMainChannel (ORCHESTRATOR_CP_CHANNEL_NAME)
         │  ├─ orchestrator.registerParticipant('renderer', ipcChannel)
         │  └─ 注册 MainServiceHost 到 orchestrator
         │
t=50ms  WindowManager.openMainWindow()
         │  └─ BrowserWindow 创建，preload.ts 执行
         │
t=100ms Renderer (preload) Bridge 初始化
         │  ├─ createPageBridge({ serviceRoutes, defaultPeerId: 'connection' })
         │  ├─ 注册 IPC 层客户端: main-rpc, main-window, main-metrics, orchestrator
         │  └─ 注册 Direct 层路由: servicePath → participantId 映射
         │
t=200ms Singleton 进程启动 (并行)
         │  ├─ SharedProcess.spawn()
         │  │   └─ UtilityProcessSupervisor → fork shared-worker.js
         │  │       └─ SharedWorker.boot()
         │  │           ├─ 创建 ElectronUtilityProcessChannel (parentPort)
         │  │           └─ createParticipantProxy({ selfId: 'shared' })
         │  │               └─ onConnection → 注册 shared-rpc service
         │  │
         │  └─ DaemonProcess.spawn()
         │      └─ UtilityProcessSupervisor → fork daemon-worker.js
         │          └─ DaemonWorker.boot()
         │              ├─ 创建 ElectronUtilityProcessChannel (parentPort)
         │              └─ createParticipantProxy({ selfId: 'daemon' })
         │                  └─ onConnection → 注册 daemon-rpc service
         │
t=500ms Pagelet 进程启动 (串行，按 sidebar 顺序)
         │
         ├─ ConnectionApp.start()
         │   ├─ pageletProcess.spawn('connection', 'connection-worker.js')
         │   │   └─ UtilityProcessSupervisor → fork connection-worker.js
         │   │       └─ ConnectionWorker.boot()
         │   │           ├─ 创建 control channel (parentPort → main)
         │   │           ├─ 并行连接 shared + daemon (5s timeout, 不阻塞)
         │   │           └─ onRendererConnection → 注册 pagelet-api service
         │   │               ├─ callSharedEcho → this.shared.echo()
         │   │               ├─ callDaemonEcho → this.daemon.echo()
         │   │               └─ callMainPing → this.main.mainPing()
         │   │
         │   └─ appOrchestrator.connectDesign()
         │       └─ orchestrator.connect('renderer', 'connection')
         │
         ├─ MonitorApp.start()    (同模式)
         ├─ SettingApp.start()    (同模式，额外挂载 setting window orchestrator)
         ├─ DesignApp.start()     (同模式)
         └─ ChatApp.start()       (同模式)
```

### 3.2 Pagelet Worker 内部建连细节

每个 Pagelet Worker 的 `boot()` 流程相同（`PageletWorker` 基类）：

```
PageletWorker.boot()
  │
  ├─ 1. 创建 control channel (parentPort → main)
  │     const mainChannel = new ElectronUtilityProcessChannel({
  │       parentPort: process.parentPort,
  │       description: `${selfId}→main IPC channel`,
  │     })
  │
  ├─ 2. 创建 participant proxy (与 orchestrator 握手)
  │     const proxy = createParticipantProxy({
  │       selfId: 'connection',        // 或 'design' / 'chat' / ...
  │       controlChannel: mainChannel,
  │       onConnection: (conn) => { ... }
  │     })
  │
  ├─ 3. 并行连接 singleton 进程 (Promise.allSettled, 5s per-peer timeout)
  │     ├─ connectPeer('shared') → sharedChannel + sharedClient
  │     └─ connectPeer('daemon') → daemonChannel + daemonClient
  │
  │     ⚠️ timeout 不阻塞 boot；连接继续在后台进行
  │     ⚠️ sharedClient 为 null 时，forwardingProxy 返回 fallback
  │
  └─ 4. 等待 renderer 连接 (onConnection callback)
        if (conn.peerId === 'renderer') {
          onRendererConnection(channel)
          → 注册 pagelet service
          → 注册 forwarding proxy (未来)
        }
```

---

## 4. Pagelet 全生命周期连接演变

以 Design Pagelet 为例，从 spawn 到崩溃重启：

```
                    ┌─────────────────────────────────────────┐
                    │  Phase 0: 不存在                         │
                    │  无进程、无连接                           │
                    └────────────────┬────────────────────────┘
                                     │ user 点击 Design tab
                                     ▼
                    ┌─────────────────────────────────────────┐
                    │  Phase 1: Spawning                       │
                    │                                          │
                    │  Main:                                   │
                    │    pageletProcess.spawn('design')        │
                    │    └─ UtilityProcessSupervisor.fork()    │
                    │                                          │
                    │  Design Worker:                          │
                    │    ① control channel → main (parentPort) │
                    │    ② 并行 connect shared + daemon        │
                    │                                          │
                    │  连接拓扑:                                │
                    │    design ──control──▶ main              │
                    │    design ──shared-rpc──▶ shared ⏳      │
                    │    design ──daemon-rpc──▶ daemon ⏳      │
                    └────────────────┬────────────────────────┘
                                     │ shared/daemon 连接完成
                                     │ appOrchestrator.connectDesign()
                                     ▼
                    ┌─────────────────────────────────────────┐
                    │  Phase 2: Ready                          │
                    │                                          │
                    │  连接拓扑:                                │
                    │    design ──control──▶ main              │
                    │    design ══shared-rpc══▶ shared  ✅     │
                    │    design ══daemon-rpc══▶ daemon  ✅     │
                    │    renderer ══direct══▶ design   ✅     │
                    │                                          │
                    │  RPC 就绪:                                │
                    │    renderer → design.info()              │
                    │    renderer → design.ping()              │
                    └────────────────┬────────────────────────┘
                                     │ design 进程崩溃 (kill -9)
                                     ▼
                    ┌─────────────────────────────────────────┐
                    │  Phase 3: TRANSIENT_FAILURE               │
                    │                                          │
                    │  连接拓扑:                                │
                    │    design (dead)                          │
                    │    renderer ──direct──▶ design  💔       │
                    │    shared  ──shared-rpc──▶ design 💔    │
                    │                                          │
                    │  Main ProcessSupervisor:                  │
                    │    ├─ 检测到 process exit                 │
                    │    ├─ 决定重启 (ExponentialBackoffPolicy) │
                    │    └─ spawn 新 utility process            │
                    └────────────────┬────────────────────────┘
                                     │ 新进程 control port 就绪
                                     │ replaceParticipantChannel('design', newChannel)
                                     ▼
                    ┌─────────────────────────────────────────┐
                    │  Phase 4: Reconnected                    │
                    │                                          │
                    │  连接拓扑 (participantId 不变):           │
                    │    design ──control──▶ main              │
                    │    design ══shared-rpc══▶ shared  ✅     │
                    │    design ══daemon-rpc══▶ daemon  ✅     │
                    │    renderer ══direct══▶ design   ✅     │
                    │                                          │
                    │  业务层收到 onReconnected 事件            │
                    │  上层只看到 TRANSIENT_FAILURE → READY     │
                    └─────────────────────────────────────────┘
```

---

## 5. 各连接类型详解

### 5.1 IPC 层：Main ↔ Renderer

**用途**：主进程系统级能力，不经过 Pagelet。

**Channel**：`IPCMainChannel` ↔ preload `createPageBridge`

```
Main                              Renderer
┌──────────────────┐             ┌──────────────────┐
│ IPCMainChannel   │  ipcMain/   │ createPageBridge  │
│                  │  ipcRenderer│  ├─ ipcChannel    │
│ serviceHost:     │◄───────────►│  └─ channel       │
│  main-rpc        │             │                    │
│  main-window     │             │ clientHost:        │
│  main-metrics    │             │  mainWindowClient  │
│  orchestrator    │             │  metricsClient     │
└──────────────────┘             └──────────────────┘
```

**Service 一览**：

| Service Path | 接口 | 说明 |
|-------------|------|------|
| `main-rpc` | `IMainRpcService.mainPing(msg)` | 主进程心跳 |
| `main-window` | `IMainWindowService.openSettingWindow()`, `.onSwitchPage(cb)` | 窗口控制 |
| `main-metrics` | `IMainMetricsService.getAppMetrics()`, `.getSupervisorSnapshots()`, `.onSupervisorSnapshotsChanged(cb)` | 进程 metrics 聚合 |
| `orchestrator` | `IOrchestratorService.connect()`, `.disconnect()`, `.getStatus()`, `.killUtility()`, `.onStateChange(cb)` | 连接面板控制 |

### 5.2 Direct 层：Renderer ↔ Pagelet

**用途**：Renderer 与当前激活 Pagelet 之间的业务 RPC。

**Channel**：MessagePort（经 `orchestrator.connect('renderer', participantId)` 建立）

```
Main (Orchestrator)
┌────────────────────┐
│ connect('renderer',│  ← 1. renderer 请求建连
│   'design')        │  ← 2. orchestrator 中介建立 MessagePort
│                    │  ← 3. 两端各持 port 的一半
└────────┬───────────┘
         │ MessagePort pair
         ▼
Renderer                     Design Pagelet
┌──────────────────┐        ┌──────────────────┐
│ directChannel    │═══════▶│ onRendererConnection│
│                  │        │                    │
│ clientHost:      │  RPC   │ serviceHost:       │
│  designClient    │◄──────▶│  design-pagelet-api│
└──────────────────┘        └──────────────────┘
```

**Service Route 映射**（preload bridge 配置）：

```typescript
serviceRoutes: {
  'pagelet-api':          'connection',    // Connection Pagelet
  'monitor-pagelet-api':  'monitor',       // Monitor Pagelet
  'design-pagelet-api':   'design',        // Design Pagelet
  'chat-pagelet-api':     'chat',          // Chat Pagelet
}
```

**各 Pagelet 暴露的 Service**：

| Pagelet | Service Path | 方法 |
|---------|-------------|------|
| Connection | `pagelet-api` | `info()`, `callSharedEcho()`, `callSharedGetConfig()`, `callSharedSetConfig()`, `callDaemonEcho()`, `callDaemonSystemStatus()`, `callMainPing()` |
| Design | `design-pagelet-api` | `info()`, `ping()` |
| Monitor | `monitor-pagelet-api` | `info()`, `ping()`, `callSharedEcho()`, `callDaemonSystemStatus()` |
| Chat | `chat-pagelet-api` | `info()`, `ping()` |
| Setting | `setting-pagelet-api` | `info()`, `ping()` |

### 5.3 Utility Control 层：Pagelet ↔ Singleton

**用途**：Pagelet 访问 Shared / Daemon 全局服务。

**Channel**：MessagePort（经 `createParticipantProxy.connect()` 建立，在 Pagelet Worker `boot()` 中并行发起）

```
Design Pagelet                           Shared Process
┌──────────────────────┐                ┌──────────────────────┐
│ createParticipantProxy│                │ createParticipantProxy│
│   .connect('shared') │─── MessagePort ──▶│ onConnection       │
│                      │◀── shared-rpc ──│ serviceHost:        │
│ sharedClient =       │                │  shared-rpc          │
│   clientHost.register│                │                     │
│   ('shared-rpc',     │                │ handlers:           │
│    { channel })      │                │  echo()             │
│   .createProxy()     │                │  getConfig()        │
│                      │                │  setConfig()        │
│ forwardingProxy:     │                │  onConfigChange()   │
│   shared.echo()      │                └──────────────────────┘
│   → sharedClient?.echo()
│     ?? 'shared not ready'            Daemon Process
│                      │                ┌──────────────────────┐
│   .connect('daemon') │─── MessagePort ──▶│ onConnection       │
│                      │◀── daemon-rpc ──│ serviceHost:        │
│ daemonClient =       │                │  daemon-rpc          │
│   clientHost.register│                │                     │
│   ('daemon-rpc',     │                │ handlers:           │
│    { channel })      │                │  echo()             │
│   .createProxy()     │                │  systemStatus()     │
└──────────────────────┘                │  getPerformanceSnapshot() │
                                        │  onPerformanceUpdate()   │
                                        └──────────────────────┘
```

**ForwardingProxy 降级机制**：

```typescript
// PageletWorker 基类
protected readonly shared = createForwardingProxy<TSharedService>(
  () => this.sharedClient,  // 可能为 null
  'shared'                  // fallback 标识
);

// sharedClient 为 null 时：
//   shared.echo('hello') → Promise.resolve('shared not ready')
// sharedClient 就绪后自动透传
```

**超时与容错**：

- 每个 peer 连接有独立的 5s 超时（`peerConnectTimeoutMs`）
- `Promise.allSettled` 确保单个 peer 超时不阻塞其他 peer
- 超时后连接在后台继续尝试；forwarding proxy 在此期间返回 fallback

---

## 6. 重连策略

所有 Direct 层和 Utility Control 层连接共享同一套重连配置：

```typescript
{
  reconnectPolicy: new ExponentialBackoffPolicy({
    initialDelayMs: 1_000,       // 首次重连等 1s
    maxDelayMs:    30_000,       // 最大间隔 30s
    multiplier:    2,            // 每次翻倍
    jitterFactor:  0.3,          // 30% 抖动
    maxRetries:    10,           // 最多重试 10 次
    maxElapsedMs:  5 * 60_000,  // 总时长上限 5 分钟
  }),
  activateTimeoutMs:    30_000,  // 首连超时 30s
  retryOnInitialFailure: true,   // 首连失败也重试
}
```

**状态机**：

```
IDLE ──connect()──▶ CONNECTING ──success──▶ READY
                        │                      │
                        │ failure              │ disconnect / peer crash
                        ▼                      ▼
                   TRANSIENT_FAILURE       DISCONNECTING
                        │                      │
                        │ reconnectPolicy      │ cleanup
                        ▼                      ▼
                   RECONNECTING ──success──▶ READY
                        │
                        │ maxRetries exceeded
                        ▼
                     CLOSED
```

**事件流**（Renderer 可订阅）：

| 事件 | 含义 |
|------|------|
| `ready` | 连接就绪，可发送 RPC |
| `disconnected` | 对端主动断开 |
| `reconnecting` | 开始重连尝试 |
| `reconnected` | 重连成功 |
| `reconnectFailed` | 重连最终放弃 |
| `stateChange` | 通用状态变更 |

---

## 7. 跨 Pagelet 高频交互

### 7.1 为什么禁止 Pagelet 直连？

A-008 §3.4 禁止 Pagelet 之间直接通信。原始说法是"避免拓扑爆炸"，
但对 3-5 个 pagelet 来说，连接数 O(N²) ≈ 十来条，根本不会"爆炸"。

**真正的约束是三个运维层面的问题**：

#### ① 生命周期不对齐

Pagelet 是 **lazy spawn** 的。Chat 启动时 Design 可能还没被创建：

```
Chat pagelet                     Design pagelet
┌──────────────┐                 ┌──────────────┐
│  boot()      │                 │   (不存在)    │
│  connect(    │──✗ 失败 ────────│              │
│   'design')  │                 └──────────────┘
└──────────────┘
```

谁来做"等 Design 就绪再连"这个编排？没有现成机制。
而 Shared / Daemon 是**常驻单例**，不存在这个问题。

#### ② 服务发现缺失

Chat 不应该硬编码 `pagelet:design:1` 这个 participantId：

```
# 错误：硬编码
orchestrator.connect('pagelet:chat:1', 'pagelet:design:1')

# 问题：
#   - Design 还没启动？→ participantId 不存在
#   - Design 重启了？→ instanceId 可能变了（未来多实例场景）
#   - Chat 怎么知道 Design 当前是否可用？
```

需要一层**服务发现**来解耦 participantId 的获取，当前没有。

#### ③ 故障感知不对称

Design 崩溃重启后，Chat 需要知道并重连：

```
Design 崩溃
    │
    ├─ Shared 知道吗？不一定，除非 Design 注册过
    ├─ Chat 知道吗？channel 触发 TRANSIENT_FAILURE
    └─ 谁通知 Chat "Design 已恢复"？→ 需要额外订阅机制
```

走 orchestrator 的 `onReconnected` 可以自动恢复 channel，
但 Chat 仍需要知道"我要连谁"——回到问题②。

#### 对比：Shared 中转为什么没有这些问题

| 问题 | Shared 中转 | Pagelet 直连 |
|------|------------|-------------|
| 生命周期 | Shared 常驻，永远在 | 对端可能没启动 |
| 服务发现 | participantId 固定 = `shared` | 需要动态获取 |
| 故障感知 | channel 自动 onReconnected | 同上，但需要知道对端是谁 |

**结论**：不是"拓扑爆炸"，而是"Pagelet 间直连需要额外的服务发现和生命周期编排，
而 Shared 已经提供了稳定的中间层"。

### 7.2 低频场景：Shared 中转

对于偶尔的跨 Pagelet 协作，走 Shared 中转即可：

```
Chat pagelet ──RPC──▶ Shared ──RPC──▶ Design pagelet
  (shared-rpc)       (转发)      (design channel)
```

优点：简单、无需额外连接、Shared 常驻不会失败。
缺点：多一跳序列化延迟，不适合高频/流式交互。

### 7.3 高频场景：Shared 做服务发现 + Pagelet 直连做数据面

**核心思路**：控制面走 Shared，数据面走 Pagelet 直连。

```
                      Shared (常驻单例)
                     ┌──────────────────┐
    register/unreg ─▶│ PageletRegistry  │◀──── resolve('design')
                     │                  │─────▶ { participantId, state }
                     └──────────────────┘
                              ▲
                              │ subscribe('design', cb) — 就绪推送
                              │
    Chat pagelet ═══════════════════════ Design pagelet
         direct channel (P2P, 经 orchestrator.connect 建立)
```

**流程**：

1. **Design 启动**：向 Shared 注册
   ```
   Design ──RPC──▶ Shared.pageletRegistry.register({
     app: 'design',
     participantId: 'pagelet:design:1',
     capabilities: ['canvas-sync', 'asset-query']
   })
   ```

2. **Chat 需要时**：查询 + 订阅
   ```
   Chat ──RPC──▶ Shared.pageletRegistry.resolve('design')
             ◀── { participantId: 'pagelet:design:1', state: 'ready' }

   # 如果 design 还没启动：
   Chat ──RPC──▶ Shared.pageletRegistry.subscribe('design', callback)
             ◀── callback({ type: 'ready', participantId: 'pagelet:design:1' })
   ```

3. **Chat 直连 Design**：
   ```
   Chat ──orchestrator.connect('pagelet:chat:1', 'pagelet:design:1')──▶ direct channel
   Chat ──createRPCClient({ channel, servicePath: '/services/design' })──▶ designClient
   ```

4. **Design 崩溃**：
   - Shared 从 registry 移除（或标记 `state: 'down'`）
   - Chat 的 direct channel 触发 `TRANSIENT_FAILURE`
   - Design 重启后重新注册 → Chat 收到 subscribe 推送 → channel 自动 `onReconnected`

**Registry 接口草稿**：

```typescript
interface IPageletRegistry {
  register(info: {
    app: string
    participantId: string
    capabilities?: string[]
  }): void

  unregister(participantId: string): void

  resolve(app: string): Promise<{
    participantId: string
    state: 'ready' | 'starting' | 'down'
  } | null>

  subscribe(app: string, callback: (event: {
    type: 'ready' | 'down' | 'capabilities_changed'
    participantId: string
    capabilities?: string[]
  }) => void): Promise<() => void>
}
```

### 7.4 与 A-008 不变量的兼容性

| 不变量 | 影响 |
|--------|------|
| **I1** Renderer 只与一个 Pagelet 直连 | ✅ 不涉及。这是 Pagelet ↔ Pagelet，不是 Renderer |
| **I2** 每个 tab app 有独立 Pagelet | ✅ 不影响。直连是可选叠加 |
| **I4** 所有 IPC 经 orchestrator | ✅ 直连仍走 `orchestrator.connect()` |
| **I7** 进程崩溃后对端无需感知 | ✅ channel 自动 onReconnected；registry 更新 state |

**需要修改的约束**：

- A-008 §3.4 "Pagelet 之间不直接通信" → 改为 "Pagelet 之间默认不直连；高频场景可通过 Shared PageletRegistry 发现 + orchestrator.connect 建立可选直连"
- A-008 §3.4 "Pagelet 不持有其他 Pagelet 的 participantId" → 改为 "Pagelet 不硬编码其他 Pagelet 的 participantId；运行时通过 Shared PageletRegistry 动态获取"

### 7.5 何时使用哪种模式

| 场景 | 推荐模式 | 理由 |
|------|---------|------|
| 偶尔查询设计数据 | Shared 中转 | 简单、无需额外连接、Shared 常驻 |
| 实时 canvas 协同 | Shared 发现 + P2P 直连 | 低延迟、Shared 只做发现不做数据面 |
| Chat 引用 Design 画板截图 | Shared 中转 | 一次性操作，不值得维护直连 |
| 多 Pagelet 协同编辑同一文档 | Shared 发现 + P2P 直连 | 高频双向同步 |
| 全局状态同步（如登录态） | Shared 中转 | Shared 天然是全局状态中心 |

---

## 8. Participant 与 Service Path 速查

### 8.1 Participant ID 表

| Participant ID | 角色 | 进程类型 | 生命周期 |
|---------------|------|---------|---------|
| `renderer` | 主窗口渲染进程 | BrowserWindow | 应用启动到关闭 |
| `shared` | 全局单例业务服务 | UtilityProcess | 应用启动后立即创建 |
| `daemon` | 监控与策略决策 | UtilityProcess | 应用启动后立即创建 |
| `connection` | 连接面板 Pagelet | UtilityProcess | 应用启动后创建 |
| `design` | 设计 Pagelet | UtilityProcess | 用户激活或应用启动 |
| `chat` | 聊天 Pagelet | UtilityProcess | 用户激活或应用启动 |
| `monitor` | 监控 Pagelet | UtilityProcess | 用户激活或应用启动 |
| `setting` | 设置 Pagelet | UtilityProcess | 用户打开设置窗口 |

### 8.2 Service Path 表

| Service Path | 注册者 | 暴露给 | 说明 |
|-------------|--------|--------|------|
| `main-rpc` | Main | 所有 participant | 主进程心跳 |
| `main-window` | Main (renderer IPC) | Renderer | 窗口控制 |
| `main-metrics` | Main | 所有 participant | 进程 metrics 聚合 |
| `orchestrator` | Main (per-window) | Renderer | 连接面板控制 |
| `shared-rpc` | Shared | 连接的 Pagelet | 全局业务服务 |
| `daemon-rpc` | Daemon | 连接的 Pagelet | 监控与诊断 |
| `pagelet-api` | Connection Pagelet | Renderer | 连接面板业务 |
| `design-pagelet-api` | Design Pagelet | Renderer | 设计面板业务 |
| `chat-pagelet-api` | Chat Pagelet | Renderer | 聊天面板业务 |
| `monitor-pagelet-api` | Monitor Pagelet | Renderer | 监控面板业务 |
| `setting-pagelet-api` | Setting Pagelet | Renderer (setting window) | 设置面板业务 |

---

## 9. 关键源码映射

| 文件 | 职责 |
|------|------|
| `apps/telegraph/src/services/connection-orchestrator/electron-main/MainCpServer.ts` | IPC orchestrator 宿主 + renderer 注册 |
| `apps/telegraph/src/services/connection-orchestrator/electron-main/AppOrchestrator.ts` | Direct 连接管理 + orchestrator 控制面板服务 |
| `packages/services/pagelet-host/src/electron-main/PageletProcess.ts` | Pagelet spawn/kill/inspector |
| `packages/services/pagelet-host/src/node/PageletWorker.ts` | Pagelet Worker 基类（boot + shared/daemon 连接 + forwardingProxy） |
| `packages/services/pagelet-host/common/index.ts` | 所有 Participant ID + Service Path 常量 |
| `apps/telegraph/src/application/electron-browser/preload.ts` | Renderer bridge + serviceRoute 映射 |
| `apps/telegraph/src/application/browser/rpc-clients.ts` | Renderer 侧 RPC client 入口 |
| `apps/design/src/application/node/DesignPageletWorker.ts` | Design Worker 实现 |
| `apps/connection/src/application/node/ConnectionWorker.ts` | Connection Worker 实现（含 shared/daemon/main 调用示例） |
| `apps/shared/src/application/node/SharedWorker.ts` | Shared Worker 实现 |
| `apps/daemon/src/application/node/DaemonWorker.ts` | Daemon Worker 实现 |
