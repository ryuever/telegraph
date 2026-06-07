# D-???: Extension Host 与 Native Subagent Harness 重写方案

> **Status**: Draft（待 review）
> **Date**: 2026-06-08
> **Type**: Discussion / RFC（实施前需走 review）
> **Relates-to**:
> - **Authorizes**: D-015 `20260520-agent-runtime-product-layer-alignment.md`（产品层方向决策，钦定"沉淀为 Telegraph Native Subagent Harness"——本 RFC 是其在 ExtensionAPI + Subagent 两个子系统的落地实施方案；**不 supersede**，是 implement-of）
> - **Implements**: A-005 `20260505-...-agent-runtime-extension-host-theory.md` §4.5 / §4.6 / §10.8 / §10.11 / §15.1
> - **Touches**: agent-runtime-guard.md（T9：新 Agent runtime / Extension 机制）；不触发 architecture-guard T1-T6
> - **Touches**: `packages/agent-extension-host`（废弃）、`packages/agent-capabilities`（CapabilityHost 原地扩面）、`packages/agent`（新增 subagents/ 子模块）、`packages/agent-protocol`（新增 contribution 类型）、`extensions/telegraph-subagents`（按新 API 重写）

---

## 0. TL;DR

把 telegraph 当前 **三套并行 extension 体系**（System A 死代码 / System B HarnessExtensionManifest / System C agent-protocol 草案）收敛为**一条命令式 factory 路径**：

```ts
// extensions/<my-ext>/src/index.ts
export default function (telegraph: TelegraphExtensionAPI) {
  telegraph.registerTool({ ... })
  telegraph.registerSubagentProfile({ name: 'explore', model: ..., systemPrompt: ..., turnBudget: 8 })
  telegraph.on('tool_call', evt => { ... })
}
```

并把 `extensions/telegraph-subagents`（当前是 `BaseAgentRuntime` 子类，3 件事揉一团）拆为：
- **Native Subagent Harness**（`packages/agent/src/subagents/*`）：纯 in-process 的"child Run"执行器，复用 `RuntimeExecutor.run()` 协议
- **subagent extension**：通过新 ExtensionAPI 注册 N 个 `SubagentProfile` + 一个 `subagent.spawn` tool；router / orchestrator / final-synthesis 不再进 Harness 内核，要么作为 tool 暴露给外层 agent，要么作为业务编排层（chat/design pagelet）的薄壳

实施方式：在 telegraph 现有 `AgentCapability = (ctx: { host: CapabilityHost, hooks }) => void` factory 雏形上原地扩面（**不另起接口**），新增 `ExtensionHost` 负责从 manifest 加载 factory 文件并喂给 `AgentHarnessOptions`。

---

## 1. Context & Motivation

### 1.1 现状摸底（实测，非引用）

telegraph 当前同时存在 **三套并行 extension 体系**，互不相交，且其中两套形同虚设：

| 编号 | 入口文件 | manifest schema | 当前运行情况 |
|---|---|---|---|
| **A** | `packages/agent/src/extensions/node/{ExecutableFactory, ExtensionRegistry}.ts` + `extensions/ExtensionManifest.ts` | 自定义 `{ name, version, tools:[{ executable:{type:'node'\|'python'\|'binary'\|'http', path, handler}}]}` | **死代码**。`packages/agent/src/index.ts:199` 注释明确"intentionally excluded from main export"。grep 全仓库只有 `ExtensionRegistry.test.ts` 自测引用 |
| **B** | `packages/agent-extension-host/src/*` + `HarnessExtensionManifest`（含 `contributes.{runtimes, tools, prompts, profiles, services, skills, resources, agents}`）+ `activate(ctx)` | 第三套自定义 schema | **唯一 production 路径**。消费者**仅** `extensions/telegraph-subagents`（且把自己整成 `BaseAgentRuntime` 子类）。`ChatPageletWorker:298` / `DesignPageletWorker:209` import |
| **C** | `packages/agent-protocol/src/extensions.ts`（`ExtensionManifest` + `contributes.{tools, commands, panels, runtimes, hooks}` + `ExtensionCapability`）| A-005 §4.4 设计层 schema | **0 引用**。`grep "from '@/packages/agent-protocol/extensions'"` 无结果。是设计意图的化石 |

同时还有 **第四个**几乎已经是 ExtensionAPI 的东西，但被命名隐喻遮蔽了：

| | 入口文件 | 形态 |
|---|---|---|
| **D** | `packages/agent-capabilities/src/{CapabilityHost, capabilities}.ts` | `AgentCapability = (ctx: { host: CapabilityHost, hooks }) => void \| Promise<void>` —— **factory 签名**。`CapabilityHost.registerTool / registerFeedback / registerProcess / registerFilesystem / registerPatch / registerCustom` + `on<HookName>(handler)` —— **命令式 register + on**。`chatCapabilities() / designCapabilities() / codingCapabilities()` 已被 pagelet 装配 AgentHarness 时按宿主套餐传入（`AgentHarnessOptions.capabilities`）。`DefaultAgentHarness` ctor 已 `await capabilitiesReady` |

**关键事实**：D（CapabilityHost）与 pi-mono `ExtensionAPI`（`pi.registerTool() / pi.on()`）形状几乎同构，只差三件事：
1. **没有 "从 extension 目录读 manifest 加载 factory 文件"的 ExtensionHost**；
2. **表面不够宽**（缺 `registerRuntime / registerSubagentProfile / registerContextProvider / registerMessageRenderer / registerCommand / registerProvider`）；
3. **没有 lifecycle 事件 / dispose 语义**（factory 调用后 void，没有 deactivate 钩子，`extension_activated/deactivated` 这两个已存在的 RuntimeEvent 也没人发）。

### 1.2 telegraph-subagents 的具体错位

`extensions/telegraph-subagents/src/TelegraphSubagentHarness.ts`（898 行）把三件事揉一团：
- 是 `BaseAgentRuntime` 子类（实现 `RuntimeExecutor` 协议，注册到 `AgentHarness.runtimeRegistry`）
- 内部跑 team router → parallel orchestrator → final synthesizer 三段编排
- 通过 `agentDiscovery.ts` 把发现的 markdown agents 包装回 `HarnessExtensionManifest.contributes.agents`，绕一圈复刻 ContributionRegistry

这导致：
- **`AgentHarness.selectRuntimeId()` 出现硬编码**（`AgentHarness.ts:94-97`）：检测 `isTelegraphSubagentsSelector(settings)` → 路由到 `TELEGRAPH_SUBAGENTS_RUNTIME_ID`；`createRuntime.ts` 显式拒绝该 id，要求 pagelet 旁路注册。这是**单个 extension 反污染核心 harness** 的典型反例。
- **router/orchestrator/final-synth 三段被锁死在 runtime 层**——业务方想换 router 策略要改 runtime 子类。
- **`activate.ts` 是空壳**——B 的"声明式 manifest + activate"完全没被这个 extension 用，活成"manifest 当注册表 + 子类化 runtime"的怪样。

### 1.3 已落地的红线护栏（**不需要在本 RFC 重新发明**）

| 关注点 | 现状（实测） |
|---|---|
| RuntimeEvent 强类型 | `agent-protocol/events.ts` 7 大类全在；`step_started/step_completed/child_run_started/child_run_completed` 已落实（A-005 §10.8 直接合规）；`StepKind` 含 `'worker'` |
| schemaVersion | `version.ts: RUNTIME_CONTRACT_SCHEMA_VERSION = 1`，每个 event 通过 `RuntimeEventSchemaFields` 强制带；additive 不需要 bump |
| HookBus | `packages/agent/src/harness/HookBus.ts` 已落地，9 个 HookName 强类型；`DefaultAgentHarness.run()` 已在 `beforeRun / onRuntimeEvent / afterRun` 调用 |
| Tool Registry | `packages/agent/src/runtime/toolExecution/ToolRegistry.ts` |
| Runtime Registry | `AgentHarness.ts:64`（与 Harness 同文件，可独立化） |
| Session / RunLifecycle | `runtime/sessionManagement/Session.ts` + `runtime/RunLifecycleManager.ts`（terminal event 幂等） |
| Trace push | `AgentTraceSink.push()` 已在 `DefaultAgentHarness.pushTrace()` 调用，**非阻塞**（fire-and-forget），符合 I-002 |

**新 ExtensionAPI 不需要新建 registry，只需新建 ExtensionHost + 扩 CapabilityHost 表面 + 新建 SubagentRegistry。**

---

## 2. Goals / Non-Goals

### Goals
1. **Extension 接入方式统一为命令式 factory**：`export default function (telegraph) { ... }`，对齐 pi-mono ExtensionAPI 形状，但落地在 telegraph 已有 `AgentCapability` factory 雏形上原地扩面（合并概念，**不另起接口**）
2. **`telegraph-subagents` 不再是 `BaseAgentRuntime` 子类**，通过新 ExtensionAPI 接入；router/orchestrator/final-synth 从 runtime 层上移到业务编排层或 tool
3. **新建 Native Subagent Harness**（`packages/agent/src/subagents/*`），把 subagent 表达为"一次独立 runId 的 child Run"，复用 `RuntimeExecutor.run()` 协议；子进程不变（**复用宿主 pagelet utility process**，不 spawn 外部 pi/cli）
4. **删除 `AgentHarness.selectRuntimeId` 中的 telegraph-subagents 硬编码**和 `createRuntime.ts` 的对应拒绝路径
5. **删除 System A 死代码**；**收敛 System B 到新 ExtensionHost 路径**；让 System C（`agent-protocol/extensions.ts`）成为事实契约（新增 `SubagentProfileContribution` 等 type）

### Non-Goals
- **不动 RuntimeEvent schema 结构**（不 bump schemaVersion）。本 RFC 全程只用 additive：可能新增 RuntimeEvent type（如 `subagent_started`，待定），但 additive event types 不需要 bump（`version.ts:3-4` 注释明确）
- **不动 trace 拓扑**（trace sink push 仍非阻塞 fire-and-forget）
- **不增进程**（subagent 在宿主 pagelet utility process in-process 执行，**不触发 architecture-guard T1-T6**，只触发 T9）
- **不复刻 pi-subagents 的 `.pi/agents/` 目录语义、custom-agents/skill-loader/worktree 等周边**——只借鉴其 in-process kernel 抽象（`AgentConfig` 模型 + `AgentManager` 并发队列 + `agent-runner` graceful turn-budget）
- **不实现 panels / UI 注册的跨进程通道**（pi-mono 有 `registerMessageRenderer`；本 RFC 限于 node-side，UI 注册延后到 Phase-N，留好 type slot）
- **不立刻支持多 extension**——当前仅 `telegraph-subagents` 一个，本 RFC 重点是让单个 extension 跑通新路径；多 extension 加载顺序/依赖图等留待后续

---

## 3. 设计原则对齐

| 原则 | 来源 | 本 RFC 如何遵守 |
|---|---|---|
| 框架无关的 agent host | design.md "核心定位" | ExtensionAPI/HookBus/Subagent Harness 均不引用 pi/langgraph/ai-sdk 类型 |
| 先 RuntimeEvent 后编排 | design.md 原则 1 | router/orchestrator/final-synth 都走 `child_run_started/child_run_completed/step_started(kind:'worker')` 既有 event，不引入私有事件 |
| 核心类型不绑框架 | design.md 原则 2 | SubagentProfile 是 telegraph 自有 type，**不**继承 pi `AgentConfig` |
| Pi 是生态非天花板 | design.md 原则 3 | 命令式 ExtensionAPI 参考 pi-mono，但落到 telegraph 已有 `AgentCapability` 模型；Subagent kernel 参考 pi-subagents，但 session 抽象用 telegraph `RuntimeExecutor` |
| Extension 注册能力不直接控制宿主 | design.md 原则 5 | extension 只 `register*` 与 `on*`；不能 `spawn process` / `direct IPC` / 跨 pagelet 通信。由 ExtensionHost 守门 |
| Run = 第一概念 | design.md 原则 6 | subagent = child Run，有独立 runId，发 `run_started/run_completed`，挂在 parentRunId 下 |
| RuntimeEvent 必填字段第一天占位 | design.md 原则 7 | 已就位，本 RFC 不动 |
| 演进顺序 | design.md 原则 8 | 先 ExtensionAPI（Phase 1），再 Native Subagent Harness（Phase 2），再迁移 telegraph-subagents（Phase 3）—— RFC §7 |

**D-015 授权**：D-015 §"决策" 钦定"pi-subagents Embedded Adapter 方向废弃，相应能力沉淀为 Telegraph Native Subagent Harness"，本 RFC 是 D-015 的具体实施方案。

---

## 4. 拓扑归位（Architecture / Process）

**架构维度**（architecture-guard）：
- ❌ 不新增进程
- ❌ 不新增 IPC / RPC channel
- ❌ 不动 ConnectionOrchestrator / Forwarding Proxy
- ✅ Subagent child Run 复用宿主 pagelet utility process（chat → `ChatPageletWorker`，design → `DesignPageletWorker`）
- ✅ ExtensionHost 跑在同 pagelet utility process（与 AgentHarness 同 process）
- ✅ AgentHarness/RuntimeRegistry/HookBus/Subagent Harness 全 in-process 实例

**仅触发 agent-runtime-guard T9**：新 Agent runtime / Extension 机制。**不触发** T1-T6（进程/IPC/服务跨进程移动均无）。

---

## 5. 设计：TelegraphExtensionAPI（合并 CapabilityHost）

### 5.1 Factory 签名

```ts
export type TelegraphExtension = (telegraph: TelegraphExtensionAPI) => void | Promise<void>

// extensions/<my-ext>/src/index.ts
import type { TelegraphExtension } from '@/packages/agent-capabilities'
const ext: TelegraphExtension = (telegraph) => {
  telegraph.registerTool({ ... })
  telegraph.registerSubagentProfile({ ... })
  telegraph.on('tool_call', evt => { ... })
}
export default ext
```

### 5.2 `TelegraphExtensionAPI` 表面（CapabilityHost 原地扩面）

把现有 `AgentCapabilityContext = { host: CapabilityHost, hooks }` **扁平化**为一个 host 对象（与 pi-mono 一致），并扩面：

```ts
export interface TelegraphExtensionAPI {
  // —— 已有（CapabilityHost 现状）——
  registerTool(tool: ToolCapability): void
  registerFeedback(api: FeedbackAPI): void
  registerProcess(cap: ProcessCapability): void
  registerFilesystem(cap: FilesystemCapability): void
  registerPatch(cap: PatchCapability): void
  registerCustom(key: string, value: unknown): void

  on<N extends HookName>(name: N, handler: HookHandler<N>): () => void

  // —— 新增（本 RFC）——
  registerRuntime(reg: RuntimeRegistration): void          // → RuntimeRegistry
  registerSubagentProfile(profile: SubagentProfile): void  // → SubagentRegistry (新建)
  registerContextProvider(p: ContextProvider): void        // → ContextProviderRegistry (新建, 小)
  registerMessageRenderer(r: MessageRenderer): void        // 占位 type，phase-N 落 UI 注册
  registerCommand(c: CommandContribution): void            // 占位 type，phase-N 落 UI commands
  registerProvider(p: ProviderConfig): void                // 模型 provider；phase-N

  // —— 元信息（供 extension 内自省）——
  readonly logger: Logger
  readonly extensionId: string  // 来自 manifest
  readonly hostKind: 'chat' | 'design' | 'cli-gateway' | 'remote-control' | ...
}
```

**取舍**：
- 与 pi-mono `ExtensionAPI` 形状最大对齐：`registerXxx` + `on<EventType>`
- 但**不照搬 `events: EventBus`**（pi 用它做 extension 间通信）；本 RFC 仅一个 extension，暂不需要。留作 phase-N，加 `telegraph.events.emit/on` 跨 extension 通道
- **保留 `registerCustom`** 作为长尾出口；新能力先用 `registerCustom('subagents', ...)` 试水，稳定后升格为 first-class `register*`
- **`hostKind`** 让 extension 能按宿主调整行为（subagent extension 在 chat 注册"对话子智能体" profile，在 design 注册"设计师子智能体"profile）

### 5.3 Hook 强类型

复用 `agent-protocol/hooks.ts` 已有的 `HookName / HookPayloadMap / HookResultMap / HookHandler<N>` —— 9 种 hook 全在，`input` hook 还有 `transform/block/continue` 三态返值。**零新增 type**。

### 5.4 Event 订阅与 RuntimeEvent 复用

**用户已对齐决策**：`telegraph.on(type, handler)` 的 `type` **直接是 `RuntimeEventType`**，payload **直接是 `RuntimeEvent`** 的对应子类型，零适配层。

```ts
telegraph.on('tool_call', (evt: ToolEvent & { type: 'tool_call' }) => { ... })
telegraph.on('child_run_started', (evt) => { ... })
```

实现：`telegraph.on(type, handler)` 注册一个 `onRuntimeEvent` hook，内部按 `evt.type === type` 过滤分发。等同 `hooks.on('onRuntimeEvent', payload => { if (payload.event.type === type) handler(payload.event) })`。**handler 跑在 pagelet utility process 内**，不二次序列化，符合 A-005 §15.2 跨进程约束。

### 5.5 Lifecycle 与 Dispose

新增**两个事件**到 ExtensionHost（不是新 RuntimeEvent 类型——`extension_activated/extension_deactivated` 已在 `events.ts:58-59` 落地）：
- factory `await` 完成后，ExtensionHost 发 `extension_activated` event 进 trace
- 卸载（pagelet 关闭 / extension 显式 unregister）时发 `extension_deactivated`

**Dispose**：factory 可返回一个 `() => void | Promise<void>` cleanup 函数（兼容当前 `AgentCapability` 返 `void` 的形状——TypeScript signature 改为 `=> void | Promise<void> | (() => void | Promise<void>) | Promise<() => void | Promise<void>>`）。ExtensionHost 在 deactivate 时调用。

### 5.6 命名最终决定

- **接口名**：`TelegraphExtensionAPI`（host 对象），`TelegraphExtension`（factory 签名）
- **保留** `AgentCapability` 作为 deprecated alias（指向 `TelegraphExtension`）一个 release window，让 pagelet 的 `codingCapabilities() / chatCapabilities()` helper 不立即破
- **保留** `CapabilityHost` 类作为 `TelegraphExtensionHost` 的内部实现细节，逐步 rename
- helper 函数 rename：`chatCapabilities() → chatExtensions()` 等（PR 内 codemod）

---

## 6. 设计：Native Subagent Harness

### 6.1 三件套

新建 `packages/agent/src/subagents/`：

```
subagents/
├── SubagentRegistry.ts    # name → SubagentProfile 查找
├── SubagentHarness.ts     # 并发队列 + 生命周期管理（借鉴 pi AgentManager）
├── SubagentRunner.ts      # 单个 subagent 运行的核心（借鉴 pi agent-runner，但 session = telegraph RuntimeExecutor）
└── types.ts               # SubagentProfile / SubagentInvocation / SubagentRecord
```

### 6.2 类型

```ts
export interface SubagentProfile {
  name: string                              // 唯一标识；extension 注册时强制
  description: string                       // 给上层路由 / LLM 选择用
  systemPrompt: string                      // 注入 child Run 的 system prompt
  model?: { provider: string; name: string; ... }
  allowedTools?: string[]                   // tool gating；undefined = 继承父
  turnBudget?: number                       // 软上限 → 触发 wrap-up
  graceTurns?: number                       // 软上限到硬中止之间的窗口
  contextProvider?: string                  // ContextProvider id（注入父对话上下文）
}

export interface SubagentInvocation {
  profileName: string
  prompt: string
  parentRunId: string                       // 必填，发 child_run_started 时需要
  parentSessionId?: string
  joinMode?: 'sync' | 'detach'              // detach = fire-and-forget
  metadata?: Record<string, unknown>
}

export interface SubagentRecord {
  invocationId: string                      // 内部 id
  childRunId: string                        // 独立 runId
  profile: SubagentProfile
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: number
  finishedAt?: number
  usage?: { promptTokens: number; completionTokens: number; ... }
  // 不暴露 session 句柄——subagent 不可被 steer/resume/dispose；
  // 如果未来需要，参考 pi AgentSession 设计独立 spike
}
```

### 6.3 运行模型

**Subagent = 一次独立 runId 的 child Run**：
1. `SubagentHarness.spawn(invocation)` 入并发队列（默认 4，配置项）
2. 出队时：构造 child `AgentRunRequest`（systemPromptOverride = profile.systemPrompt + 注入的父上下文，allowedTools = profile.allowedTools，runId = new childRunId，settings 继承父）
3. 发 `child_run_started { parentRunId, childRunId }` 进父 Run 的 event stream
4. 调用 `runtimeRegistry.create(childRuntimeId, childRequest).run(childInput)` → AsyncIterable<RuntimeEvent>，把所有 event **rewrap** 后挂上 parentRunId 转发给上层订阅者（child 内部的 `run_started/run_completed/tool_call/...` 都成为父 trace 的可见事件）
5. Turn 计数命中 `turnBudget` → 通过 hook 或外层逻辑注入 wrap-up message（不实现 pi 的 session.steer，因为 telegraph RuntimeExecutor.run() 是 fire-and-forget AsyncIterable；wrap-up 通过下一个 turn 的 message 注入实现）
6. 命中 `turnBudget + graceTurns` → AbortSignal 硬中止，发 `run_cancelled` → `child_run_completed { output: { aborted: true } }`
7. 结束时发 `child_run_completed { parentRunId, childRunId, output }`

**所有事件都是已有 RuntimeEvent type**，无 schemaVersion 影响。

### 6.4 关键设计取舍

| 抉择 | 决定 | 理由 |
|---|---|---|
| Subagent 是 RuntimeExecutor 子类吗？ | **不是**。SubagentHarness 内部**调用** RuntimeRegistry.create() 拿到 child runtime，**不实现** RuntimeExecutor 接口 | 避免 telegraph-subagents 现状的"runtime 子类承载编排"反例 |
| Subagent 跨进程？ | **不**。in-process in 同一 pagelet utility process | 用户决策 + 不触发 architecture-guard T1-T6 |
| Subagent 有持久 session 句柄吗？ | **不**。一次 spawn = 一次 fire-and-forget Run。如果未来需要 steer/resume，独立 spike | 避免引入 pi `AgentSession`（在 telegraph runtime 模型下需大改 RuntimeExecutor） |
| Router / final-synth 在 Harness 内部吗？ | **不**。SubagentHarness 只负责"按 invocation 跑 child Run"，多个 subagent 的路由/汇总在**业务编排层或上层 agent 的 tool** 实现 | telegraph-subagents 当前最大错位的纠正点 |
| Worktree / 文件隔离？ | **不**。telegraph subagent 默认与父共享 filesystem cap | pi worktree 是 coding-agent 专有，telegraph 当前主要在 chat/design 场景，无强需求；未来按需补 |
| Compaction？ | **不**。subagent Run 通常短促，达到 turn budget 直接 wrap-up；不实现 pi 的 compaction loop | 复杂度 vs 收益不对等 |
| Scheduled / cron？ | **不**。pi 的 `ScheduledSubagent` 不入本 RFC | YAGNI |

### 6.5 与 extension 接入的边界

```ts
// extensions/telegraph-subagents/src/index.ts （新写法）
const ext: TelegraphExtension = (telegraph) => {
  // 1. 注册 N 个 profile
  for (const profile of loadProfilesFromMarkdown()) {
    telegraph.registerSubagentProfile(profile)
  }

  // 2. 注册一个 spawn tool 给上层 agent 调用
  telegraph.registerTool({
    definition: {
      name: 'subagent.spawn',
      description: 'Spawn a subagent by profile name and wait for result',
      parameters: { type: 'object', properties: { profileName: { type: 'string' }, prompt: { type: 'string' } }, required: ['profileName', 'prompt'] }
    },
    execute: async (input, ctx) => {
      // ctx.parentRunId from ToolExecutionContext
      return await telegraph.subagents.spawnAndWait({ ... })
    }
  })

  // 3. 可选：注册业务编排 tool（router / parallel / final-synth）
  telegraph.registerTool({ name: 'subagent.team', ... })   // 多 subagent 并行 + 汇总，可选
}
```

`telegraph.subagents` 是 SubagentHarness 句柄的便捷投影（由 ExtensionHost 在 factory 调用前注入），供 extension 主动 spawn。

---

## 7. 迁移路径（分 PR）

| PR | 范围 | 验收 | breaking？ |
|---|---|---|---|
| **P0** | 文档：本 RFC 落入 `codebase-wiki/discussion/`，与 D-015 双向 cross-link | review pass | 无 |
| **P1** | `packages/agent-protocol/extensions.ts` 新增 `SubagentProfileContribution / ContextProviderContribution / MessageRendererContribution` type；不删旧 type | typecheck pass | 无（additive） |
| **P2** | 新建 `packages/agent/src/subagents/{types,SubagentRegistry,SubagentRunner,SubagentHarness}.ts` + 单测；SubagentHarness 实例由 pagelet 装配时通过 `AgentHarnessOptions` 注入，与 RuntimeRegistry 平级 | 单测覆盖 spawn / spawnAndWait / abort / turnBudget / event forwarding | 无（新建） |
| **P3** | `packages/agent-capabilities` 内 `CapabilityHost` 扩面 → `registerRuntime/registerSubagentProfile/registerContextProvider/registerMessageRenderer/registerCommand/registerProvider`；rename → `TelegraphExtensionHost`，旧名 alias 保留；`AgentCapability` alias → `TelegraphExtension` | typecheck pass；pagelet 装配代码 0 行改动（alias 兼容） | 软 break（alias 保留） |
| **P4** | 新建 `packages/agent-extensions`（取代 `agent-extension-host`）：`ExtensionHost` 类负责扫描目录 + 读 manifest（精简 schema：只剩 `id/name/version/main/permissions`）+ `await import(main)` + 调 `factory(telegraph)` + 发 `extension_activated/deactivated` 事件 + 收集 cleanup fn | 单测：装载 dummy extension 走完 lifecycle | 无（新建） |
| **P5** | 重写 `extensions/telegraph-subagents` 走新 API；老 `TelegraphSubagentHarness` / `agentDiscovery` / `HarnessExtensionManifest`-style activate 全删；`telegraph.extension.json` 改为精简 manifest | chat/design pagelet smoke test：subagent spawn 跑通；event 在父 trace 可见 | **硬 break extension 内部实现**，对上层无 |
| **P6** | 删除 `AgentHarness.selectRuntimeId` 的 `isTelegraphSubagentsSelector` 分支；删除 `createRuntime.ts` 对 telegraph-subagents 的显式拒绝；删除 `agent-extension-host` 包（保留 0 行 reexport package 一个 release） | grep 全仓库无 `TELEGRAPH_SUBAGENTS_RUNTIME_ID` / `isTelegraphSubagentsSelector` 引用 | 硬 break 装配代码（同步改 pagelet workers） |
| **P7** | 删除 `packages/agent/src/extensions/{node,__tests__,ExtensionManifest.ts}` 死代码（System A） | typecheck + 全测 pass | 无（死代码） |
| **P8** | 清理 `AgentCapability` 等 deprecated alias；helper 函数 `chatCapabilities → chatExtensions` codemod | typecheck pass | 软 break（一个 release 后） |

**P0~P2 可并行；P3~P5 必须串行；P6 必须在 P5 落地并验证后；P7/P8 在任意时点。**

---

## 8. 兼容性 / 回滚 / Red Flags

### 8.1 兼容性窗口

- **P3 → P5 期间**：`AgentCapability` alias 和 `chatCapabilities` 等 helper 保持工作；pagelet 装配代码完全不需要改
- **P5**：extensions/telegraph-subagents 的内部完全重写，但其 manifest id `telegraph-subagents` 与导出形状对**业务 settings** 不变（`settings.orchestration === 'telegraph-subagents'` 仍触发 subagent 路径——只是此时不再走 selectRuntimeId 硬编码，而走 ExtensionHost 加载的 extension 注册的 tool）
- **P6**：硬 break 装配代码——需要在同一 PR 内更新 `ChatPageletWorker` / `DesignPageletWorker`

### 8.2 回滚

- P5 之前任意一步可独立回滚（PR 级 revert）
- P5 落地后回滚需 PR 内一并回退 telegraph-subagents 重写 —— **建议 P5 PR 内附 feature flag**（`settings.useNewSubagentExt: boolean`），运行时切换新旧路径，跑一周再删旧代码

### 8.3 Red Flags（实施时需特别警惕）

1. **`HookBus.dispatchHook('onRuntimeEvent')` 当前为同步触发**——如果 extension 在 `on('tool_call', ...)` 里做重活会卡 yield 链。RFC §5.4 要求 ExtensionHost 在包装 handler 时 microtask 化（`queueMicrotask(() => handler(evt))` 而非 await），与 trace sink 同等策略，避免 I-002 类死锁
2. **Subagent child Run 的 event rewrap 要保 ts 单调**——child Run 内部 ts 是 child 时钟，挂到 parent stream 时若 parent 在并行多 child，可能出现 ts 乱序。建议 SubagentHarness rewrap 时**不改 ts**，由消费方（renderer / trace）按 (parentRunId, childRunId) 分桶
3. **`extension_activated` 事件何时发**？factory `await` 完成是早合规点；但若 factory 内部异步注册（Promise resolve 后才 registerTool），事件早发会让 hook 误以为能找到 tool。决策：**`extension_activated` 在 factory return 之后立刻发**，extension 作者负责在 factory 同步段或 await 段完成所有同步 register
4. **factory 返回的 cleanup fn 若抛错**：吞 + log，不阻塞其他 extension deactivate
5. **`telegraph-subagents` 的 markdown agent loader 当前从文件系统扫描**——新写法下放到 extension 内部（factory 启动时 `fs.readdir(profilesDir).map(parse)`），fs 权限通过 `FilesystemCapability` 还是直接 `fs/promises`？建议直接 `fs/promises`，因为 extension 跑在 node 环境本就有 fs 访问；`FilesystemCapability` 是给 tool 用的受控抽象
6. **多 extension 加载顺序**：当前仅 1 个，本 RFC 不解；但 ExtensionHost 要预留 manifest `dependsOn?: string[]` 字段（不强制，先记录），避免后续破

### 8.4 与 Phase 表的关系

A-005 §10.11 Phase 6（Native Subagent Harness）依赖 Phase 5（Embedded Execution Kernel）与 Phase 2（Trace Model v2）。**实测结果**：
- Phase 2 Trace Model 等价物 = `RUNTIME_CONTRACT_SCHEMA_VERSION = 1` + RuntimeEventSchemaFields + child_run_* / step_* event，全部就位 ✅
- Phase 5 "Embedded Execution Kernel" 在文档中描述模糊；实测 RuntimeRegistry + Session + RunLifecycleManager + HookBus + ToolRegistry + CapabilityHost 全部就位 ✅
- 本 RFC 与 A-005 Phase 6 的对应关系：**就是它的实施版本**

---

## 9. Open Questions

| # | 问题 | 影响 |
|---|---|---|
| Q1 | `MessageRenderer` / `Command` 注册在 phase-N，但 UI 渲染在 renderer process，extension 跑在 utility process —— 注册的 React 组件如何跨进程传？是注册一个 contribution descriptor（id + props schema），renderer 拉取后本地映射到一个**预注册组件**？还是异步把组件代码作为 string 传过去？ | UI extension phase；本 RFC 不阻塞 |
| Q2 | `telegraph.events` 跨 extension 通道是否要在 P3 一起加？pi-mono `events: EventBus` 的设计很轻 | 短期仅 1 个 extension，可不加 |
| Q3 | `SubagentHarness` 的并发上限是 per-extension 还是 per-pagelet？建议 per-pagelet（一个 SubagentHarness 实例），profile 可指定 priority/quota | 实现细节，P2 决定 |
| Q4 | "context provider"（父对话上下文注入 system prompt）是否要 first-class？pi `context.ts` 是文件级方法。可先用 `registerCustom('contextProvider:<name>', fn)` 试水 | 决定 P3 是否真的加 `registerContextProvider` 还是先 `registerCustom` |
| Q5 | 是否引入 RuntimeEvent 子类型 `subagent_started/subagent_completed`，还是只用 `child_run_started/child_run_completed`？后者更通用（child run ≠ 一定是 subagent，比如 evaluator-optimizer 也产生 child run） | 倾向只用 child_run_*，前者通过 `event.raw.kind === 'subagent'` 区分 |

---

## 10. Appendix: 关键文件路径速查

### 改动目标
- `~/packages/agent-capabilities/src/CapabilityHost.ts` — 扩面 + rename
- `~/packages/agent/src/harness/AgentHarness.ts:64-87,93-98` — 删 selectRuntimeId 硬编码
- `~/packages/agent/src/runtime/createRuntime.ts` — 删 telegraph-subagents 拒绝路径
- `~/packages/agent-extension-host/*` — 废弃（替换为 `packages/agent-extensions`）
- `~/packages/agent/src/extensions/*` — 删（System A 死代码）
- `~/packages/agent-protocol/src/extensions.ts` — 加 SubagentProfileContribution 等
- `~/extensions/telegraph-subagents/src/*` — 全重写
- `~/apps/chat/src/application/node/ChatPageletWorker.ts:27,30,298-299` — 改 import
- `~/apps/design/src/application/node/DesignPageletWorker.ts:35-36,209-210` — 改 import

### 新增
- `~/packages/agent-extensions/` — 整个新包
- `~/packages/agent/src/subagents/{types,SubagentRegistry,SubagentRunner,SubagentHarness}.ts`

### 已就位（**不需要新建**）
- HookBus: `~/packages/agent/src/harness/HookBus.ts`
- ToolRegistry: `~/packages/agent/src/runtime/toolExecution/ToolRegistry.ts`
- RuntimeRegistry: `~/packages/agent/src/harness/AgentHarness.ts:64`
- RunLifecycleManager: `~/packages/agent/src/runtime/RunLifecycleManager.ts`
- agent-protocol 全套 events / hooks / version

### 参考（pi 生态，只读）
- `~/Documents/code/red/pi-mono/packages/coding-agent/src/core/extensions/types.ts:1080-1577` — pi ExtensionAPI 形状
- `~/Documents/code/modules/ai/pi/pi-subagents/src/{types,agent-manager,agent-runner,context}.ts` — subagent kernel 形状

---

**End of RFC.**
