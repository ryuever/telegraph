---
id: D-008
title: apps/ 框架层短板审查（D-007 类别 A 落地后视角）
description: >
  在 D-007 类别 A "x-oasis 已就绪能力" 接入 + supervisor 化批量改造完成之后，
  对 telegraph apps/ + packages/services/ 框架层重新做一次盘点，明确哪些能力
  已经稳固落地、哪些短板可以立即在 telegraph 侧动手、哪些必须等 x-oasis 上游。
  作为后续改造的优先级依据。
category: discussion
created: 2026-05-15
updated: 2026-05-15
tags: [framework, apps, supervisor, x-oasis, gap-review, telegraph, refactor-plan]
status: draft
references:
  - id: D-007
    rel: extends
    file: ./20260514-x-oasis-capability-gaps-v2.md
    note: 本文是 D-007 类别 A 落地后的"telegraph 侧改造清单"具体化版本
  - id: A-008
    rel: related-to
    file: ../architecture/20260509-telegraph-final-process-architecture.md
    note: §5/§6/I7 给出"透明换链"和"ForwardingProxy"目标态，是 H1/H2 短板的依据
  - id: roadmap-supervisor-next-steps
    rel: related-to
    file: ../roadmap/20260514-x-oasis-supervisor-next-steps.md
    note: roadmap §1 列出已完成清单，本文盘点剩余短板
---

## 0. 背景

D-007 把 x-oasis 能力分成两类：

- **类别 A**："已就绪未使用"——`ExponentialBackoffPolicy` / `retryOnInitialFailure` / `createEventForwarder`，外加 supervisor 化（`startSupervised`）。
- **类别 B**："上游真实缺失"——`replaceParticipantChannel` 实战路径、CircuitBreaker 接入 RPC 调用栈、跨进程 `ConnectionConfig` 序列化等。

类别 A 已经在 [supervisor next-steps roadmap](../roadmap/20260514-x-oasis-supervisor-next-steps.md) §1 跟进的几次 commit 里全部落地。本文从**当前实现**重新看一次 framework 层，回答两个问题：

1. 哪些 D-007 提到的"telegraph 侧改造"已经做了？
2. 还剩哪些短板，按 ROI 怎么排？

## 1. 已稳固落地的能力（不再展开）

| # | 能力 | 验证方式 |
|---|------|---------|
| 1 | DI 单根容器 + 12 组件统一注入 | `apps/main/src/application/electron-main/AppApplicationModule.ts` |
| 2 | 五个 pagelet (`design/connection/monitor/setting/chat`) 统一 `Application → spawn → connect` 模式 | `apps/{...}/src/application/electron-main/*Application.ts` |
| 3 | **Red lines 全绿**：apps/ + packages/services/ 内 `ipcMain.* / ipcRenderer.* / webContents.send|postMessage / parentPort.postMessage` 命中数 = 0 | `rg "ipcMain\.\|ipcRenderer\.\|webContents\.(send\|postMessage)" apps/ packages/services/` |
| 4 | `ExponentialBackoffPolicy` + `retryOnInitialFailure: true` 全量接入 supervisor 与 connect | 各 `*Application.ts` 与 `MainCpServer` |
| 5 | `createEventForwarder` 用于 `AppOrchestrator.registerScopedOrchestratorService()`，把 main/setting 两套 7 类事件转发的 ~210 行重复收敛到 ~60 行 | `packages/services/src/pagelet-host/src/electron-main/AppOrchestrator.ts` |
| 6 | Supervisor inspector 链路完整：`MainMetricsService` 提供 push (`onSupervisorSnapshotsChanged`) + pull (`getSupervisorSnapshots`) 双通道；`MonitorPageletWorker` 两条 channel 都做了 `onDidConnected` re-subscribe，daemon `kill -9` 后仍能告诉 UI "restarting" | `packages/services/src/main-metrics/src/electron-main/MainMetricsService.ts`、`apps/monitor/src/application/node/MonitorPageletWorker.ts` |
| 7 | `MainCpServer.getAdditionalOrchestratorsFor(pageletId)` 把 setting 双 orchestrator 知识从 `PageletProcess` 拉回到 `MainCpServer` | `apps/main/src/application/electron-main/MainCpServer.ts` |

## 2. 显著短板（按 ROI 排序）

### 🔴 H1 — `replaceParticipantChannel` + `setKillOnDisconnect(false)` 全仓 0 处真实调用

**现象**

```bash
$ rg "replaceParticipantChannel|setKillOnDisconnect" apps/ packages/services/
# 0 matches
```

**影响**

supervisor restart 走的还是 spawn-mode（销毁旧 channel → 新 channel 重新 register）：

- 连接统计每次重启都重置；
- 订阅每次重启都需要业务侧手动 re-subscribe（目前只有 Monitor 做了，其他 pagelet 大概率有 bug）；
- 不是 A-008 §5 / I7 要求的"透明换链"。

**前置依赖**

D-007 G1：x-oasis supervisor `restart()` 走 `bindPort({rebind: true}) + replaceParticipantChannel`。需要先 grep 确认 x-oasis 上游是否已经合入。

### 🔴 H2 — Forwarding proxy / 熔断完全业务侧手抄，且无超时

**现象 1（重复 + 无熔断）**：`apps/connection/src/application/node/ConnectionWorker.ts` 与 `apps/setting/src/application/node/SettingWorker.ts` 各有 ~6 行：

```ts
const sharedReady = this.sharedClient ? Promise.resolve() : Promise.resolve('shared not ready');
const daemonReady = this.daemonClient ? Promise.resolve() : Promise.resolve('daemon not ready');
```

D-007 G2 已经标记：`CircuitBreaker` 在 x-oasis 是空壳，没接入 RPC 调用栈。

**现象 2（boot 永挂）**：`PageletWorker.boot()` 串行 `await proxy.connect('shared')` + `await proxy.connect('daemon')` 没有超时。daemon 没起来 / supervisor 还在 restart，pagelet 永挂、UI 永远拿不到事件。

**影响**

- 业务侧每个 pagelet 重复 6 行模板代码；
- pagelet boot 时机依赖 daemon ready，单点故障传染整个 UI；
- 没有任何"快速失败 + 后台重连"的语义。

**ROI**：高。前者 ~40 行就能抽掉；后者加 5 行 `Promise.race(connect, timeout)` 即可。

### 🔴 H3 — RPC service path 上 ~25 处 `any` / `as any`

**现象**

```ts
// apps/daemon/src/diagnostics/common/types.ts
onPerformanceUpdate(callback: (snapshot: any) => void): () => void;
```

```ts
// packages/services/src/pagelet-host/src/node/PageletWorker.ts
protected sharedClient: any = null;
protected daemonClient: any = null;
```

**影响**

- 类型化 RPC 是 telegraph 选用 x-oasis 的核心理由之一，这里却把类型擦除了；
- IDE 跳转跨进程失效，refactor 时容易漏改。

**ROI**：高。`PageletWorker` 加泛型参数 + `IDaemonService.PerformanceSnapshot` 类型即可。

### 🟡 H4 — 反向依赖：`packages/services/` 直接 `import '@/apps/main'`

**现象**

`packages/services/src/pagelet-host/src/electron-main/{AppOrchestrator,PageletProcess}.ts` 直接 import `@/apps/main/...`；
`packages/services/tsconfig.json` 显式给 `@/apps/main`、`@/apps/daemon` 加 paths。

**影响**

违反"packages 是基础层、apps 是消费方"的分层。`packages/services/` 没法独立发布，也没法被另一个 apps 项目复用。

**ROI**：中。需要抽 `IConnectionScopeProvider` 接口反转依赖，~80 行。

### 🟡 H5 — `MainCpServer.start()` eagerly 创建 setting orchestrator + 字符串硬编码 `'setting'`

D-007 §5.1 已记 follow-up。等第二个"自带 orchestrator 的窗口"出现时就要做"PageletProcess 完全声明式 spawn"。
现在硬编码不影响功能，但每加一个有窗口的 pagelet 都要改 `MainCpServer`。

**ROI**：中。但**必须**等 A-010 声明式 manifest 落地后再做，否则两次重构。

### 🟡 H6 — D-007 G7：跨进程 `ConnectionConfig` 序列化

pagelet→shared/daemon 的重连节奏（max retries / backoff cap）完全用 main 侧默认值。
没法按 pagelet 维度调整。

**前置依赖**：D-007 G7 在 x-oasis 上游解决。

### 🟡 H7 — `apps/main/src/application/browser/rpc-clients.ts` 顶层 eager `getProxy(...)`

pagelet 还没 spawn 完成时 renderer 调用 silently 挂起。
`useMonitorSnapshots` 用 try/catch + 2s 重试规避，其他 hook 没做。

**ROI**：中。改成 `getProxy()` lazy + 加 `whenReady()` Promise。

### 🟡 H8 — `Diagnostics` 2s + `MainMetricsService` 1s baseline 双管线，全量 push 无去重

两条 push 流定时器不同步，UI 端要自己去重；snapshot 大小一旦增加，开销线性放大。

**ROI**：中。统一为单管线 + diff push。

### 🟡 H9 — `apps/daemon/src/diagnostics/common/types.ts` 死代码

```ts
export const DIAGNOSTICS_SERVICE_PATH = 'monitor-rpc';
export interface IDiagnosticsService { ... }
```

**没有人 implement 也没有人调用**——daemon 实际把 `getPerformanceSnapshot` / `onPerformanceUpdate` 注册在 `daemon-rpc`。
误导后人：以为 monitor 走 `monitor-rpc`，实际走 `daemon-rpc`。

**ROI**：高（删除成本极低）。

### 🟡 H10 — Agent runtime 与 pagelet 完全脱节

`ChatPageletWorker.handleSend` 还是 `message.split(/(\s+)/)` mock 流；
`packages/agent/src/runtime/*` 几十个 runtime / extension 文件没有任何 `apps/` 调用方。

**影响**：阻塞 chat pagelet 真正能用。但这不是 framework 短板，是产品功能未接入。

**ROI**：高但属于功能开发，不在本次"框架审查"范畴。

### 🟢 H11 — `useOrchestratorDashboard` unsubscribe 永远空数组 + 同时还轮询

```ts
const unsubscribers: Array<() => void> = [];
// 注册 7 个 subscribe(api.onXxx, h)，但 unsubscribers 永远 push 不进去
return () => unsubscribers.forEach((fn) => fn());
```

unmount 不解订；同时还每 2s 轮询 `getStatus()`。两个 bug 同时存在，相互掩盖。

**ROI**：低修改量、明显 bug、立等可改。

## 3. 必须等 x-oasis 上游

| Gap | x-oasis 任务 | 阻塞 telegraph 侧 |
|-----|--------------|-------------------|
| G1 | supervisor `restart()` 走 `bindPort({rebind:true}) + replaceParticipantChannel` | H1（透明换链） |
| G2 | CircuitBreaker 接入 RPC 调用栈 | H2 forwardingProxy 终极版 |
| G7 | `ReconnectPolicy` 跨进程序列化 | H6（pagelet 维度调整重连节奏） |

## 4. 第一波改造建议（不依赖上游，按 ROI 排）

| 步骤 | 短板 | 预计改动 | 独立 commit |
|-----|------|---------|------------|
| 1 | H3：类型化 `PageletWorker` 客户端字段 | ~15 行 | ✅ |
| 2 | H2-1：抽 `createForwardingProxy()` 到 `packages/services/pagelet-host/node` | ~40 行 | ✅ |
| 3 | H2-2：`PageletWorker.boot()` 加 connect 超时 + 失败可恢复 | ~15 行 | ✅ |
| 4 | H11：修复 `useOrchestratorDashboard` 的 unsubscribe + 类型 | ~10 行 | ✅ |
| 5 | H9：删 `IDiagnosticsService` 死接口 | ~30 行（删除） | ✅ |
| 6 | H4：`MainCpServer` 抽 `IConnectionScopeProvider` 接口反转 packages→apps 依赖 | ~80 行 | ✅ |

每步独立 commit，conventional commits 规范，body 写动机 + 验证步骤（`pnpm -r typecheck` / `pnpm start` 手测点）。

## 5. 后续待评估（不在第一波）

- H5：等 A-010 声明式 manifest 落地后做。
- H7：改 lazy proxy 之前先评估对 renderer hook 的连锁影响。
- H8：要先确定 push diff 的"去重 key"语义，再动手。
- H10：属于产品功能（chat 接入真实 runtime），单独立项。
