---
id: D-006
title: x-oasis ConnectionOrchestrator 能力缺口分析（telegraph 视角）
description: >
  从 telegraph design 链路迁移的实际需求出发，盘点 @x-oasis/async-call-rpc-electron
  v0.3.0 的 ConnectionOrchestrator 现有能力与缺口，分 3 项必须补 + 4 项建议补 + 1 项已具备，
  并给出每项的 API 草案与 telegraph 阻塞 Phase。
category: discussion
created: 2026-05-08
updated: 2026-05-08
tags: [x-oasis, async-call-rpc, orchestrator, capability-gap, electron, telegraph]
status: partial-implemented
references:
  - id: P-003
    rel: derived-from
    file: ../roadmap/20260508-port-management-orchestrator-migration-plan.md
  - id: D-005
    rel: related-to
    file: ./20260508-renderer-pagelet-channel-convergence.md
  - id: R-001
    rel: related-to
    file: ../reference/20260508-x-oasis-link-to-source-setup.md
  - id: A-008
    rel: extended-by
    file: ../architecture/20260509-telegraph-final-process-architecture.md
    note: A-008 §5.6 把本文 P0 缺口锁定为最终架构的硬依赖
  - id: D-007
    rel: extended-by
    file: ./20260514-x-oasis-capability-gaps-v2.md
    note: D-007 是本文在 P0 三项落地后的演进版本，重新分类盘点
---

# x-oasis ConnectionOrchestrator 能力缺口分析（telegraph 视角）

> 本文从 telegraph design 链路迁移到 `ConnectionOrchestrator` 的实际需求出发，
> 盘点 `@x-oasis/async-call-rpc` v0.5.0 / `@x-oasis/async-call-rpc-electron` v0.3.0
> 现有能力与缺口。建议在 telegraph Phase 4-8 推进的同时，
> 在 x-oasis 上游同步补 3 项必须能力。

## 来源

- x-oasis 仓库：`/Users/ryu/Documents/code/red/x-oasis/`
- 相关源文件：
  - `packages/async/async-call-rpc/src/orchestrator/BaseConnectionOrchestrator.ts`
  - `packages/async/async-call-rpc-electron/src/ElectronConnectionOrchestrator.ts`
  - `packages/async/async-call-rpc-electron/examples/*-orchestrator-example/`

## 1. 现有能力清单（已具备）

| 能力 | 实现位置 | 备注 |
|------|----------|------|
| 6 状态模型 (`IDLE/CONNECTING/READY/TRANSIENT_FAILURE/DISCONNECTING/CLOSED`) | `BaseConnectionOrchestrator.ts` | |
| 公共 API: `registerParticipant` / `connect` / `disconnect` / `getConnectionInfo` / `getConnectionStats` / `handleParticipantLost` / `unregisterParticipant` | 同上 | |
| 7 个事件: `onStateChange/onReady/onDisconnected/onReconnecting/onReconnected/onReconnectFailed/onClosed` | 同上 | |
| 内部 service path `__x_oasis_orchestrator__` | `ElectronConnectionOrchestrator.ts` | 用于 control plane |
| 心跳 / 重连策略 (exponential backoff) / 断路器 / 统计 | `policies/`, `CircuitBreaker.ts`, `ConnectionStatsTracker.ts` | |
| 4 类 example: renderer↔main port / renderer↔utility port / utility↔main port / utility↔utility port | `examples/*-orchestrator-example/` | |
| 多 servicePath 共享同一 channel | async-call-rpc 自带 | D-005 forwarding proxy 直接用这个 |

## 2. 必须补充的能力（🔴 P0 — 阻塞 telegraph Phase 8）

### Gap 1 — `replaceParticipantChannel(id, channel)`

**问题**：进程崩溃后被重新 spawn，pid 变了，原 `MessagePortMain` / `UtilityProcess` channel 已失效。
现有 API 没法在保持 participantId 不变的前提下替换 channel；
只能 `unregister` + `register`，但这样会丢失统计、订阅、重连历史。

**API 草案**：

```typescript
class BaseConnectionOrchestrator {
  /**
   * 在不丢失 participant 的连接历史/订阅/统计的前提下，
   * 用新 channel 替换旧 channel。会触发对该 participant 所有
   * connection 的 TRANSIENT_FAILURE → CONNECTING → READY 流转。
   */
  replaceParticipantChannel(id: string, channel: IPCChannel): Promise<void>
}
```

**telegraph 阻塞**：Phase 8 进程重启重连用例。

### Gap 2 — `activateTimeoutMs` + 首连重试可配 ✅ 已落地（x-oasis `2dd835e`）

**实现**：`BaseConnectionOrchestrator.connect()` 三参重载支持 `ConnectOptions { activateTimeoutMs }`，
默认 30s；超时 reject `TimeoutError` 并回 IDLE。`retryOnInitialFailure` 字段已在
`ConnectOptions` 类型里预留（接 `ConnectionPolicy.retryOnInitialFailure`），等 Phase 4 实战需要时再接策略。
向后兼容：旧两参签名保留。详见 telegraph roadmap Phase 2.5 完成记录。

**问题**：`example` 中 `await Promise.all([activate])` 在 utility 还没 ready 时**无限挂**。
没有超时也没有首连重试策略；生产环境一旦 utility 启动慢就死锁。

**现状**：`ConnectionPolicy` 只覆盖**重连**策略，不覆盖**首连**。

**API 草案**：

```typescript
interface ConnectOptions {
  /** 首连超时（默认 30s） */
  activateTimeoutMs?: number
  /** 首连失败是否走重连策略（默认 false，符合现状） */
  retryOnInitialFailure?: boolean
}

class BaseConnectionOrchestrator {
  connect(a: string, b: string, options?: ConnectOptions): Promise<Connection>
}
```

**telegraph 阻塞**：Phase 4 design utility 启动握手序列；
production 环境 utility cold start 可能 > 5s。

### Gap 3 — channel 断开自动调用 `handleParticipantLost` ✅ 已落地（x-oasis `2dd835e`）

**实现**：在 `BaseConnectionOrchestrator.registerParticipant()` 内部 subscribe
`channel.onDidDisconnected → handleParticipantLost(id, 'channel disconnected')`，
所有 Electron 子类（webContents/utility/preload）天然适用。`handleParticipantLost`
真实签名是 `(id, reason: string)` —— 必填两参，下方草案的 `(id, err?)` 不准。
通过 `_participantDisconnectCleanups: Map<string, () => void>` 在重新注册同 id /
unregister 时清旧订阅；闭包 guard `participants.get(id)?.channel === channel`
防 stale。详见 telegraph roadmap Phase 2.5 完成记录。

**问题**：现状要业务侧监听底层 channel 的 close / error 事件，再手动调
`orchestrator.handleParticipantLost(id)`。
没有这个绑定 → orchestrator 永远以为 participant 还在线，重连不会触发。

**修复方向**：

```typescript
// ElectronConnectionOrchestrator 内部
registerParticipant(id, channel, role) {
  // ...
  // 自动绑定（关键）
  channel.onClose(() => this.handleParticipantLost(id))
  channel.onError((err) => this.handleParticipantLost(id, err))
}
```

**telegraph 阻塞**：Phase 8 故障注入用例（kill -9 进程后能否自动重连）。

## 3. 建议补充的能力（🟡 P1 — 不阻塞但显著降低工作量）

### Gap 4 — `listConnections()` / `listParticipants()` 拓扑查询

**用途**：telegraph Connections Tab 直接消费。
**现状**：只能通过 `getConnectionInfo(id)` 一个个查；没有 list API。

```typescript
class BaseConnectionOrchestrator {
  listParticipants(): Array<{ id: string; role: string; registeredAt: number }>
  listConnections(): Array<{ a: string; b: string; state: ConnectionState; stats: ConnectionStats }>
}
```

**Workaround**：telegraph 自己在 `AppOrchestrator` 包装层维护一份；x-oasis 提供后再切换。

### Gap 5 — `createEventForwarder()` helper

**问题**：每次注册新 participant 都要手抄 7 个事件订阅样板代码。

**API 草案**：

```typescript
class BaseConnectionOrchestrator {
  /** 把所有事件统一转发到一个 sink */
  createEventForwarder(sink: (event: { type: string; payload: unknown }) => void): Disposable
}
```

**Workaround**：telegraph 在 OrchestratorInspectorService 内自己写一份。

### Gap 6 — 心跳走 direct port 还是 control plane（待澄清）

**问题**：当前 heartbeat 实现走的是 `__x_oasis_orchestrator__` 这个 control plane servicePath，
还是走业务 channel？前者更隔离，后者更准确反映业务通路健康度。

**Action**：需要 review `BaseConnectionOrchestrator.ts` 的 heartbeat 实现，文档化。

### Gap 7 — `bindPort` 幂等

**问题**：rebind 同一 participant 的同一 port 时，应自动 unbind 旧 binding。
现状会抛 `AlreadyBound` 错误。

```typescript
interface BindOptions {
  /** 已存在 binding 时自动解绑（默认 false 抛错） */
  rebind?: boolean
}
```

## 4. 已具备但需文档化（🟢 P2）

### Gap 8 — 多 servicePath 共享同一 channel

**结论**：async-call-rpc 本就支持。D-005 的 Forwarding Proxy 方案直接依赖这个能力。
**Action**：在 `scenario-orchestration.md` 加一节 "多 service path 共享 channel" 给出示例。

## 5. 优先级矩阵

| Gap | 优先级 | telegraph 阻塞 Phase | x-oasis 实现复杂度 |
|-----|--------|----------------------|---------------------|
| 1. replaceParticipantChannel | 🔴 P0 | Phase 8 | 中 |
| 2. activateTimeoutMs | 🔴 P0 | Phase 4 | 低 |
| 3. 自动 handleParticipantLost | 🔴 P0 | Phase 8 | 低 |
| 4. list APIs | 🟡 P1 | — (workaround 可) | 极低 |
| 5. createEventForwarder | 🟡 P1 | — | 极低 |
| 6. heartbeat 文档化 | 🟡 P1 | — | 文档 only |
| 7. bindPort 幂等 | 🟡 P1 | — | 低 |
| 8. 多 servicePath 文档化 | 🟢 P2 | — | 文档 only |

## 6. 推进策略

### 短期（与 telegraph Phase 4-8 同步）

通过 `pnpm.overrides` link to source（详见 R-001），在 telegraph 仓库内验证补强方案：

1. Gap 2 / 3 当周补完，单元测试覆盖
2. Gap 1 在 telegraph Phase 8 故障注入前完成
3. Gap 4 / 5 telegraph 先 workaround，x-oasis 不阻塞

### 中期（telegraph 跑通后）

- 把 P0 三项发版到 `@x-oasis/async-call-rpc-electron@0.4.0`
- 把 D-005 的 `exposeRemoteService` 抽到 x-oasis 作为 `forwarding helper`
- 完整文档化 `scenario-orchestration.md`

## 7. 相关讨论

- 选型背景：见 P-003 §2 决策表
- Forwarding Proxy 设计：见 D-005
- link to source 配置：见 R-001
