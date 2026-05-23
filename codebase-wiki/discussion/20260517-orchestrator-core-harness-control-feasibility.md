---
id: D-013
title: "@orchestrator/core 作为 Harness Control 接入可行性分析"
description: "评估 langgraphjs/libs/orchestrator 零依赖 Pregel 图编排引擎接入 Telegraph 的可行性。"
category: discussion
created: 2026-05-17
updated: 2026-05-24
tags: [orchestrator, langgraph, pregel, harness, runtime, workflow, feasibility]
status: draft
references:
  - id: D-011
    rel: related-to
    file: ./20260517-chat-agent-runtime-integration.md
  - id: A-005
    rel: related-to
    file: ../architecture/20260505-telegraph-agent-runtime-extension-host-theory.md
  - id: A-008
    rel: related-to
    file: ../architecture/20260509-telegraph-final-process-architecture.md
  - id: P-005
    rel: derives
    file: ../roadmap/20260518-orchestrator-core-controlled-migration-plan.md
---

# `@orchestrator/core` 作为 Harness Control 接入可行性分析

## 0. 背景与动机

Telegraph 的 agent runtime 体系（A-005）需要底层编排能力来支撑多种工作流模式（`prompt_chain`、`routing`、`parallelization`、`orchestrator_workers`、`evaluator_optimizer`、`autonomous_agent`）。目前 `packages/runtime-contracts` 定义了 `WorkflowPattern` 和 `WorkflowEvent` 类型，但**没有编排引擎实现**。

`langgraphjs/libs/orchestrator` 是一个从 LangGraph 提炼的、零依赖的 TypeScript Pregel 执行引擎（~3000 行代码），具备：

- 有状态图编排（StateGraph + Annotation）
- 条件路由、并行扇出/扇入
- Command/Send 高级控制流
- `interrupt()` Human-in-the-Loop
- Checkpoint 持久化 + 时间旅行
- Swarm 多 Agent 协作

本报告评估将其作为 Telegraph "harness control" 层接入的可行性。

---

## 1. 两边定位对照

| 维度 | `@orchestrator/core` | Telegraph |
|------|----------------------|-----------|
| **本质** | Pregel 超步模型的有状态图编排引擎 | Electron 桌面 app，框架无关的本地 agent host |
| **运行环境** | Node.js >= 18，纯 TypeScript | Electron utility process (pagelet) |
| **外部依赖** | **零** | x-oasis RPC, React, Electron |
| **核心抽象** | `StateGraph` → `CompiledStateGraph` → `invoke()` → 返回最终状态 | `AgentRuntime.run(input)` → `AsyncIterable<RuntimeEvent>` |
| **状态管理** | Channel + Reducer + Annotation DSL | `RuntimeEvent` stream，UI 端 store 消费 |
| **控制流** | 静态/条件/并行边 + `Command(goto)` + `Send` + `interrupt()` | 由 adapter 封装，上层只看 `RuntimeEvent` |
| **持久化** | `BaseCheckpointSaver` / `MemorySaver`（中断/恢复/时间旅行） | 未实现（contracts 有类型骨架） |
| **多 Agent** | `createSwarm()` + `handoff` | 设计中有 `child_run_started/completed`，未实现 |

---

## 2. 核心契合点

### 2.1 零依赖 + ESM + Node.js — 进程归属合规 ✅

根据 architecture-guard §2.1 + agent-runtime-guard §2.1，runtime 实现只能落在 **pagelet utility process** 内。`@orchestrator/core`：

- 零运行时依赖 → 不引入 `@langchain/*` 或其他重型链
- `type: "module"` (ESM) → 与 Electron utility process 兼容
- 纯 TypeScript → 可以通过 `pnpm workspace` 直接引用源码，也可 `tsc` 编译后引用 dist

**关键结论**：它可以安全地 `import` 到 `apps/chat/src/` 或其他 pagelet 内，**不违反任何进程归属红线**。

### 2.2 `invoke()` → `AsyncIterable<RuntimeEvent>` — 桥接模式清晰 ✅

Telegraph 的核心契约：

```typescript
interface AgentRuntime {
  run(input: RunInput): AsyncIterable<RuntimeEvent>
}
```

Orchestrator 的执行入口：

```typescript
class CompiledStateGraph {
  async invoke(input: Partial<S>, options?: InvokeOptions): Promise<S>
}
```

桥接方式 — 写一个 `LangGraphOrchestratorAdapter`（实现 `AgentRuntime`）：

```typescript
// apps/chat/src/runtime/LangGraphOrchestratorAdapter.ts
import type { AgentRuntime, RunInput, RuntimeEvent } from '@/packages/runtime-contracts'
import { StateGraph, Annotation, START, END } from '@orchestrator/core'

class LangGraphOrchestratorAdapter implements AgentRuntime {
  readonly id = 'langgraph-orchestrator'
  readonly label = 'LangGraph Orchestrator'

  async *run(input: RunInput): AsyncGenerator<RuntimeEvent> {
    yield { type: 'run_started', runId: input.runId, schemaVersion: ..., ts: Date.now() }
    try {
      const compiled = this.buildGraph(input)
      const result = await compiled.invoke(
        { messages: input.messages },
        { configurable: { thread_id: input.sessionId } }
      )
      yield { type: 'run_completed', runId: input.runId, output: result, schemaVersion: ..., ts: Date.now() }
    } catch (error) {
      yield { type: 'run_failed', runId: input.runId, error: ..., schemaVersion: ..., ts: Date.now() }
    }
  }
}
```

### 2.3 `interrupt()` → `HumanInteractionEvent` — HITL 天然映射 ✅

Orchestrator 的 `interrupt()` + `Command.resume` 提供了完整的 Human-in-the-Loop 原语，直接映射到 Telegraph 的 `permission_requested` / `permission_resolved` 事件。

### 2.4 Checkpoint → Session 持久化 ✅

`MemorySaver` / `BaseCheckpointSaver` 可以作为 session state 的持久化后端：`thread_id` ↔ `sessionId`，checkpoint history ↔ time-travel debugging。

### 2.5 Swarm → 多 Agent 协作 ✅

`createSwarm()` + `Command(goto, graph: Command.PARENT)` 映射到 Telegraph 的 `child_run_started/completed` 和 `WorkflowPattern.orchestrator_workers`。

---

## 3. 关键摩擦点

### 3.1 `invoke()` 是 Pull-based，Telegraph 需要 Push-based Stream

**问题**：`CompiledStateGraph.invoke()` 返回 `Promise<S>`，中间 superstep 过程对调用者黑盒。

**解决路径**（推荐方案 C — AsyncGenerator 包装 + `onStep` hook）：

| 方案 | 复杂度 | 描述 |
|------|--------|------|
| A. `onStep` hook 透传 | 低 | `executePregelGraph` 已有 `onStep` 回调，但 `invoke()` 不透传 |
| B. 直接调用 `executePregelGraph` | 中 | 绕过 `invoke()`，但要自己管理 checkpoint |
| **C. AsyncGenerator 包装** | **中** | **推荐** — 用 `onStep` 推事件到 generator 外，需 patch `invoke()` 透传 `onStep`（~10 行）|
| D. Fork `executePregelGraph` | 高 | 改成每步 yield 一个事件 |

### 3.2 节点内部没有细粒度事件

**问题**：`NodeAction` 只是 `(state) => update`，LLM/tool 调用过程是黑盒。

**解决路径**：扩展 `NodeConfig` 加 `emit` 函数（~15 行改动）：

```typescript
interface NodeConfig {
  taskId?: string
  signal?: AbortSignal
  emit?: (event: RuntimeEvent) => void  // ← 新增
}
```

### 3.3 `WorkflowEvent` 映射需要 superstep 级信息

**解决路径**：扩展 `onStep` 签名附带 `triggeredNodes` / `executedNodes` / `edges`（~30 行改动）。

### 3.4 ESM vs CJS 兼容性

Vite 构建处理 ESM → CJS 转换，预计无问题，但需实测。

---

## 4. 集成策略 — 推荐三步走

### Step 1: 引入到 monorepo（不改任何现有代码）

```
# 选项 A: 复制到 monorepo（推荐，自控版本）
cp -r ../langgraphjs/libs/orchestrator packages/orchestrator

# 选项 B: pnpm workspace link
# pnpm-workspace.yaml 加:
#   - ../../langgraphjs/libs/orchestrator
```

修改相关 `tsconfig.json` 加入 `@/packages/orchestrator/*` alias。

### Step 2: 编写 `LangGraphOrchestratorRuntime` adapter

在 pagelet 内写 adapter（所有 orchestrator 类型**只出现在 adapter 目录内**）：

```
apps/chat/src/runtime/
├── LangGraphOrchestratorRuntime.ts   # implements AgentRuntime
├── graph-builder.ts                  # RunInput → StateGraph
├── event-bridge.ts                   # superstep → RuntimeEvent
└── checkpoint-adapter.ts             # BaseCheckpointSaver → session store
```

### Step 3: Patch orchestrator 支持 streaming

Fork patch（或向上游 PR）：`invoke()` 透传 `onStep` + `NodeConfig.emit` + superstep 信息。改动量 **~50–80 行**。

---

## 5. 风险评估

| 风险 | 等级 | 缓解 |
|------|------|------|
| Orchestrator 无 streaming 支持 | **中** | Step 3 patch |
| NodeAction 内部是黑盒 | **中** | `NodeConfig.emit` 注入 |
| 0.1.0 API 不稳定 | **低** | Fork 到 monorepo 自控 |
| 违反进程归属 | **无** | 只在 pagelet 内 import |
| 违反 framework 绑定原则 | **无** | 类型封在 adapter 内 |
| ESM/CJS 兼容性 | **低** | Vite 处理，需实测 |
| Checkpoint 持久化 | **低** | 先用 MemorySaver |

---

## 6. 架构合规性自检

- [x] 改动触发 AT7 + AT2 → 已读 A-005 §3 + §4.1 + §6
- [x] 新代码落在 pagelet 内，不在 main / daemon
- [x] 复用现有 RuntimeEvent 类型，不新增
- [x] trace 不阻塞业务 RPC
- [x] orchestrator 概念封装在 adapter 内，不泄漏到 contracts / UI
- [x] `packages/runtime-contracts` 引用类型全部存在

---

## 7. 总结评分

| 评估维度 | 评分 | 说明 |
|----------|------|------|
| **架构合规性** | ✅ 完全合规 | 只在 pagelet 内使用 |
| **API 映射可行性** | ✅ 可行 | adapter + 小量 patch |
| **技术投入** | ⚠️ 中等 | adapter ~300 行 + patch ~50–80 行 |
| **功能完整性** | ✅ 超出预期 | 图编排 + HITL + checkpoint + swarm |
| **长期可维护性** | ✅ 好 | 零依赖、~3K 行、fork 友好 |
| **设计原则一致性** | ✅ 一致 | 框架差异封装在 adapter 内 |

**总评：可行且推荐接入。** 主要工作：编写 adapter（~300 行）+ patch streaming（~80 行）。

---

## 8. 待决策

1. **引入方式**：fork 到 `packages/orchestrator` 还是外部依赖？
2. **优先级**：立即开始还是等 runtime adapter 框架先稳定？
3. **Patch 策略**：向上游 PR 还是 fork 自维护？

---

## 附录 A: `@orchestrator/core` API 表面

```
常量:     START, END, Send, Command
错误:     OrchestratorError, GraphValidationError, GraphRecursionError, ...
中断:     interrupt, GraphInterrupt, NodeInterrupt
状态:     Annotation, AnnotationRoot, StateType
信道:     BaseChannel, LastValue, EphemeralValue, NamedBarrierValue, Topic
图:       StateGraph, CompiledStateGraph
引擎:     executePregelGraph
Swarm:    createSwarm, SwarmState, createHandoffAction
检查点:   BaseCheckpointSaver, MemorySaver, Checkpoint
```

## 附录 B: Orchestrator → RuntimeEvent 映射表

| Orchestrator | RuntimeEvent | 映射方式 |
|---|---|---|
| `invoke()` 开始 | `run_started` | adapter 发射 |
| `invoke()` 完成 | `run_completed` | adapter 发射 |
| `invoke()` 失败 | `run_failed` | adapter catch |
| superstep 触发 | `step_started` | `onStep` 回调 |
| superstep 完成 | `step_completed` | `onStep` 回调 |
| 条件边路由 | `edge_taken` | `onStep` edges |
| `interrupt()` | `permission_requested` | 捕获 GraphInterrupt |
| `Command({ resume })` | `permission_resolved` | resume 后发射 |
| `Send` 动态扇出 | `child_run_started` | triggeredNodes 映射 |
| Swarm handoff | `child_run_completed` | swarm 状态映射 |
| Node `emit()` | `model_*` / `tool_*` | NodeConfig.emit |

## 附录 C: 参考

| 文档 | 关系 |
|------|------|
| [A-005](../architecture/20260505-telegraph-agent-runtime-extension-host-theory.md) | Agent Runtime 完整理论 |
| [A-008](../architecture/20260509-telegraph-final-process-architecture.md) §3.4 + §8 | Runtime 在进程拓扑中的承载 |
| `../../.agents/agent-runtime-design.md` | 8 条设计原则 |
| `../../.agents/agent-runtime-guard.md` | 红线清单 |
| [D-011](./20260517-chat-agent-runtime-integration.md) | Chat Agent Runtime 接入（已实施） |
| `packages/runtime-contracts/src/` | RuntimeEvent / AgentRuntime 类型骨架 |
| `langgraphjs/libs/orchestrator/` | @orchestrator/core 源码 |
| **包大小** | ~3000 行 | N/A |
