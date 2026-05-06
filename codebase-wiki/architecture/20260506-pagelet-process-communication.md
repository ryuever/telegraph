---
id: A-007
title: Pagelet Process 通信架构与 Daemon 直连
description: 详解 pagelet process 如何通过 MessagePort 与 daemon/shared/electron-main 建立直连通道，包含端口获取、Resume 机制、Monitor 数据流与新增 pagelet 功能的开发指南。
category: architecture
created: 2026-05-06
updated: 2026-05-06
tags: [pagelet, daemon, MessagePort, IPC, resume, monitor]
status: draft
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

Telegraph 的每个 UI 功能面板（Monitor、Chat 等）可拥有独立的 **pagelet process**（Node.js `UtilityProcess`），用于在独立进程中执行计算密集或需要隔离的逻辑。pagelet process 通过 `MessagePort` 与其他进程建立直连通道，避免所有通信都经过 electron-main 中转。

### 进程连接拓扑

```
renderer (PageletClientChannel)
    ├── acquirePort()        → shared-process
    ├── acquireDaemonPort()  → daemon-process
    └── IPC (webContents)    → electron-main

pagelet-process (ProcessClientChannel)
    ├── acquirePort()        → shared-process
    └── acquireDaemonPort()  → daemon-process   ← 本次新增

electron-main
    ├── AcquirePortMain      → 为 renderer 中介 MessagePort
    └── AcquireProcessPortMain → 为 UtilityProcess 中介 MessagePort
```

## 2. 端口获取机制

### 2.1 Renderer 端 — PageletClientChannel

位置：`apps/telegraph/src/services/port-manager/browser/PageletClientChannel.ts`

renderer 进程通过 preload bridge 向 electron-main 请求 MessagePort：

```typescript
// 获取 shared-process 端口
await this.portManager.acquirePort();

// 获取 daemon-process 端口（第133行）
await this.portManager.acquireDaemonPort();
```

底层调用 `window.telegraph.ipcRenderer.invoke('acquirePort', ...)` 或 `invoke('acquireDaemonPort', ...)`，electron-main 收到后创建 `MessageChannelPair`，将一端通过 `webContents.postMessage` 传回 renderer，另一端通过 `UtilityProcess.postMessage` 传给目标进程。

### 2.2 Node 端 — ProcessClientChannel

位置：`apps/telegraph/src/services/port-manager/node/ProcessClientChannel.ts`

pagelet process（UtilityProcess）通过 `parentPort` 与 electron-main 通信：

```typescript
// 获取 shared-process 端口
await this.portManager.acquirePort();

// 获取 daemon-process 端口（第150行）
await this.portManager.acquireDaemonPort();
```

底层通过 `parentPort.postMessage` 发送请求，electron-main 的 `AcquireProcessPortMain` 监听该消息并中介端口分配。

### 2.3 Electron-Main 端口中介

| 中介类 | 文件 | 服务对象 |
|--------|------|----------|
| `AcquirePortMain` | `services/port-manager/electron-main/AcquirePortMain.ts` | renderer（BrowserWindow） |
| `AcquireProcessPortMain` | `services/port-manager/electron-main/AcquireProcessPortMain.ts` | UtilityProcess（pagelet/shared/daemon） |

中介流程：
1. 收到端口请求 → 解析 `connectId`（包含源进程 ID 和目标进程类型）
2. 创建 `MessageChannelPair`（`services/port-manager/common/MessageChannelPair.ts`）
3. 将 port1 传给请求方，port2 传给目标进程
4. 在 `PortManager` 中记录连接对，用于后续 resume

### 2.4 connectId 格式

位置：`apps/telegraph/src/services/port-manager/common/connectId.ts`

`connectId` 编码了连接的源和目标信息，格式为 `{sourceProcessId}:{targetType}`，用于 electron-main 路由端口请求到正确的目标进程。

## 3. Pagelet → Daemon 直连（本次新增）

### 3.1 变更动机

之前 pagelet process 只连接 shared-process，需要 daemon 服务时要经过 shared 中转。新增直连后，pagelet 可直接调用 daemon 上的 RPC 服务（如 `MonitorBridgeClient`），减少一跳延迟。

### 3.2 关键变更

**PageletProcessNode.ts**（`services/process/pagelet-process/node/PageletProcessNode.ts:51`）：

```typescript
// 启动时自动连接 daemon
this.portManager.acquireDaemonPort();
```

**PageletProcessModule.ts**（`services/process/pagelet-process/node/PageletProcessModule.ts:55`）：

```typescript
// 将 MonitorBridgeClient 绑定到 daemonProcessChannelProtocol
// 通过 ProxyRPCClient 创建代理，调用会自动路由到 daemon 进程
```

**PageletProcess.ts**（electron-main 端）：

```typescript
// 新增 handleProcessDisposed() — 清理崩溃进程的端口资源
// 新增 handleResumeConnection() — 重建 pagelet → daemon 连接
// 私有 _createUtilityProcess() — 提取进程创建逻辑，复用于 resume
```

## 4. Resume（断线重连）机制

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
    → 清理旧端口记录
    → _createUtilityProcess() 重新创建进程
    → 新进程启动后自动执行 acquirePort() + acquireDaemonPort()
```

## 5. Monitor 数据流（端到端）

Monitor 面板展示系统性能数据，其数据流跨越多个进程：

```
daemon-process                    electron-main              renderer
┌─────────────┐                  ┌──────────────┐           ┌──────────────┐
│ Diagnostics  │  RPC pushSnapshot │ MonitorBridge │  IPC send  │ MonitorPanel │
│ (每5秒 tick) │ ──────────────→ │              │ ────────→ │ (hooks.ts)   │
└─────────────┘                  └──────────────┘           └──────────────┘
```

1. **数据源**：`Diagnostics`（`services/diagnostics/node/Diagnostics.ts`）在 daemon-process 中每 5 秒收集一次快照（CPU、内存、进程树等）
2. **RPC 推送**：通过 `MonitorBridgeClient.pushSnapshot()` 调用 electron-main 的 `MonitorBridge`
3. **IPC 分发**：`MonitorBridge`（`services/monitor/electron-main/MonitorBridge.ts`）通过 `webContents.send()` 将快照推送到所有注册的 renderer 窗口
4. **UI 渲染**：renderer 中 `hooks.ts` 监听 IPC 事件，更新 React state，驱动 `MonitorPanel` / `ProcessesTable` / `Sparkline` 等组件

### Monitor 独立窗口

Monitor 可在独立窗口中打开（Toggle Monitor），此时：

- `index.tsx` 中的 `getRendererProcessId()` 从 URL hash 参数提取 `TELEGRAPH_PAGELET_RENDERER_PROCESS_ID`
- 当 `appId === 'monitor-window-app'` 时，`Root` 组件只渲染 `MonitorPanel`，不包含主 app 的 Sidebar

## 6. 新增 Pagelet 功能开发指南

当需要为新 UI 面板创建独立 pagelet process 时，按以下步骤操作：

### 6.1 创建 pagelet 模块

```
services/process/pagelet-process/
├── node/
│   ├── YourFeatureProcessNode.ts    # 继承/参考 PageletProcessNode
│   └── YourFeatureProcessModule.ts  # DI 模块，绑定所需服务
├── electron-main/
│   └── YourFeatureProcess.ts        # 进程生命周期管理
└── common/
    └── types.ts                     # 共享类型
```

### 6.2 连接配置清单

| 步骤 | 文件 | 操作 |
|------|------|------|
| 1 | `ProcessNode.ts` | 调用 `acquirePort()` 和/或 `acquireDaemonPort()` |
| 2 | `ProcessModule.ts` | 绑定需要的 RPC 客户端到对应 channel protocol |
| 3 | `Process.ts`（electron-main） | 实现 `handleProcessDisposed()` 和 `handleResumeConnection()` |
| 4 | `AssignPassingPortType` 枚举 | 如需新端口类型，在 `services/process/common/types/index.ts` 中添加 |
| 5 | `telegraph-application-module.ts` | 注册新进程到主 DI 模块 |

### 6.3 注意事项

- **端口回收**：进程退出时必须清理 `PortManager` 中的连接记录，避免内存泄漏
- **心跳检测**：参考 `ProcessPingClient`/`ProcessPingMain` 实现进程存活检测
- **错误隔离**：pagelet 崩溃不应影响其他 pagelet 或主进程
- **UI 组件**：新增 renderer 视图放在 `packages/ui/src/components/` 下，从 `apps/telegraph/src/index.tsx` 路由

## 7. 关键文件速查

| 职责 | 文件路径 |
|------|----------|
| Renderer 端口管理 | `services/port-manager/browser/PageletClientChannel.ts` |
| Node 端口管理 | `services/port-manager/node/ProcessClientChannel.ts` |
| Renderer 端口中介 | `services/port-manager/electron-main/AcquirePortMain.ts` |
| Process 端口中介 | `services/port-manager/electron-main/AcquireProcessPortMain.ts` |
| 连接对抽象 | `services/port-manager/common/MessageChannelPair.ts` |
| connectId 编解码 | `services/port-manager/common/connectId.ts` |
| Pagelet 进程 Node 端 | `services/process/pagelet-process/node/PageletProcessNode.ts` |
| Pagelet 进程 DI 模块 | `services/process/pagelet-process/node/PageletProcessModule.ts` |
| Pagelet 进程管理 | `services/process/pagelet-process/electron-main/PageletProcess.ts` |
| Daemon 进程管理 | `services/process/daemon-process/electron-main/DaemonProcessMain.ts` |
| Monitor 数据桥接 | `services/monitor/electron-main/MonitorBridge.ts` |
| 性能诊断数据源 | `services/diagnostics/node/Diagnostics.ts` |
| Renderer 入口 | `apps/telegraph/src/index.tsx` |

> 所有路径相对于 `apps/telegraph/src/`，除非另有说明。
