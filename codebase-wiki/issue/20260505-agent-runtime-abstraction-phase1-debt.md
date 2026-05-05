---
id: I-003
title: Agent Runtime Abstraction - Phase 1 Implementation Debt & Optimization
description: >
  分析当前 AgentStreamService 中的 hard code backend 分支问题，对标 A-005 & Phase-Gate 文档，
  提出统一 Runtime Adapter 的改进方案。这是一份技术债务清单 + 优化路线图。
category: issue
created: 2026-05-05
updated: 2026-05-05
tags:
  - agent-runtime
  - phase-1
  - technical-debt
  - abstraction
  - architecture
status: open
severity: critical
related:
  - A-005
  - P-002
  - I-002
---

# Agent Runtime Abstraction - Phase 1 实现债务与优化方案

## 问题概述

当前 `AgentStreamService.runStreamInternal`（第 169-264 行）中存在明确的 Pi-specific hard code，直接违反了 A-005 文档的核心设计原则：

> Telegraph 不应只是 Pi GUI/CLI wrapper，而应成为通用 **agent runtime host / extension host**。

**影响**：Phase 1 的 Exit Criteria「`AgentStreamService` 不再承载 backend 分支业务」未能满足。

---

## 一、核心架构问题

### 1.1 Backend 分支硬编码在 Service 层

**位置**：`apps/telegraph/src/services/agent/node/AgentStreamService.ts:169-264`

**问题代码**：
```typescript
if (req.settings.backend === 'pi-cli') {
  // pi-cli specific logic (97 lines)
  try {
    await runPiCliStream({
      runId,
      message,
      settings: req.settings,
      onLlmTrace: safePushLlmTrace,
      onRuntimeEvent: handleRuntimeEvent,
      // ... 5 个回调参数
    })
  } catch (err) { ... }
} else {
  // pi-ai specific logic (27 lines)
  console.log('[AgentStreamService] streaming pi-ai runtime', ...)
  try {
    for await (const ev of streamPiAiRuntimeEvents({
      runId,
      settings: req.settings,
      message,
    })) {
      handleRuntimeEvent(ev)
      if (failed) break
    }
  } catch (err) { ... }
}
```

**违反原则**：
- 🔴 Service 层直接包含 framework-specific 业务逻辑
- 🔴 两条路径的生命周期驱动方式不对称（回调 vs for-await）
- 🔴 关键常量（producerVersion、workflowPattern）在此计算

### 1.2 Runtime Event 映射缺少统一适配层

**问题**：
- Pi-CLI 在 `runPiCliStream` 内部生成 RuntimeEvent
- Pi-AI 在 `streamPiAiRuntimeEvents` 内部生成 RuntimeEvent
- Service 层再次变换（legacyLlmTraceFromRuntimeEvent + text_delta）

结果：转换逻辑分散，难以维护。

**期望**：存在清晰的 adapter 层，统一所有框架的事件映射。

### 1.3 生命周期状态管理混乱

**问题代码**：
```typescript
let failed = false
let terminalFromRuntime = false

// 第 132-147 行：handleRuntimeEvent 中
if (ev.type === 'run_failed') {
  failed = true
  terminalFromRuntime = true
  // ...
}
if (ev.type === 'run_completed' && !failed) {
  terminalFromRuntime = true
  // ...
}

// 第 209-221 行：pi-cli onDone 回调中
onDone: async () => {
  if (failed) return
  if (!terminalFromRuntime) {
    // ...
    await flushPush({ type: 'run_completed', ... })
  }
}
```

**隐患**：
- 多个地方维护终态标志（failed + terminalFromRuntime）
- 难以保证幂等性与事件唯一性
- 文档（A-005）强调关键生命周期事件不可丢失，当前没有保证机制

### 1.4 IPC 与 Trace 通道未清晰分离

**问题**：
```typescript
// 第 57-81 行：所有事件都通过同一个 sink
const push = (chunk) => sink.push({ webContentsId, chunk })
const safePush = (chunk, stage) => {
  void push(chunk).catch(...)  // 非阻塞
}
const flushPush = async (chunk, stage) => {
  try { await push(chunk) }   // 阻塞
}

// 调用处
safePush({ type: 'runtime_event', ... }, 'runtime_event')
safePushLlmTrace(legacy)  // legacy llm_trace
safePush({ type: 'text_delta', ... })
void push({ type: 'run_failed', ... })  // void promise
await flushPush({ type: 'run_completed', ... }, 'run_completed')
```

**风险**：
- I-002 文档指出「Trace 事件通道不应和 runTurn request/response 形成互等」
- 当前无明确背压策略
- 关键事件（run_completed）通过 flushPush 等待，可能成为阻塞点

---

## 二、对标 Phase-Gate 的失效分析

### Phase 1 - Runtime Adapter Wrapper + Trace v2 基线

**Exit Criteria 1**：`PiAiRuntime` 与 `PiCliRuntime` 以统一 runtime 接口产出事件

- **当前状态**：❌ 不存在 `PiAiRuntime` / `PiCliRuntime` 类
- **实际情况**：Service 层直接分支调用 `runPiCliStream()` 和 `streamPiAiRuntimeEvents()`
- **满足度**：0%

**Exit Criteria 2**：`AgentStreamService` 不再承载 backend 分支业务，仅负责转发/编排

- **当前状态**：❌ 第 169-264 行完全是 backend 分支业务
- **代码行数**：169 行分支逻辑占整个方法的 ~54%
- **满足度**：0%

**Exit Criteria 3**：Trace 至少能按 run 聚合展示 `model_request` / `model_event` / `run_*`

- **当前状态**：⚠️ 有 `runtime_event` 但同时保留 `llm_trace` 旧双通道
- **问题**：命名混乱（text_delta vs assistant_delta），映射关系不清晰
- **满足度**：~40%（能聚合但不纯净）

**No-Go Criteria**：主链路仍依赖未封装 backend 分支

- **当前状态**：❌ **触发 NO-GO**
- **原因**：`runStreamInternal` 本身就是未封装的分支逻辑

---

## 三、具体优化建议（可执行方案）

### 3.1 建议 1：立即新增 Runtime Adapter Factory（优先级 🔴 P0-必须）

**实现范围**：2-3 天

**目标文件结构**：
```
packages/agent/
├── src/
│   ├── runtime/
│   │   ├── AgentRuntime.ts         # 统一接口
│   │   ├── createRuntime.ts        # factory 函数
│   │   ├── pi/
│   │   │   ├── PiAiRuntime.ts      # pi-ai adapter
│   │   │   ├── PiCliRuntime.ts     # pi-cli adapter
│   │   │   └── common.ts           # pi 共用逻辑
│   │   └── errors.ts
│   └── index.ts
```

**核心接口**：
```typescript
// packages/agent/src/runtime/AgentRuntime.ts
export interface AgentRuntime {
  readonly id: string
  readonly label: string
  run(input: RuntimeInput): AsyncIterable<RuntimeEvent>
}

export interface RuntimeInput {
  runId: string
  sessionId: string
  message: string
  settings: AgentRuntimeSettings
  signal?: AbortSignal
}

// packages/agent/src/runtime/createRuntime.ts
export function createRuntime(settings: AgentRuntimeSettings): AgentRuntime {
  if (settings.backend === 'pi-cli') {
    return new PiCliRuntime(settings)
  }
  return new PiAiRuntime(settings)
}
```

**PiAiRuntime 实现示例**：
```typescript
export class PiAiRuntime implements AgentRuntime {
  readonly id = 'pi-ai'
  readonly label = 'Pi AI (In-Process)'

  async *run(input: RuntimeInput): AsyncIterable<RuntimeEvent> {
    const { runId, message, settings } = input
    
    // 发送 run_started 事件
    yield {
      type: 'run_started',
      runId,
      pattern: 'single_llm',
      origin: { framework: 'pi', runtimeId: 'pi-ai' },
      // ...
    }

    try {
      for await (const ev of streamPiAiRuntimeEvents(input)) {
        yield ev
        if (input.signal?.aborted) break
      }
    } catch (error) {
      yield {
        type: 'run_failed',
        runId,
        error: { code: 'runtime_error', message: error.message },
      }
    }
  }
}
```

**PiCliRuntime 实现示例**：
```typescript
export class PiCliRuntime implements AgentRuntime {
  readonly id = 'pi-cli'
  readonly label = 'Pi CLI (Full-Featured)'

  async *run(input: RuntimeInput): AsyncIterable<RuntimeEvent> {
    const { runId, signal } = input

    yield {
      type: 'run_started',
      runId,
      pattern: this.resolvePattern(input.settings),
      origin: { framework: 'pi', runtimeId: 'pi-cli' },
    }

    try {
      yield* this.streamCliEvents(input, signal)
    } catch (error) {
      yield {
        type: 'run_failed',
        runId,
        error: { code: 'cli_error', message: error.message },
      }
    }
  }

  private async *streamCliEvents(
    input: RuntimeInput,
    signal?: AbortSignal
  ): AsyncIterable<RuntimeEvent> {
    return new Promise((resolve, reject) => {
      runPiCliStream({
        ...input,
        onRuntimeEvent: (ev) => {
          // yield 通过 generator
        },
        onDone: () => resolve(),
        onError: (reason, err) => reject(err),
      })
    })
  }
}
```

**改造 AgentStreamService**：
```typescript
// 改造前（169 行分支）
if (req.settings.backend === 'pi-cli') {
  // 97 lines
  try { await runPiCliStream({ ... }) }
} else {
  // 27 lines
  try { for await (const ev of streamPiAiRuntimeEvents({ ... })) }
}

// 改造后（3 行）
const runtime = createRuntime(req.settings)
for await (const ev of runtime.run({
  runId, message, settings: req.settings
})) {
  handleRuntimeEvent(ev)
}
```

**验收标准**：
- ✅ `runStreamInternal` 的条件分支全部移除
- ✅ 所有 pi-cli 和 pi-ai 特有逻辑在各自 Runtime 类内
- ✅ `AgentStreamService` 变成纯转发器，<100 行
- ✅ 现有 UI/IPC 行为不变

---

### 3.2 建议 2：分离 IPC 与 Trace 通道（优先级 🟠 P0-必须）

**实现范围**：3-5 天

**当前问题**：
```typescript
// 所有事件通过同一 sink
safePush({ type: 'runtime_event', ... })    // 转发到 UI
safePushLlmTrace({ kind: 'pi_ai_request' })  // 同一通道
void push({ type: 'text_delta', ... })       // 同一通道
```

**改进方案**：
```typescript
// 分离通道
interface IAgentStreamSink {
  // 关键事件走 ACK 通道
  pushEvent(chunk: StreamChunk): Promise<void>
  
  // Trace 走异步非阻塞通道
  pushTrace(chunk: TraceChunk): void
}

class AgentStreamService {
  private async runStreamInternal(req: RunAgentStreamPayload) {
    const sink = this.getSink()
    const runtime = createRuntime(req.settings)

    // 关键生命周期事件
    const pushEvent = async (chunk: StreamChunk) => {
      await sink.pushEvent({ webContentsId, chunk })
    }

    // Trace 事件（非阻塞）
    const pushTrace = (chunk: TraceChunk) => {
      void sink.pushTrace({ webContentsId, chunk })
        .catch(err => console.error('[trace] push failed:', err))
    }

    for await (const ev of runtime.run({ ... })) {
      // 关键生命周期事件必须有 ACK
      if (isTerminalEvent(ev)) {
        await pushEvent({ type: 'runtime_event', event: ev })
      } else {
        // 其他事件可异步推送
        void pushEvent({ type: 'runtime_event', event: ev })
          .catch(err => console.error('[event] push failed:', err))
      }

      // Trace 独立通道
      const trace = legacyLlmTraceFromRuntimeEvent(ev)
      if (trace) {
        pushTrace({ type: 'llm_trace', trace })
      }
    }
  }
}
```

**背压策略**：
```typescript
// 定义哪些事件必须 ACK
function isTerminalEvent(ev: RuntimeEvent): boolean {
  return ev.type === 'run_completed' 
      || ev.type === 'run_failed'
      || ev.type === 'run_cancelled'
}

// Trace 事件可单独丢弃（非关键）
// Model 事件不阻塞主流程
// Tool 事件进入 trace 但不阻塞
```

**验收标准**：
- ✅ Trace 推送失败不影响 run 主流程
- ✅ 关键生命周期事件有序且唯一
- ✅ 不重现 I-002 的死锁场景
- ✅ 多轮对话 trace 完整性 >99%

---

### 3.3 建议 3：统一生命周期终态管理（优先级 🟠 P0-必须）

**实现范围**：2-3 天

**当前问题**：
```typescript
let failed = false
let terminalFromRuntime = false

// 多个地方修改这些标志，容易出现逻辑洞
if (ev.type === 'run_failed') {
  failed = true
  terminalFromRuntime = true
}

if (ev.type === 'run_completed' && !failed) {
  terminalFromRuntime = true
}

// onDone 回调再检查一遍
if (!terminalFromRuntime) {
  await flushPush({ type: 'run_completed', ... })
}
```

**改进方案**：
```typescript
class RunLifecycleManager {
  private state: 'initial' | 'running' | 'terminal' = 'initial'
  private terminalEvent: RuntimeEvent | null = null

  notifyStarted(ev: RuntimeEvent) {
    if (this.state !== 'initial') throw Error('run already started')
    this.state = 'running'
    return ev
  }

  notifyRuntimeEvent(ev: RuntimeEvent) {
    if (this.isTerminal(ev.type)) {
      // 幂等处理：第一次记录，后续忽略
      if (this.state === 'terminal') return null
      
      this.state = 'terminal'
      this.terminalEvent = ev
      return ev
    }
    return ev
  }

  ensureTerminal(reason: string): RuntimeEvent {
    if (this.state === 'terminal') return this.terminalEvent!
    
    this.state = 'terminal'
    const ev: RuntimeEvent = {
      type: 'run_failed',
      runId: this.runId,
      error: { code: 'timeout', message: reason },
      ts: Date.now(),
    }
    this.terminalEvent = ev
    return ev
  }

  private isTerminal(type: string): boolean {
    return type === 'run_completed' || type === 'run_failed' || type === 'run_cancelled'
  }
}

// 使用
class AgentStreamService {
  private async runStreamInternal(req: RunAgentStreamPayload) {
    const lifecycle = new RunLifecycleManager(req.runId)
    const runtime = createRuntime(req.settings)

    // 初始化
    const startEv = lifecycle.notifyStarted({
      type: 'run_started',
      runId: req.runId,
      // ...
    })
    await pushEvent(startEv)

    // 处理 runtime 事件
    for await (const ev of runtime.run({ ... })) {
      const processed = lifecycle.notifyRuntimeEvent(ev)
      if (processed) {
        // 推送（去重）
        if (processed.type.startsWith('run_')) {
          await pushEvent(processed)  // 关键事件阻塞
        } else {
          void pushEvent(processed)   // 其他事件异步
        }
      }
    }

    // 超时 fallback
    if (lifecycle.state !== 'terminal') {
      const fallbackEv = lifecycle.ensureTerminal('stream timeout')
      await pushEvent(fallbackEv)
    }
  }
}
```

**验收标准**：
- ✅ 终态事件严格一次（幂等保证）
- ✅ 不存在重复的 run_completed 或 run_failed
- ✅ Trace 中能看到清晰的状态转移
- ✅ 处理了 stream 意外结束的 fallback 情况

---

### 3.4 建议 4：建立 Event 映射文档（优先级 🟠 参考）

**实现范围**：1-2 天

**目标**：明确每个框架事件到 RuntimeEvent 的映射

**位置**：`packages/agent/src/runtime/eventAdapters.ts`

```typescript
/**
 * Pi-CLI to RuntimeEvent 映射
 * 
 * Pi CLI --mode json 输出 -> RuntimeEvent 约定：
 */
export const PI_CLI_EVENT_MAPPING = {
  // 生命周期
  'agent_end': { target: 'run_completed', mapping: mapAgentEnd },
  'error': { target: 'run_failed', mapping: mapError },
  
  // 模型
  'message_start': { target: 'model_request', mapping: mapMessageStart },
  'message_update': { target: 'model_event', mapping: mapMessageUpdate },
  'message_end': { target: 'assistant_delta', mapping: mapMessageEnd },
  
  // 工具
  'tool_execution_start': { target: 'tool_call', mapping: mapToolStart },
  'tool_execution_end': { target: 'tool_result', mapping: mapToolEnd },
  
  // 调试（降级）
  'session': { target: 'runtime_log', mapping: mapSession },
  'turn_start': { target: 'runtime_log', mapping: mapTurnStart },
  'turn_end': { target: 'runtime_log', mapping: mapTurnEnd },
} as const

/**
 * Pi-AI to RuntimeEvent 映射
 * 
 * @mariozechner/pi-ai stream event -> RuntimeEvent 约定：
 */
export const PI_AI_EVENT_MAPPING = {
  'model_request': { target: 'model_request', mapping: passthrough },
  'model_event': { target: 'model_event', mapping: passthrough },
  'assistant_delta': { target: 'assistant_delta', mapping: passthrough },
  'run_completed': { target: 'run_completed', mapping: passthrough },
  'run_failed': { target: 'run_failed', mapping: passthrough },
} as const
```

**验收标准**：
- ✅ 映射关系在代码和文档中对齐
- ✅ 命名统一（不再有 text_delta vs assistant_delta）
- ✅ 新增 runtime adapter 时有参考

---

## 四、优化优先级与时间表

### 前置条件检查清单

- [ ] Phase 0（Contracts MVP）已通过 Gate Review
- [ ] `@telegraph/runtime-contracts` 可在项目中引用
- [ ] `RuntimeEvent` 类型已稳定
- [ ] 现有 UI/IPC 接口文档已更新

### 优先级排序（依赖关系）

| 优先级 | 建议 | 时间 | 依赖 | 收益 |
|--------|------|------|------|------|
| 🔴 P0 | 建议 1：Runtime Adapter Factory | 2-3d | - | Phase 1 Exit Criteria 满足 |
| 🔴 P0 | 建议 3：生命周期管理 | 2-3d | 建议 1 | 去除重复事件 |
| 🔴 P0 | 建议 2：通道分离 | 3-5d | 建议 1,3 | 规避 I-002 死锁 |
| 🟠 参考 | 建议 4：映射文档 | 1-2d | - | 代码可维护性 |

### 实施路线图

**第 1 周（建议 1 + 建议 4）**
```
Day 1-2: 新增 packages/agent/runtime/ 目录与 AgentRuntime 接口
Day 2-3: 实现 PiAiRuntime 与 PiCliRuntime
Day 3  : 改造 AgentStreamService.runStreamInternal
Day 4  : 补充 eventAdapters.ts 与集成测试
```

**第 2 周（建议 3 + 建议 2）**
```
Day 1-2: 实现 RunLifecycleManager
Day 2-3: 重构 IPC 与 Trace 通道
Day 4  : 背压测试与 fallback 验证
```

**第 3 周（验收）**
```
Day 1-2: 多轮对话 trace 完整性测试
Day 3  : I-002 回归测试
Day 4  : Gate Review 前准备
```

---

## 五、验收标准与 Gate Review

### Phase 1 Exit Criteria（重新评估）

| Criteria | 当前 | 优化后 | 验收方式 |
|----------|------|--------|---------|
| `PiAiRuntime` 与 `PiCliRuntime` 以统一接口产出事件 | ❌ | ✅ | 代码 review + 类型检查 |
| `AgentStreamService` 不再承载 backend 分支 | ❌ | ✅ | runStreamInternal 代码行数 <50 |
| Trace 按 run 聚合展示 `model_request/event/run_*` | ⚠️ | ✅ | TracePanel 视觉验收 |

### No-Go Criteria 检查

| Criteria | 当前 | 优化后 |
|----------|------|--------|
| 主链路仍依赖未封装 backend 分支 | ❌ **NO-GO** | ✅ 已封装 |
| Trace 事件与主 RPC 出现互等或阻塞风险未解除 | ⚠️ 有风险 | ✅ 已分离 |

### Gate Review 清单

- [ ] PR-1 (Runtime Adapter): 代码 review 通过
- [ ] PR-2 (Lifecycle Manager): 单测覆盖 >80%
- [ ] PR-3 (Channel Separation): I-002 回归测试通过
- [ ] Trace Panel: 多轮对话可视化验证
- [ ] Performance: 无性能回退（TTFT、throughput）

---

## 六、风险评估与缓解

### 风险 1：现有 UI/IPC 兼容性破坏

**风险等级**：中等  
**缓解方案**：
- Phase 1 只改内部 adapter，IPC payload 保持兼容
- 新增 `runtime_event` 字段，保留旧的 `llm_trace` 字段用于过渡
- 双写策略：同时发送 RuntimeEvent 和 LegacyTrace

### 风险 2：Generator 模式引入新的流程控制问题

**风险等级**：中等  
**缓解方案**：
- 补充生成器生命周期测试
- 验证 AbortSignal 正确传播
- 背压测试覆盖 pipe buffer 溢出场景

### 风险 3：Pi-CLI 的回调转 generator 的语义差异

**风险等级**：低  
**缓解方案**：
- PiCliRuntime 内部用 Promise 包装，再转 generator
- 复用现有 `runPiCliStream` 的核心逻辑，只改驱动方式

---

## 七、对应检查清单

### 代码检查清单

- [ ] `AgentRuntime` 接口在 `packages/agent` 中定义
- [ ] `PiAiRuntime` 类完整实现 (with error handling)
- [ ] `PiCliRuntime` 类完整实现 (with error handling)
- [ ] `createRuntime(settings)` factory 函数导出
- [ ] `RunLifecycleManager` 实现幂等 + 超时 fallback
- [ ] IPC 通道分离（pushEvent vs pushTrace）
- [ ] 事件映射表（eventAdapters.ts）建立

### 测试检查清单

- [ ] 单轮 pi-ai 调用 end-to-end
- [ ] 单轮 pi-cli 调用 end-to-end
- [ ] 多轮对话上下文一致性
- [ ] 异常路径（timeout / signal abort）
- [ ] I-002 背压回归（sink 缓冲溢出）
- [ ] Trace 完整性（无丢失事件）

### 文档检查清单

- [ ] Runtime Adapter 实现指南（供后续框架接入参考）
- [ ] Event Mapping 表格化文档
- [ ] 错误分类与 fallback 策略文档
- [ ] IPC 背压设计文档

---

## 参考与关联

- **A-005**：Telegraph Agent Runtime 与 Extension Host 理论基础
  - 特别是第 10.3 节「Phase 1：Runtime Adapter Wrapper」
  - 第 4.8.4 节「当前实现约束与迁移现实」

- **P-002**：Phase-Gate 模板
  - Phase 1 Exit/No-Go Criteria（第 86-108 行）
  - Gate Review 记录（第 202-207 行）

- **I-002**：pi-ai llm-trace await sink deadlock
  - 背压问题的实际案例
  - 分离通道的必要性论证

---

## 后续跟进

此文档为 Phase 1 的实现债务清单。优化完成后应：

1. **更新 Phase-Gate 文档**：在「Gate Review - Phase 1」中记录决策与完成时间
2. **启动 Phase 2**：Extension Registry MVP（不依赖本 PR，并行进行）
3. **规划 Phase 3**：Tool Adapter Layer 的设计评审
