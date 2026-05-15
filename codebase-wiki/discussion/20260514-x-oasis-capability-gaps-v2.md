---
id: D-007
title: x-oasis 能力差距盘点 v2（telegraph apps/ 实际落地视角）
description: >
  在 D-006 P0 三项 gap 上游修复落地之后，从 telegraph apps/ 的真实使用情况
  重新盘点 @x-oasis/async-call-rpc 与 @x-oasis/async-call-rpc-electron 的能力
  缺口，将"已就绪未使用"和"上游真实缺失"两类问题分开处理，并给 x-oasis
  团队按 ROI 排序的需求清单。
category: discussion
created: 2026-05-14
updated: 2026-05-15
tags: [x-oasis, async-call-rpc, orchestrator, capability-gap, telegraph, supervisor, circuit-breaker]
status: draft
references:
  - id: D-006
    rel: extends
    file: ./20260508-x-oasis-orchestrator-capability-gaps.md
    note: 本文是 D-006 在 P0 三项落地后的版本演进，重新分类盘点
  - id: D-008
    rel: extended-by
    file: ./20260515-apps-framework-gap-review-after-supervisor.md
    note: D-008 是本文"类别 A 落地后"的 telegraph 侧改造清单具体化
  - id: A-008
    rel: related-to
    file: ../architecture/20260509-telegraph-final-process-architecture.md
    note: §5（进程换链）/§6（Inspector）/§3.3（治理分离）需要 x-oasis 侧能力支撑
  - id: A-010
    rel: related-to
    file: ../architecture/20260513-vscode-contribution-model-for-telegraph.md
    note: 声明式 topology 需要 x-oasis 提供基础 API
sources:
  - title: 'x-oasis D-004 — UtilityProcessSupervisor RFC'
    url: '../../../../red/x-oasis/codebase-wiki/discussion/20260514-utility-process-supervisor-rfc.md'
    note: 对应本文 G1 的 x-oasis 侧 RFC
  - title: 'x-oasis D-005 — CircuitBreaker dead-code 分析与修复方案'
    url: '../../../../red/x-oasis/codebase-wiki/discussion/20260514-circuit-breaker-dead-code.md'
    note: 对应本文 G2 的 x-oasis 侧根因分析与最小接入方案
---

# x-oasis 能力差距盘点 v2（telegraph apps/ 实际落地视角）

> 本文是 D-006 的演进版本。D-006 P0 三项（`activateTimeoutMs`、自动 `handleParticipantLost`、
> `replaceParticipantChannel`）已在 x-oasis 上游落地。在 telegraph 完成 apps/ 重构之后，
> 从真实使用视角重新盘点：哪些"x-oasis 已就绪但 telegraph 还没用"、哪些"x-oasis 真实缺失"。
> 这两类问题处理方式截然不同——前者只需 telegraph 接入，后者必须由 x-oasis 团队建设。

## 0. 信息源

- x-oasis 仓库：`/Users/ryuyutyo/Documents/code/red/x-oasis/`
  - `packages/async/async-call-rpc/src/orchestrator/`
  - `packages/async/async-call-rpc-electron/src/electron-main/`
  - `packages/async/async-call-rpc-electron/docs/{index,orchestrator,scenario-orchestration,context-bridge-channel}.md`
- telegraph apps/ 当前实现（核对至 2026-05-14）：
  - `apps/{main,shared,daemon,connection,monitor,setting,design,chat}/`
  - `packages/services/src/{pagelet-host,main-metrics}/`

## 1. 类别 A — x-oasis 已就绪、telegraph 没用（不需要建，需要"用"）

这一类**不是 x-oasis 缺口**，是 telegraph 接入率低。`grep` 全量 telegraph 仓库结果：
`createEventForwarder` / `replaceParticipantChannel` / `setKillOnDisconnect` / `ExponentialBackoffPolicy`
均为 0 处使用。

| 能力 | x-oasis 位置 | telegraph 现状 | 直接收益 |
|------|--------------|-----------------|----------|
| `createEventForwarder(sink)` | `BaseConnectionOrchestrator.ts:384` | 0 处使用，`AppOrchestrator.ts` 手写 7 类事件 × 2 套 = 14 行样板 | 立即删 14 行 |
| `replaceParticipantChannel(id, ch, opts)` | `BaseConnectionOrchestrator.ts:281` | 0 处使用 | A-008 §5 进程换链能力的执行者 |
| `setKillOnDisconnect(false)` | `ElectronUtilityProcessChannel.ts:97` | 0 处使用 | 进程换链时不杀子进程的前置 |
| `activateTimeoutMs` | `ConnectOptions` | 已用 | — |
| `retryOnInitialFailure` | `ConnectOptions` | 0 处使用 | 冷启动可重试 |
| `ExponentialBackoffPolicy` / `FixedDelayPolicy` | `policies/` | 0 处使用，未在 `connect()` 传 `reconnectPolicy` | 重连不会发生 |
| `ConnectionStatsTracker` 滑动窗口 | `enableStats: true` 已开 | `getConnectionStats(id)` 只在 dashboard 单点查询 | Inspector 数据源 |
| `listParticipants()` | `BaseConnectionOrchestrator.ts:350` | 0 处消费 | Connections Tab 直接可用 |
| `OrchestratorProvider` + `useConnectionState` | `@x-oasis/async-call-rpc-react` | 0 处使用，自写 `useOrchestratorDashboard` | 标准化 hook |
| `setupMainOrchestrator(opts)` 标准 main 入口 | `MainOrchestratorSetup.ts` | 0 处使用，`MainCpServer` + `AppOrchestrator` 手写 | 部分场景可用，但当前实现假设单 orchestrator + 单 fromId/toId，多 orchestrator + 多 participant 场景下需扩展（见 G4） |

**结论**：上述 9 项不是 x-oasis 团队的工作，是 telegraph 的接入工作。详见本仓库
"telegraph 第一波改造"。

## 2. 类别 B — x-oasis 真实缺口（必须由 x-oasis 团队建设）

按 ROI 排序：

### G1 🔴 — UtilityProcessSupervisor / Spawn 抽象（最高优先级）

**现象**：`ElectronUtilityProcessChannel` 只是包了一层 channel，**spawn 子进程 + 失败重启 +
`replaceParticipantChannel` 编排**完全留给业务自己写。telegraph 的 `DaemonProcess` /
`SharedProcess` / `PageletProcess` 三处出现高度重复的 spawn + bindPort + register 代码，
且**没有一处真正用到 `replaceParticipantChannel`**——子进程崩溃后只能手动重启。

**核心矛盾**：
- A-008 §5 把 "`replaceParticipantChannel` + 透明换链" 列为最终架构的硬依赖
- 但 x-oasis 没提供 spawn → wait-for-ready → register → 崩溃监听 → respawn → replace 的开箱即用流程
- 业务侧每一个使用方都得自己实现一遍这个状态机，且很容易漏掉 race condition
  （比如 spawn 完成前 channel close 事件已到达）

**API 草案**：

```typescript
// @x-oasis/async-call-rpc-electron
interface UtilityProcessSupervisorOptions {
  /** UtilityProcess fork 入口路径 */
  entry: string;
  /** 该进程的 participant ID */
  participantId: string;
  /** 注册到哪个 orchestrator */
  orchestrator: ElectronConnectionOrchestrator;
  /** 进程角色（默认 'utility'） */
  role?: ParticipantType;
  /** 重启策略，复用 ReconnectPolicy 同一抽象 */
  restartPolicy?: ReconnectPolicy;
  /** 子进程参数 / 环境变量 */
  forkOptions?: { args?: string[]; env?: Record<string, string> };
  /** spawn 后等待 channel.onConnected 的超时（默认 30s） */
  startupTimeoutMs?: number;
}

class UtilityProcessSupervisor {
  constructor(opts: UtilityProcessSupervisorOptions);

  /**
   * spawn UtilityProcess → 等 ready → registerParticipant → 监听 disconnect。
   * 返回 spawn 完成的 promise（含 startupTimeoutMs 超时）。
   */
  start(): Promise<void>;

  /**
   * 主动重启：spawn 新进程 → bindPort（rebind:true）→
   * orchestrator.replaceParticipantChannel(id, newChannel, { autoReconnect: true })
   * → setKillOnDisconnect(false) on 旧 channel
   * 最后 kill 旧进程。
   */
  restart(reason?: string): Promise<void>;

  /** 停止并 kill。 */
  stop(): Promise<void>;

  /** 当前 supervisor 状态。 */
  readonly state: 'idle' | 'starting' | 'running' | 'restarting' | 'stopped' | 'failed';

  /** 累计重启历史（供 Inspector 消费）。 */
  readonly restartHistory: ReadonlyArray<{ at: number; reason: string }>;
}
```

**为什么必须放 x-oasis**：
1. 这个流程需要协调 `ElectronUtilityProcessChannel` + `ElectronConnectionOrchestrator` 两个内部实现
2. 涉及 `setKillOnDisconnect` + `replaceParticipantChannel` + `bindPort({rebind:true})`
   三个 API 的协同顺序，错一步就 leak 进程或丢挂起调用
3. telegraph 三处重复 = 任何使用方都会重新发明，且大概率不一致
4. A-008 §3.3 提出的"Daemon 策略 / Main 执行分离"——执行这一层的代码就是 supervisor

**telegraph 阻塞**：A-008 §5 进程崩溃自愈用例。

### G2 🔴 — CircuitBreaker 未接入 RPC 调用栈（空壳 bug）

**现象**：`ConnectionOrchestratorConfig.circuitBreaker.enabled = true` 时，
`BaseConnectionOrchestrator.ts:509-511` 会创建 `CircuitBreaker` 实例并挂到 `mc.circuitBreaker`，
但全代码搜索后只有 `mc.circuitBreaker?.reset()` 一处调用。`allowRequest` / `recordSuccess` /
`recordFailure` **从未被 RPC 调用栈消费**——配上去毫无效果。

**预期**：在 `sendRequest` middleware（或同等位置）应该：
```ts
if (mc.circuitBreaker && !mc.circuitBreaker.allowRequest()) {
  return mc.circuitBreaker.applyFallback(...args); // 或 reject
}
try {
  const result = await actualRpcCall();
  mc.circuitBreaker?.recordSuccess();
  return result;
} catch (err) {
  mc.circuitBreaker?.recordFailure();
  throw err;
}
```

**优先级**：🔴 P0。这是已经 ship 但实际不工作的功能，会导致使用方误以为有断路保护，
踩到生产事故。建议要么补完，要么先把 config 字段标 `@deprecated/not-yet-wired`。

**telegraph 阻塞**：稳定性章节中的"forwarding proxy 熔断"无法真正落地，
只能在 telegraph 业务代码里手写 try/catch + counter，重复发明轮子。

### G3 🟡 — Inspector 数据模型 + RPC 协议

`listParticipants()` 是基础数据，但 A-008 §6 要求的"全局 Inspector"还需要：

| 数据维度 | x-oasis 现状 | 需要补充 |
|----------|--------------|----------|
| 当前 participants × channels × connections | `listParticipants()` ✅ | — |
| Per-channel pending calls 列表（含 method、age） | ❌ 无 | `listPendingCalls(connectionId): Array<{ id, method, ageMs }>` |
| 历史 restart / state transition 轨迹 | `ConnectionStats` 仅累计 | 增加 ring buffer of `Array<{ at, prev, curr, reason }>` |
| 跨多个 orchestrator 聚合 | ❌ 各自独立 | `OrchestratorRegistry`（见 G4） |
| Supervisor 重启历史 | ❌ 不存在 supervisor | 由 G1 提供 |

**优先级**：P1。telegraph 可以先在业务侧拼，但 inspector 数据模型应在 x-oasis 标准化，
否则每个 telegraph-style 应用都要重发明。

### G4 🟡 — 多 Orchestrator 拓扑的 first-class 支持

**现象**：telegraph apps/main 用 `MainCpServer` 维护两套 orchestrator
（`orchestrator` 给主窗口，`settingOrchestrator` 给 setting 窗口），
`AppOrchestrator.ts` 中 `registerOrchestratorService` 与 `registerSettingOrchestratorService`
两个方法重复约 210 行（Lines 58–267）。x-oasis 当前默认假设"一个进程一个 orchestrator"。

**根因**：
- `serviceHost` 是模块级单例，多 orchestrator 必须各自维护私有 `RPCServiceHost`
  （telegraph apps/ 已经这么做了）
- 没有命名空间机制，事件订阅 / 内省 API 都需要分别调用
- 跨 orchestrator 的服务路由完全靠业务自己拼

**API 草案**：

```typescript
class OrchestratorRegistry {
  register(name: string, orchestrator: BaseConnectionOrchestrator): void;
  get(name: string): BaseConnectionOrchestrator | undefined;
  list(): Array<{ name: string; orchestrator: BaseConnectionOrchestrator }>;
  /** 跨所有 orchestrator 聚合事件 */
  createGlobalEventForwarder(sink: (event: { orchestrator: string; event: OrchestratorEvent }) => void): Disposable;
  /** 跨所有 orchestrator 聚合内省 */
  listAllParticipants(): Array<{ orchestrator: string; entry: ListParticipantEntry }>;
}
```

**优先级**：P1。telegraph 已经在生产场景用上多 orchestrator，迁移成本会随时间放大。

### G5 🟡 — Forwarding Proxy helper

**现象**：D-005 提出的 `exposeRemoteService` 工具最终没沉淀到 x-oasis 或 telegraph 任一侧。
`apps/connection/.../node/ConnectionWorker.ts` 等 worker 直接在 `onRendererConnection` 内
手写"调用上游 client → 返回结果"的 handler（含 ?? fallback 文案）。

**API 草案**：

```typescript
function createForwardingProxy<TUpstream>(opts: {
  upstream: TUpstream;
  /** 转发哪些方法（可选，默认全部） */
  methods?: Array<keyof TUpstream>;
  /** 调用级超时（默认 5s） */
  timeoutMs?: number;
  /** 失败计数熔断（依赖 G2 修复） */
  circuitBreaker?: CircuitBreakerConfig;
  /** 上游不存在时的 fallback */
  notReadyFallback?: (method: string) => any;
}): Record<string, (...args: any[]) => Promise<any>>;
```

**优先级**：P1，比 G2/G3 优先级低但高频。

### G6 🟡 — Per-connection ServiceHost 默认化

**现象**：当前 `setServiceHost` 是 channel 级全局共享。`apps/daemon/.../node/DaemonWorker.ts`
是唯一手写 per-connection `RPCServiceHost` 隔离的 worker（用于多 page 路由），
其他 worker 都共享模块级 `serviceHost`。

**风险**：多 renderer / 多 pagelet 场景下 service path 冲突，目前未爆只是因为各 pagelet
service path 唯一。

**建议**：x-oasis 提供 `createIsolatedServiceHost()` helper 并在 `IPCMainChannel` 等
channel 构造时默认走隔离路径，老用法标 deprecated。

**优先级**：P2，防御性。

### G7 🟡 — 跨进程 `ConnectionConfig` 序列化（worker → main 通过 ParticipantProxy 时）

**现象**：`ParticipantOrchestratorProxy.connect(toId, config?, options?)` 实际把 `config` /
`options` 通过 RPC 传到 main 进程的 `BaseConnectionOrchestrator.connect()`。但 `ConnectionConfig.reconnectPolicy`
字段是 `ReconnectPolicy` **class instance**（如 `ExponentialBackoffPolicy`），无法 JSON 序列化跨进程传。

**后果**：utility worker 侧（telegraph 中所有 PageletWorker 的 `proxy.connect('shared')`、
`proxy.connect('daemon')` 调用）**无法配置自定义重连策略**，只能使用 main 侧默认。

**修复方向**：
1. 把 `ReconnectPolicy` 拆成"声明式 config + 注册表"：worker 传 `{ kind: 'exponential-backoff', options: {...} }`，
   main 侧根据 kind 实例化
2. 或：main 侧维护 named policy registry，worker 传 policy name 字符串

**优先级**：P1。telegraph worker 侧 6+ 个 connect 调用都受影响。

### G8 🟢 — `renderer:<windowId>` 命名约定 / 多 BrowserWindow 模板

`renderer:main` 现在写死单值，A-008 §3.5 要求 `renderer:<windowId>` 命名。
x-oasis 可以提供：

```typescript
function generateRendererParticipantId(window: BrowserWindow): string;
function bootstrapRendererForWindow(opts: {
  window: BrowserWindow;
  orchestrator: ElectronConnectionOrchestrator;
}): IPCMainChannel;
```

**优先级**：P3。telegraph 当前只有主窗口 + setting 窗口，影响小。

## 3. 修正：D-006 中需要更新的部分

| D-006 项 | 状态 | 说明 |
|----------|------|------|
| Gap 1 `replaceParticipantChannel` | ✅ x-oasis 已交付，❌ telegraph 0 处使用 | 移到本文 G1 一起处理 |
| Gap 2 `activateTimeoutMs` | ✅ x-oasis 已交付，✅ telegraph 已用 | 关闭 |
| Gap 3 自动 `handleParticipantLost` | ✅ x-oasis 已交付，✅ 自动生效 | 关闭 |
| Gap 4 `listParticipants()` | ✅ x-oasis 已交付，❌ telegraph 0 处使用 | 移到本文类别 A，G3 一并消费 |
| Gap 5 `createEventForwarder()` | ✅ x-oasis 已交付，❌ telegraph 0 处使用 | 移到本文类别 A |
| Gap 6 心跳走 control plane 文档化 | ⏳ 未文档化 | 仍待办 |
| Gap 7 `bindPort` 幂等 (`rebind`) | ✅ x-oasis 已交付 | 关闭 |
| Gap 8 多 servicePath 共享 channel 文档化 | ⏳ 未文档化 | 仍待办 |

## 4. 给 x-oasis 团队的需求清单（按 ROI 排序）

| 优先级 | Gap | 类型 | 阻塞场景 |
|--------|-----|------|----------|
| 🔴 P0 | G2 CircuitBreaker 接入 RPC 调用栈 | bug fix | 已有 config 字段但实际不工作，会误导使用方 |
| 🔴 P0 | G1 UtilityProcessSupervisor | new feature | A-008 §5 进程换链流程的执行者 |
| 🟡 P1 | G3 Inspector 数据模型扩展 | enhancement | A-008 §6 Inspector |
| 🟡 P1 | G4 OrchestratorRegistry | new feature | telegraph apps/main 已用 |
| 🟡 P1 | G5 Forwarding Proxy helper | new feature | 高频但可绕过 |
| 🟡 P1 | G7 跨进程 ConnectionConfig 序列化 | enhancement | telegraph worker 侧 6+ 处 connect 受限 |
| 🟡 P2 | G6 Per-conn ServiceHost 默认化 | enhancement | 防御性 |
| 🟢 P3 | G8 多窗口模板 | doc + helper | 影响小 |

## 5. 给 telegraph 团队的清单（不依赖 x-oasis）

**第一波**（一周内，全部基于"类别 A 已就绪 API"）：
1. `MainCpServer` / `AppOrchestrator` 用 `createEventForwarder` 替换手写事件转发样板
2. 所有 `orchestrator.connect()` 调用增加 `reconnectPolicy: new ExponentialBackoffPolicy(...)`
3. 所有 utility 进程 connect 增加 `retryOnInitialFailure: true`
4. `AppOrchestrator` 双套注册抽公共方法 `registerOrchestratorService(scope: 'main' | 'setting')`，删 ~210 行重复
5. Connections Tab 改用 `listParticipants()` + `createEventForwarder` 实时数据

**第二波**（依赖 G1/G2 落地）：
6. 用 supervisor 重写 `DaemonProcess` / `SharedProcess` / `PageletProcess`
7. forwarding handler 接入 `circuitBreaker.allowRequest()`（待 G2 修复）

### 5.1 Follow-up — PageletProcess 完全声明式 spawn

第一波 step 4 之外，我们额外做了一个**与第一波 step 4 同时收尾**的小重构：把
`PageletProcess.spawn` 中的 `if (pageletId === 'setting')` 双 orchestrator 注册
硬编码下沉到 `MainCpServer.getAdditionalOrchestratorsFor(pageletId)`，让
`PageletProcess` 重新成为完全通用的 host。详见 commit
`refactor(pagelet-host): replace setting hardcode with MainCpServer hook`。

这一步只把"setting 属于 setting orchestrator"这条领域知识从通用 host 搬到了
真正负责 main 进程拓扑的 `MainCpServer` —— 条件分支仍然存在，只是搬到了正确
的层。要做到**完全声明式**（host 没有任何 pagelet 名字字符串），下一步是：

| 当前 | 完全声明式（候选） |
|---|---|
| `spawn(pageletId, file)` 内部决定挂哪些 orchestrator | `spawn(pageletId, file): Promise<Channel>` —— 返回 channel 句柄 |
| MainCpServer 内有 `if (pageletId === 'setting') return [settingOrch]` | 调用方（SettingApplication）拿到 channel 后自己 `settingOrch.registerParticipant(id, channel, 'utility')` |
| 新加一个有自己 orchestrator 的窗口需要改 MainCpServer | 新加只动新 Application；MainCpServer 完全不感知 |

**代价（暂未付出）**：

1. `IPageletProcess.spawn` 签名 breaking change（`Promise<void>` → `Promise<Channel>`）
2. 所有 5 个 `*Application` 中至少 SettingApplication 需要新增对
   `cpServer.getSettingOrchestrator()` 的依赖（DI 链路加注入）
3. `AppOrchestrator.connectSetting()` 与 `SettingApplication.start()` 之间的
   时序约束需要明确：必须先 `registerParticipant` 再 `connect`；目前由
   `MainCpServer.getAdditionalOrchestratorsFor` 在 `spawn` 内同步完成，迁到
   调用方后需要保证调用方按正确顺序操作（或在 connect 内做 lazy 等待）

**触发条件**：当出现第 2 个"自带 orchestrator 的窗口"时（例如未来的 monitor
独立窗口），就值得做这一步——届时 `MainCpServer.getAdditionalOrchestratorsFor`
里的 if 链会开始恶化。在那之前 ROI 不足。

跟踪标签：`#pagelet-process-fully-declarative-spawn`。

## 6. 推进策略

**短期（与 telegraph 第一波改造同步）**：
- D-007 同步给 x-oasis 团队，重点拉对齐 G1 + G2
- telegraph 完成"第一波"5 项，单独走 PR / wiki commit

**中期（G1 落地后）**：
- telegraph 第二波改造（supervisor 化所有 utility 进程）
- A-008 §5 进程换链 e2e 测试

**长期**：
- G3-G5 上游化后，telegraph 接入 Inspector + ForwardingProxy helper
- 评估是否把 supervisor / OrchestratorRegistry 模板下沉到 x-oasis examples

## 7. 相关文档

- D-006 — 历史版本，本文是其演进
- A-008 §5 / §6 / §3.3 — 提出 supervisor / Inspector / 治理分离要求
- A-010 — 声明式 topology 提案，需要 x-oasis G4 支持
- R-001 — link-to-source 配置（已不再使用，但 G1/G2 验证期可能需要）
