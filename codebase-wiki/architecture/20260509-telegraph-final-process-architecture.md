---
id: A-008
title: Telegraph 最终进程架构（Main · Shared · Daemon · Pagelet）
description: >
  在不背任何历史包袱的前提下，定义 Telegraph 桌面应用的目标态进程拓扑、
  通信模型、生命周期与重连语义。Renderer 只与 Pagelet 直连；Shared/Daemon/Main
  能力由 Pagelet 透明转发；Daemon 仅做监控，Main 做唯一的进程治理者；
  所有 channel 经由 x-oasis ConnectionOrchestrator 编排。
category: architecture
created: 2026-05-09
updated: 2026-05-15
tags:
  - architecture
  - process-topology
  - connection-orchestrator
  - forwarding-proxy
  - pagelet
  - shared-process
  - daemon-process
  - resilience
  - inspector
status: draft
references:
  - id: A-007
    rel: superseded-by
    file: ./20260506-pagelet-process-communication.md
  - id: D-005
    rel: extends
    file: ../discussion/20260508-renderer-pagelet-channel-convergence.md
  - id: D-006
    rel: extends
    file: ../discussion/20260508-x-oasis-orchestrator-capability-gaps.md
  - id: A-005
    rel: related-to
    file: ./20260505-telegraph-agent-runtime-extension-host-theory.md
  - id: P-003
    rel: related-to
    file: ../roadmap/20260508-port-management-orchestrator-migration-plan.md
  - id: A-010
    rel: related-to
    file: ./20260513-vscode-contribution-model-for-telegraph.md
  - id: D-007
    rel: related-to
    file: ../discussion/20260514-x-oasis-capability-gaps-v2.md
    note: D-007 §5 给出本文 §5（进程换链）/§6（Inspector）的 telegraph 侧改造清单与当前实施进度
  - id: D-009
    rel: extended-by
    file: ../discussion/20260515-renderer-spa-framework-selection.md
    note: D-009 在本文 §6 "Chat/Design 通过路由切换或 BrowserView 叠加" 的 hook 上确定 renderer 侧采用 React Router v7 + 自实现 PageletHost (KeepAlive)，并定义了与 §6 direct channel 的协作约定
---

# Telegraph 最终进程架构（Main · Shared · Daemon · Pagelet）

> 本文是 Telegraph 多进程架构的**目标态权威定义**，从零设计，不携带任何历史实现痕迹。
> 它替代 A-007 中"现状 + 改造记录"式的描述，作为后续所有实现、迁移、PR 的对齐基准。
>
> 历史推导请见：A-007（旧架构现状）、D-005（renderer 通道收敛决策）、
> D-006（x-oasis Orchestrator 能力缺口）、P-003（迁移路线）。
> 当前实施进度与 telegraph 侧改造清单：D-007 §5。

> **实施进度（截至 2026-05-14）**
>
> | 章节 | 进度 | 备注 |
> |------|------|------|
> | §3.3 治理分离（Main 治理 / Daemon 监控） | ✅ 已落地 | `apps/main` + `apps/daemon` 目录已分离 |
> | §4 ConnectionOrchestrator 编排 | ✅ 已落地 | `MainCpServer` + `AppOrchestrator`（已用 `createEventForwarder` + `ExponentialBackoffPolicy`） |
> | §5 进程换链（透明换链 + supervisor） | ⏳ 阻塞 | 等 x-oasis G1（D-004 RFC 已提案） |
> | §6 Inspector 数据模型 | ⏳ 阻塞 | 等 x-oasis G3 + `listParticipants()` 接入 |
> | §3.4 重连/熔断 | 🟡 部分 | reconnect ✅；circuitBreaker 阻塞于 x-oasis G2 dead-code（D-005） |

---

## 1. 设计目标与核心不变量

Telegraph 是一个 Electron 桌面应用，定位为**本地多 Agent / 多 Pagelet 工作台**。
最终架构必须同时满足以下不变量：

| # | 不变量 | 动机 |
|---|--------|------|
| **I1** | **Renderer 永远只与一个 Pagelet 直连** | 业务代码与后端拓扑解耦，单 channel 重连，单一故障域 |
| **I2** | **每个 tab app（chat/design/monitor/…）拥有独立的 Pagelet utility process** | 故障隔离；一个 app 卡死不能影响主应用 |
| **I3** | **Shared / Daemon 全局单例** | LoginService、AppInfo、MonitorService 等需要全局一致状态 |
| **I4** | **所有 IPC 必须经由 `@x-oasis/async-call-rpc-electron` 的 `ConnectionOrchestrator`** | 禁止裸用 `ipcMain` / `ipcRenderer` / `webContents.postMessage` / `MessagePortMain`。所有连接的注册、握手、心跳、重连、统计都收敛到一处 |
| **I5** | **Daemon 没有进程治理权** | Daemon 仅负责监测与告警；所有 spawn / kill / 重启决策都集中在 Main，避免 capability boundary 模糊 |
| **I6** | **Pagelet 是 Runtime / Extension Host 的天然边界** | A-005 定义的 `AgentRuntime` / `ToolDefinition` / `ExtensionManifest` 都跑在 Pagelet 内；Renderer 只消费 `RuntimeEvent` |
| **I7** | **进程崩溃后，已建联的对端无需感知** | Main 通过 `replaceParticipantChannel` 在保持 `participantId` 不变的前提下完成换链；上层只看到一次短暂的 `TRANSIENT_FAILURE → READY` 状态翻转 |

---

## 2. 全局拓扑

```
┌────────────────────────────────────────────────────────────────────────────┐
│                          electron-main process                              │
│                                                                             │
│  ┌──────────────────────┐    ┌────────────────────────────────────────┐    │
│  │   AppOrchestrator     │    │       ProcessSupervisor                 │    │
│  │ (extends Electron     │    │  • spawn / restart / kill (唯一)        │    │
│  │  ConnectionOrches-    │◀──▶│  • 消费 Daemon 上报的阈值告警            │    │
│  │  trator)              │    │  • 触发 replaceParticipantChannel       │    │
│  └──────────┬───────────┘    └────────────────────────────────────────┘    │
│             │                                                              │
│  ┌──────────┴───────────┐    ┌────────────────────────────────────────┐    │
│  │ MainServiceHost       │    │      WindowManager                      │    │
│  │  • 仅暴露窗口/系统能力│    │  • BrowserWindow + BrowserView 生命周期 │    │
│  │  • 通过 Pagelet 转发  │    └────────────────────────────────────────┘    │
│  └──────────────────────┘                                                  │
└──────────────┬─────────────────┬─────────────────┬─────────────────────────┘
               │                 │                 │
   register +  │                 │                 │
   activate    │                 │                 │
               ▼                 ▼                 ▼
   ┌───────────────────┐ ┌───────────────┐ ┌─────────────────────────────────┐
   │  shared process    │ │ daemon process│ │     pagelet processes            │
   │  (UtilityProcess)  │ │(UtilityProcess)│ │  (UtilityProcess × N)            │
   │  participant:      │ │ participant:  │ │  participant: pagelet:<app>:<n> │
   │   shared           │ │  daemon       │ │                                 │
   │                    │ │               │ │  ┌──────────────────────────┐    │
   │ • AppInfoService   │ │ • Resource    │ │  │ chat / design / monitor  │    │
   │ • LoginService     │ │   Watcher     │ │  │  Runtime + Extensions    │    │
   │ • SettingsService  │ │ • Diagnostics │ │  └──────────────────────────┘    │
   │ • SecretsService   │ │ • DumpService │ │                                 │
   │                    │ │ (告警→Main)   │ │  ForwardingProxy:                │
   │                    │ │               │ │   /services/shared → shared      │
   │                    │ │               │ │   /services/daemon → daemon      │
   │                    │ │               │ │   /services/main   → main        │
   └────────┬───────────┘ └───────┬───────┘ └────────────┬────────────────────┘
            │                     │                       │
            └─────────────────────┴───────────────────────┘
                              direct channels
                  (UtilityProcess ↔ UtilityProcess MessagePort)
                              │
                              │ direct channel
                              │ (renderer ↔ pagelet, MessagePortMain)
                              ▼
   ┌────────────────────────────────────────────────────────────────────────┐
   │                       BrowserWindow renderer                            │
   │   participant: renderer:<windowId>                                      │
   │                                                                        │
   │   ┌────────────────────────────────────────────────────────────────┐   │
   │   │  ChatPanel        DesignPanel       MonitorPanel    Sidebar    │   │
   │   │      │                │                 │                      │   │
   │   │      ▼                ▼                 ▼                      │   │
   │   │  client(/services/chat:pagelet)  ... client(/services/...)     │   │
   │   └────────────────────────────────────────────────────────────────┘   │
   └────────────────────────────────────────────────────────────────────────┘
```

### 进程清单（目标态）

| 进程 | 数量 | 类型 | 生命周期 | participantId |
|------|------|------|----------|----------------|
| **Main** | 1 | Electron main | 应用启动到退出 | *（不是 participant，是 orchestrator 宿主 + 路由器）* |
| **Shared** | 1 | UtilityProcess | 应用启动后立即创建 | `shared` |
| **Daemon** | 1 | UtilityProcess | 应用启动后立即创建 | `daemon` |
| **Pagelet** | N | UtilityProcess | 用户激活 tab app 时按需创建（lazy） | `pagelet:<appName>:<instanceId>`，例如 `pagelet:chat:1`、`pagelet:design:1` |
| **Renderer (主)** | 1 | BrowserWindow webContents | 主窗口创建时 | `renderer:main` |
| **Renderer (Monitor)** | 0 或 1 | 独立 BrowserWindow webContents | 用户打开 Monitor 窗口时 | `renderer:monitor` |

> **Main 不是 participant**：Main 进程承担 orchestrator + supervisor 职责。
> 它需要被其他进程"调用"的能力（窗口控制、文件系统等）通过 `MainServiceHost`
> 暴露在与每个 utility 的 control 通道上，而不是把 Main 注册成一个普通 participant。
> 这与 A-007 的"main 也是 participant"是关键区别。

---

## 3. 进程职责与 capability boundary

### 3.1 Main process — Orchestrator + Supervisor

**唯一职责清单**：

1. **进程治理（独占）**
   - spawn / restart / kill 所有 utility 与 renderer
   - 维护 process registry：`(participantId → process handle, restartCount, lastSpawnAt)`
   - 实现指数退避：单进程 1 分钟内重启 ≥ 5 次进入 cooldown，UI 显示降级

2. **Connection orchestration**
   - 持有唯一一个 `AppOrchestrator extends ElectronConnectionOrchestrator`
   - 注册所有 participant
   - 处理 `replaceParticipantChannel`（进程重启时的换链）
   - 暴露 `OrchestratorInspectorService`（拓扑/状态/统计查询）

3. **窗口管理**
   - `BrowserWindow` / `BrowserView` 创建与布局
   - 侧边栏面板切换（通过 `MainServiceHost` 提供 RPC，不再用 `ipcMain.handle`）

4. **系统能力出口**
   - 文件对话框、剪贴板、系统通知、deep link 等仅 main 才能访问的 API
   - 通过 `MainServiceHost` 服务化暴露

**禁止**：

- ❌ 不持有任何业务状态（聊天历史、登录态、设置）
- ❌ 不直接 require Pi / LangGraph / 任何 agent runtime 实现
- ❌ 不参与 renderer ↔ pagelet 的业务 RPC（不做任何 forwarding）

### 3.2 Shared process — 全局单例业务服务

**职责**：提供应用级、单例、轻量级的业务能力。

| 服务 | 说明 |
|------|------|
| `AppInfoService` | 版本号、build info、设备指纹 |
| `LoginService` | 登录态、token、用户档案 |
| `SettingsService` | 用户设置、主题、快捷键 |
| `SecretsService` | 凭证存储（OS keychain 封装） |
| `WorkspaceService` | 当前 workspace 元数据 |

**特性**：

- 启动顺序：Main 启动后 **第一个** 创建（Pagelet 启动需要它）
- 不直接被 Renderer 调用——所有访问都经 Pagelet ForwardingProxy
- 崩溃恢复：自身**无状态持久层**，状态都落盘（leveldb / file），重启后从盘加载

**禁止**：

- ❌ 不跑 Agent runtime（那是 Pagelet 的职责）
- ❌ 不跑长任务（那是 Daemon 的职责）

### 3.3 Daemon process — 监控与策略决策（无执行权）

**职责**：

| 服务 | 说明 |
|------|------|
| `ResourceWatcher` | 每 N 秒采集所有 utility 进程的 CPU / 内存 / handle 数 |
| `Diagnostics` | 性能快照（heap / event loop lag / GC） |
| `DumpService` | 崩溃时收集 minidump |
| `LogAggregator` | 汇总各进程结构化日志 |
| `KillPolicy` | 基于阈值/优先级/历史，**决策**哪些进程需要被 kill；通过 RPC 通知 Main 执行 |

**关键设计变更（vs A-007）—— 策略与执行分离**：

```diff
- Daemon 直接 utilityProcess.kill() 超阈值的进程
+ Daemon 持有策略：基于资源采样 + 阈值规则，判断「pagelet:chat:1 应被 kill，原因 OOM」
+ Daemon 通过 RPC 调用 main.processSupervisor.killParticipant({ id, reason, severity })
+ Main 的 ProcessSupervisor 是唯一执行者：调用 utilityProcess.kill()、决定是否重启、走 cooldown
```

**职责切分**：

| 角色 | Daemon（决策者） | Main（执行者） |
|------|------------------|----------------|
| 数据采集 | ✅ 持续采样 metrics | ❌ |
| 阈值判定 | ✅ KillPolicy 决策"该不该 kill" | ❌ |
| 实际 kill | ❌ 不持有 process handle | ✅ utilityProcess.kill() |
| 重启决策 | ❌ | ✅ ProcessSupervisor cooldown / 用户授权 |
| `replaceParticipantChannel` | ❌ | ✅ orchestrator 唯一入口 |

理由（capability boundary）：

- **Daemon 不持有 process handle**：物理上无法直接 kill 兄弟进程，避免误操作或被恶意 extension 间接利用
- **Main 不做策略**：Main 只对外暴露 `killParticipant(id, reason)` RPC，不内嵌阈值规则——策略可在 Daemon 内热更新而不需要重启 Main
- **审计闭环**：所有 kill 都经过 Main，Inspector 能完整记录 `who decided / when / why → who executed / outcome`

**Main 暴露给 Daemon 的 RPC（精确接口）**：

```typescript
interface IProcessSupervisorService {
  /** Daemon 唯一被授权调用的方法 */
  killParticipant(req: {
    id: string                              // 'pagelet:chat:1'
    reason: 'threshold:cpu' | 'threshold:memory' | 'threshold:handles' | 'unresponsive'
    severity: 'soft' | 'hard'               // soft = SIGTERM 允许 graceful；hard = SIGKILL
    metricSnapshot?: { metric: string; value: number; threshold: number }
  }): Promise<{ killed: boolean; willRestart: boolean; cooldownUntil?: number }>
}
```

Main 收到请求后**仍可拒绝**（例如该进程正在 cooldown / 用户刚交互过 / 有未保存数据），
返回 `{ killed: false, ... }` 让 Daemon 决定降级策略（如延长观察窗口）。

**特性**：

- 启动顺序：Main 启动后第二个创建（在 Shared 之后）
- 不被 Pagelet **默认**连接——Pagelet 只在需要 monitor 推送时按需 connect
- 自身崩溃恢复：Main 监听 daemon process exit → 立即 spawn 新 daemon → `replaceParticipantChannel('daemon', newChannel)` → 已连接的 Pagelet 透明感知到 `TRANSIENT_FAILURE → READY`

### 3.4 Pagelet process — Runtime / Extension Host 的载体

**职责**：

| 模块 | 说明 |
|------|------|
| `AgentRuntime` (A-005) | `PiAiRuntime` / `PiCliRuntime` / `LangGraphRuntime` 等 |
| `ExtensionHost` | 加载该 app 启用的 extension，注册 tools / hooks |
| `ToolRegistry` | 该 app 可见的工具集合 |
| `Domain Services` | app 自有的业务服务（chat: ConversationService；design: CanvasService；…） |
| `ForwardingProxy` | 把 `/services/shared`、`/services/daemon`、`/services/main` 透明转发给 Renderer |

**生命周期**：

- **Lazy spawn**：用户点击 sidebar 切到 `chat` 时，Main 才 spawn `pagelet:chat:1`
- **Eager bind shared**：spawn 完成后 orchestrator 自动 `connect(pagelet:chat:1, shared)`
- **Lazy bind daemon**：仅当 app 需要订阅 monitor 数据时 `connect(pagelet:chat:1, daemon)`
- **Renderer connect**：Renderer 主动 `connect(renderer:main, pagelet:chat:1)` 触发 direct channel 建联
- **Tab close 处理**：Pagelet 默认**保持运行**（保留对话状态、worktree 等）；只有用户显式 close app 或资源紧张时才 kill

**禁止**：

- ❌ Pagelet 之间不直接通信（避免拓扑爆炸）。需要协作时通过 Shared 中转或 Main 编排
- ❌ Pagelet 不持有其他 Pagelet 的 `participantId` 信息

### 3.5 Renderer

**职责**：纯展示与交互。

- 主 Renderer 渲染 Sidebar + HomePage + 所有 Panel UI（Chat/Design 通过路由切换或 BrowserView 叠加，由 WindowManager 决定）
- Monitor Renderer 渲染独立 Monitor 窗口

**通信约束（来自 D-005 决策）**：

- 每个 Renderer 同一时刻只持有它当前激活的 Pagelet 的一条 direct channel
- 切换 tab 时，可选策略：
  - **保留所有 channel**（适合 chat/design 都常驻）
  - **只保留当前 channel**（适合内存敏感场景）
- 业务代码通过 `servicePath` 区分调用目标，对底层进程拓扑无感：

```typescript
// renderer 业务代码示例
const shared = createRPCClient<ISharedService>({
  channel: pageletChannel,
  servicePath: '/services/shared',
})
await shared.appInfo.getVersion() // 透明经 pagelet 转发到 shared

const chat = createRPCClient<IChatService>({
  channel: pageletChannel,
  servicePath: '/services/chat',
})
await chat.send(message) // 直达 pagelet 内的 ChatService
```

---

## 4. 通信层：ConnectionOrchestrator + Forwarding Proxy

### 4.1 Channel 拓扑（最终态）

```
                            ┌──────── Main (orchestrator) ────────┐
                            │  control plane: __x_oasis_orches__   │
                            └──┬───────┬───────┬───────┬──────────┘
              control          │       │       │       │
            (utility ports)    │       │       │       │
                  ┌────────────┘       │       │       └─────────┐
                  ▼                    ▼       ▼                 ▼
              ┌────────┐           ┌────────┐ ┌────────┐    ┌─────────────┐
              │ shared │           │ daemon │ │pagelet │ ...│ pagelet:N    │
              └───┬────┘           └───┬────┘ └───┬────┘    └──────┬──────┘
                  │                    │          │                │
                  │ direct (P↔S)       │ direct   │ direct (P↔P)  │
                  └────────────────────┼──────────┤                │
                                       │ direct   │                │
                                       │ (P↔D, lazy)               │
                                       │          │                │
                                       │          │  direct (R↔P)  │
                                       │          ▼                ▼
                                       │     ┌──────────────────────────┐
                                       │     │  renderer:main           │
                                       │     │  renderer:monitor        │
                                       │     └──────────────────────────┘
                                       │
                                       │ direct (D↔P, lazy, only for monitor sub)
                                       └─────────────────────────────────
```

**两个平面**：

1. **Control plane**（蓝色）：每个 participant 与 Main 之间的 utility port，承载
   `__x_oasis_orchestrator__` service path（注册、心跳、connect 请求、状态推送）
2. **Direct channels**（业务）：通过 Main 中介建立的 P2P MessagePort，承载实际业务 RPC

### 4.2 Forwarding Proxy（D-005 方案 A 落地）

每个 Pagelet 启动时在 renderer-facing channel 上注册三个转发服务：

```typescript
// pagelet 内部启动序列
const sharedClient = await orchestrator.connect(myId, 'shared')
const mainClient   = await orchestrator.connect(myId, 'main')   // 通过 control plane

// daemon 是按需，初始化时不一定要建
let daemonClient: IDaemonService | null = null

// 等待 renderer 来建直连
orchestrator.onConnected({ peer: /^renderer:/ }, ({ channel }) => {
  exposeRemoteService({ channel, servicePath: '/services/shared', remoteClient: sharedClient })
  exposeRemoteService({ channel, servicePath: '/services/main',   remoteClient: mainClient })
  exposeRemoteService({
    channel,
    servicePath: '/services/daemon',
    remoteClient: () => {
      if (!daemonClient) daemonClient = await orchestrator.connect(myId, 'daemon')
      return daemonClient
    },
  })
  // 业务自有服务
  registerRPCService({ channel, servicePath: '/services/chat', service: chatServiceImpl })
})
```

**`exposeRemoteService` 工具**（最终位置：`packages/runtime-contracts` 或 x-oasis 上游）：

```typescript
export function exposeRemoteService<T extends object>(opts: {
  channel: RPCMessageChannel
  servicePath: string
  remoteClient: T | (() => Promise<T>)  // 支持懒加载
  interceptors?: { before?, after?, onError? }
}): Disposable
```

**好处汇总**：

- Renderer 业务**完全无感**于后端到底有几个进程
- Pagelet 是天然 BFF，可以加缓存、限流、降级、埋点
- 任意 Renderer 端故障都只影响该 Pagelet 自己
- ConnectionOrchestrator 的 participant 模型与 "Renderer 是 Pagelet 的前端" 完美对齐

### 4.3 RPC 调用约束（强制）

```typescript
// ❌ 禁止
ipcMain.handle('foo', ...)
ipcRenderer.invoke('foo', ...)
webContents.postMessage('bar', payload, [port])
utilityProcess.postMessage(...)

// ✅ 必须
const channel = orchestrator.getChannel(peerId)         // 已建联的直连
registerRPCService({ channel, servicePath, service })   // 暴露服务
const client = createRPCClient<IFoo>({ channel, servicePath }) // 调用服务
```

唯一例外：`AppOrchestrator` 内部用于建立 utility port 的最初一次 `parentPort.postMessage`，
那是 x-oasis 的实现细节，业务层不感知。

---

## 5. 进程治理与重连语义

### 5.1 进程崩溃 / 被 kill 的统一处理流

```
[Daemon ResourceWatcher]
     │ 检测到 pagelet:chat:1 内存超阈值
     ▼
[Daemon KillPolicy]
     │ 决策：该进程应被 kill（reason: threshold:memory, severity: soft）
     │ （考虑阈值规则、采样窗口、白名单、最近 kill 历史）
     ▼
[Daemon → Main RPC]
     │ main.processSupervisor.killParticipant({ id, reason, severity, metricSnapshot })
     ▼
[Main ProcessSupervisor]
     │ 校验：是否 cooldown 中 / 用户刚交互 / 有未保存数据
     │ 拒绝 → 返回 { killed: false }，Daemon 据此延长观察窗口
     │ 通过 → 执行 utilityProcess.kill(SIGTERM | SIGKILL)
     ▼
pagelet:chat:1 退出
     │
     │ Main 监听到 process exit 事件
     ▼
[Main ProcessSupervisor]
     │ 1. 决定是否重启（cooldown / max retry / 用户授权）
     │ 2. 如果重启：spawn 新 utility process
     │ 3. 等待新进程的 control port 到达
     │ 4. orchestrator.replaceParticipantChannel('pagelet:chat:1', newChannel)
     ▼
[AppOrchestrator]
     │ 对 'pagelet:chat:1' 持有的所有 connection 触发 TRANSIENT_FAILURE → CONNECTING
     │ 重新激活 direct channels：
     │   - pagelet:chat:1 ↔ shared
     │   - pagelet:chat:1 ↔ renderer:main
     │   - pagelet:chat:1 ↔ daemon (如有)
     ▼
[All peers]
     │ 收到 onReconnected 事件
     │ 业务层可选择 replay 未完成的 RPC（A-005 RuntimeEvent backpressure 策略）
     ▼
状态恢复：READY
```

### 5.2 Shared 崩溃

与 Pagelet 同流程。Shared 是无内存状态（持久层在盘上），重启后所有依赖它的 Pagelet
通过 `onReconnected` 重新拉取需要的状态（如 LoginState）。

### 5.3 Daemon 崩溃

Daemon 没有业务状态，重启代价最低。Pagelet 中订阅 Daemon 的服务（如 monitor 推送）
在 `onReconnected` 后自动重新订阅。

### 5.4 Main 崩溃

应用级失败，整个 Electron 进程退出。由 OS 级的 launcher / 用户重启应用。
**这是 Telegraph 不做容错的边界**——单点 Main 不可避免，但故障域控制到最小。

### 5.5 Renderer 崩溃 / reload

- Renderer 崩溃：Main 监听到，通常触发该 BrowserWindow 的重建（用户体验上的"白屏自愈"）
- Renderer reload（dev / Cmd-R）：control channel 断开 → orchestrator `handleParticipantLost('renderer:main')`
  → 新 renderer 加载完成后重新 register → orchestrator 自动重建 connection

### 5.6 必须的 x-oasis 能力（D-006）

| 能力 | 状态 | 说明 |
|------|------|------|
| `replaceParticipantChannel(id, channel)` | 🔴 P0，缺失 | §5.1 的核心；不能用 unregister + register 替代（会丢失统计/订阅/重连历史） |
| `activateTimeoutMs` 首连超时 | ✅ 已落地（D-006 Gap 2） | utility cold start > 5s 时不再死锁 |
| channel 断开自动 `handleParticipantLost` | ✅ 已落地（D-006 Gap 3） | 进程被 OS kill 时无需业务侧手动通知 |
| `listConnections` / `listParticipants` | 🟡 P1 | Inspector 需要，可先在 `AppOrchestrator` 包装层实现 |

---

## 6. Inspector — 可视化的拓扑诊断

### 6.1 设计原则

- **平台能力**：Inspector 是 Telegraph 平台级特性，**所有 Pagelet 都自带**
  （chat / design / monitor 都能看自己的 connection 状态）
- **数据源唯一**：`OrchestratorInspectorService` 由 Main 暴露，Pagelet 通过
  `/services/main` ForwardingProxy 间接访问
- **下钻能力**：能从某个 connection 钻到该 connection 上跑过的 RPC 调用历史（最近 N 条）

### 6.2 Inspector 数据模型

```typescript
interface InspectorSnapshot {
  participants: Array<{
    id: string                 // 'pagelet:chat:1'
    role: 'shared' | 'daemon' | 'pagelet' | 'renderer'
    pid?: number               // utility process pid（renderer 没有）
    registeredAt: number
    restartCount: number       // ProcessSupervisor 维护
    lastRestartReason?: string // 'crash' | 'oom' | 'manual' | 'threshold:cpu'
    metrics?: {                // Daemon ResourceWatcher 提供
      cpu: number
      memoryMB: number
      handles: number
    }
  }>

  connections: Array<{
    a: string                  // participantId
    b: string                  // participantId
    state: 'IDLE' | 'CONNECTING' | 'READY' | 'TRANSIENT_FAILURE' | 'DISCONNECTING' | 'CLOSED'
    establishedAt?: number
    lastReconnectAt?: number
    reconnectCount: number
    stats: {
      rpcCallsTotal: number
      rpcCallsInflight: number
      bytesIn: number
      bytesOut: number
      lastError?: string
    }
  }>

  recentEvents: Array<{
    ts: number
    type: 'state_change' | 'reconnected' | 'reconnect_failed' | 'replaced'
    payload: unknown
  }>
}
```

### 6.3 UI（每个 Pagelet 内置）

```
┌─ Connections Inspector ─────────────────────────────────────────┐
│  Participant: pagelet:design:1     pid=12345  restarts=0       │
│  Metrics: CPU 2.1%   Mem 142 MB   Handles 38                    │
│                                                                 │
│  Outgoing connections:                                          │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ → shared            READY     ↑ 1.2k calls  ↓ 0 inflight │    │
│  │ → main              READY     ↑ 12 calls    ↓ 0 inflight │    │
│  │ → daemon            IDLE      (not connected)           │    │
│  │ ← renderer:main     READY     ↑ 47 calls    ↓ 1 inflight │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  [Click a row to drill into recent RPCs]                        │
│                                                                 │
│  Recent events:                                                 │
│   2026-05-09 14:23:01  reconnected  shared (cause: pid changed) │
│   2026-05-09 14:22:58  state_change shared TRANSIENT → READY    │
└─────────────────────────────────────────────────────────────────┘
```

下钻视图展示该 connection 上最近 N 条 RPC 的 servicePath / method / 耗时 / payload size，
便于排障——尤其是 D-005 forwarding proxy 加了一跳后的延迟分布。

---

## 7. App / 代码组织（目标态）

### 7.1 目录拓扑

```
apps/
  telegraph/                  # main 进程 + 主 renderer 容器 + preload
    src/
      application/            # main 入口、AppOrchestrator、ProcessSupervisor、WindowManager
      preload/                # contextBridge → window.telegraph.{ipc, mainChannel}
      renderer/               # 主 renderer：Sidebar、HomePage、Panel 路由
      services/
        connection-orchestrator/    # AppOrchestrator + Inspector + ForwardingProxy 工具
        process-supervisor/         # spawn / restart / cooldown
        window-manager/             # BrowserWindow / BrowserView 管理
        main-host/                  # MainServiceHost（窗口/系统能力）

  shared/                     # shared utility process
    src/
      main.ts                 # utility 入口
      services/{app-info,login,settings,secrets,workspace}/

  daemon/                     # daemon utility process
    src/
      main.ts
      services/{resource-watcher,diagnostics,dump,log-aggregator,threshold-alerter}/

  chat/                       # chat pagelet
    src/
      main.ts                 # utility 入口
      application/
        node/                 # PageletBootstrap、ForwardingProxy 注册、AgentRuntime 启动
        browser/              # ChatPanel UI（被 telegraph 主 renderer bundle 集成）
      services/               # ConversationService、HistoryService、…

  design/                     # design pagelet（同结构）
  monitor/                    # monitor pagelet（同结构）
                              # 注：monitor 在独立 BrowserWindow 中渲染，但 pagelet 进程结构与其他 app 一致

packages/
  runtime-contracts/          # A-005 的 RunInput / RuntimeEvent / ToolDefinition / ExtensionManifest
  connection-helpers/         # exposeRemoteService、Inspector 客户端、forwarding utilities
                              # （成熟后可上提 x-oasis）
  ui/                         # 共享 React 组件（按 pagelet 拆子目录）
```

### 7.2 各 app 的 build 策略

- 由 `apps/telegraph` 的 `forge.config.ts` 统一编排
- 每个 pagelet 输出两份产物：
  1. **utility entry**（`<pagelet>/src/main.ts` → `.vite/build/<pagelet>.cjs`）—— UtilityProcess 加载
  2. **browser bundle**（`<pagelet>/src/application/browser/index.tsx` → 被 telegraph 主 renderer 的 vite.renderer 配置 import）—— 集成进主 renderer

### 7.3 Path alias 约定

| 别名 | 解析到 | 用途 |
|------|--------|------|
| `@telegraph/*` | `apps/telegraph/src/*` | Main 进程内部 |
| `@shared/*` | `apps/shared/src/*` | shared utility 内部 + 类型给其他进程 import |
| `@daemon/*` | `apps/daemon/src/*` | 同上 |
| `@chat/*` | `apps/chat/src/*` | 同上 |
| `@design/*` | `apps/design/src/*` | 同上 |
| `@monitor/*` | `apps/monitor/src/*` | 同上 |
| `@telegraph/contracts` | `packages/runtime-contracts/src` | 跨进程类型契约 |
| `@telegraph/connection-helpers` | `packages/connection-helpers/src` | Inspector / ForwardingProxy 工具 |

跨 app 的 import **仅允许 type-only**（`import type ...`）+ 通过 RPC servicePath 调用，
绝不允许 value import 跨 utility 边界（防止误打包）。

---

## 8. Runtime / Extension Host 分层（A-005 在本架构中的位置）

```
┌──────────────────────────────────────────────────────────────────┐
│   Renderer (主 + monitor)                                         │
│   • UI: ChatPanel / DesignPanel / MonitorPanel / TracePanel      │
│   • 消费 RuntimeEvent（来自 Pagelet 的 /services/<app>）          │
└─────────────────────────────────┬────────────────────────────────┘
                                  │ direct channel
                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│   Pagelet (chat/design/monitor)                                  │
│   ┌──────────────────────────────────────────────────────────┐    │
│   │  Domain Service Layer                                    │    │
│   │   ConversationService / CanvasService / MonitorService   │    │
│   └──────────────────────────────────────────────────────────┘    │
│   ┌──────────────────────────────────────────────────────────┐    │
│   │  Runtime Layer (A-005)                                   │    │
│   │   AgentRuntime（PiAi / PiCli / PiEmbedded / LangGraph…） │    │
│   └──────────────────────────────────────────────────────────┘    │
│   ┌──────────────────────────────────────────────────────────┐    │
│   │  Extension Host (A-005)                                  │    │
│   │   ToolRegistry / HookBus / Permissions / ExtensionLoader │    │
│   └──────────────────────────────────────────────────────────┘    │
│   ┌──────────────────────────────────────────────────────────┐    │
│   │  ForwardingProxy + RPC infra (本文 §4)                   │    │
│   │   /services/shared → shared                              │    │
│   │   /services/daemon → daemon                              │    │
│   │   /services/main   → main                                │    │
│   └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

**关键关系**：

- **进程拓扑是底座**（本文 §1-§6）
- **Runtime/Extension 是租户**（A-005）：每个 Pagelet 内自带一份 ToolRegistry / HookBus，
  扩展安装后通过 ExtensionHost 注册到该 Pagelet
- **跨 Pagelet 共享的 extension 状态**（如全局 token）放 Shared
- **跨 Pagelet 监控的 extension 行为**（如 tool 调用次数统计）走 Daemon

A-005 的细节在本文不展开，本文仅承诺：Pagelet 进程边界 = Runtime/Extension Host 边界。

---

## 9. 验证策略

### 9.1 design pagelet 作为标杆样本

按 P-003 路线，design 是第一个完整跑通本架构的 app。验收物：

1. **Connections Inspector** 在 design panel 内可见
2. 点击 design panel → 显示：`renderer:main ↔ pagelet:design:1` READY
3. 调用 `shared.appInfo.getVersion()`（通过 forwarding proxy）成功返回
4. 手动 kill design utility process → Inspector 显示 TRANSIENT_FAILURE → READY，调用恢复
5. 故意让 design 的 Domain Service 抛异常 → 不影响 chat / monitor

### 9.2 故障注入用例（CI 必跑）

| 场景 | 期望行为 |
|------|----------|
| `kill -9 pagelet:chat:1` | Main 重启进程；renderer 无 user-visible 错误（≤ 2s） |
| `kill -9 shared` | Shared 重启；所有 Pagelet 的 `/services/shared` 调用在 ≤ 3s 内恢复 |
| `kill -9 daemon` | Daemon 重启；订阅了 monitor 的 Pagelet 自动重新订阅 |
| Pagelet 1 分钟内崩溃 6 次 | ProcessSupervisor 进入 cooldown；UI 显示降级提示 |
| Renderer Cmd-R | Pagelet 不重启；renderer 重新建联后业务可用 |
| Daemon 上报 chat 内存超阈值 | Main 决策 kill chat → 重启 → renderer 重连，对话历史从盘恢复 |

### 9.3 可观测性指标（SLO）

| 指标 | 目标 |
|------|------|
| Pagelet cold spawn → READY 时间 | P50 < 800ms, P95 < 2s |
| Forwarding proxy 单跳额外延迟 | P95 < 3ms（同机 IPC） |
| 进程崩溃后重连完成时间 | P95 < 1.5s |
| Inspector 拓扑刷新延迟 | < 500ms |
| RPC 调用丢失率（重连期间） | 0（关键调用必须 retry，非关键可降级） |

---

## 10. 与历史文档的关系

| 文档 | 关系 | 说明 |
|------|------|------|
| **A-007** | superseded-by 本文 | A-007 描述的是改造期的现状 + 踩坑记录；本文是目标态。A-007 仍有价值作为"不要回头"的参考 |
| **D-005** | 落地于本文 §4.2 | Forwarding Proxy 决策的最终归宿 |
| **D-006** | 依赖项追踪 | 本文 §5.6 列出 x-oasis 必须能力，与 D-006 一一对应 |
| **A-005** | 在本文 §8 占位 | Runtime/Extension 层跑在 Pagelet 内；本文不展开 |
| **P-003** | 实施路径 | 本文是 P-003 的目标态定义；P-003 是分阶段路线 |
| **A-002** | 旧版多进程拓扑 | 概念被本文吸收；旧文不再维护 |

---

## 11. 开放问题

以下问题留待实施过程中决策，本文不预设答案：

1. **Pagelet 之间 0 直连是否绝对**？例如 chat 想引用 design 的画板内容，是走 Shared 中转还是允许临时 P2P channel？倾向：先 Shared 中转，性能不够再放开。
2. **Pagelet 销毁策略**：tab close 是否立即 kill utility？倾向：不 kill，保留状态；只有内存压力大时由 Daemon 告警 + Main 决策。
3. **多 Renderer 窗口扩展**（如未来支持 popup chat）：当前 Inspector 模型已支持任意数量 `renderer:*` participant，无需改动。
4. **Forwarding proxy 的 streaming RPC 性能**（如 Chat token stream）：单跳序列化开销待 Phase 5 实测，必要时在 channel 上对特定 servicePath 启用 transferable ArrayBuffer。
5. **Inspector 的权限**：是否所有 Pagelet 都能看到所有 participant 的 metrics？倾向：能看到拓扑，但 metrics 详情需 dev 模式或显式权限。

---

## 附录 A：关键 API 速览

### A.1 Main 侧 — AppOrchestrator

```typescript
class AppOrchestrator extends ElectronConnectionOrchestrator {
  // x-oasis 内置
  registerParticipant(id, channel, role): void
  connect(a, b, options?: ConnectOptions): Promise<Connection>
  replaceParticipantChannel(id, channel): Promise<void>  // ⚠️ x-oasis Gap 1，待补
  handleParticipantLost(id, reason): void
  onStateChange(callback): Disposable

  // Telegraph 扩展
  spawnPagelet(appName: string): Promise<{ id: string }>
  killParticipant(id: string, reason: string): Promise<void>
  getInspectorSnapshot(): InspectorSnapshot
}
```

### A.2 Pagelet 侧 — PageletBootstrap

```typescript
class PageletBootstrap {
  async start() {
    const orch = await connectToMainOrchestrator()  // 通过 parentPort
    const myId = orch.getMyParticipantId()

    // eager bind
    this.shared = await orch.connect(myId, 'shared')
    this.main   = await orch.connect(myId, 'main')

    // lazy bind
    this.daemon = lazy(() => orch.connect(myId, 'daemon'))

    // domain services
    this.chatService = new ChatService({ shared: this.shared, runtime: this.runtime })

    // 等 renderer 来连
    orch.onConnected({ peerMatch: /^renderer:/ }, ({ channel }) => {
      this.exposeForwardingProxies(channel)
      registerRPCService({ channel, servicePath: '/services/chat', service: this.chatService })
    })
  }

  private exposeForwardingProxies(channel: RPCMessageChannel) {
    exposeRemoteService({ channel, servicePath: '/services/shared', remoteClient: this.shared })
    exposeRemoteService({ channel, servicePath: '/services/main',   remoteClient: this.main })
    exposeRemoteService({
      channel,
      servicePath: '/services/daemon',
      remoteClient: () => this.daemon(), // 懒加载
    })
  }
}
```

### A.3 Renderer 侧 — 业务调用

```typescript
// renderer/services/chat-client.ts
import type { IChatService }  from '@chat/services/chat-service'
import type { ISharedService } from '@shared/services/shared-service'

export function makeClients(channel: RPCMessageChannel) {
  return {
    chat:   createRPCClient<IChatService>({ channel, servicePath: '/services/chat' }),
    shared: createRPCClient<ISharedService>({ channel, servicePath: '/services/shared' }),
  }
}

// 业务代码完全无感知 chat / shared 跑在不同进程
const { chat, shared } = makeClients(pageletChannel)
const version = await shared.appInfo.getVersion()
await chat.sendMessage({ text: 'hello' })
```
