---
id: D-017
title: Durable Execution 与 Agent Run Ledger 设想
description: >
  归档关于在 Telegraph agent 层引入 durable execution 的讨论：区分
  durable trace、recovery、resume 与 side-effect idempotency，并给出
  基于现有 AgentRunRepository 的落地路径与 Restate / DBOS / Temporal /
  LangGraph 等候选库取舍。
category: discussion
created: 2026-05-22
updated: 2026-05-22
tags:
  - agent-runtime
  - durable-execution
  - run-ledger
  - checkpoint
  - recovery
  - resume
  - restate
  - dbos
  - temporal
  - langgraph
status: draft
sources:
  - title: "Restate - Durable Execution"
    url: https://docs.restate.dev/concepts/durable_execution/
  - title: "Restate - Workflows"
    url: https://docs.restate.dev/tour/workflows
  - title: "DBOS - Architecture"
    url: https://docs.dbos.dev/architecture
  - title: "DBOS TypeScript - Workflows & Steps"
    url: https://docs.dbos.dev/typescript/reference/workflows-steps
  - title: "DBOS TypeScript - Add DBOS To Your App"
    url: https://docs.dbos.dev/typescript/integrating-dbos
  - title: "Temporal Docs"
    url: https://docs.temporal.io/
  - title: "LangGraph JavaScript - Durable execution"
    url: https://docs.langchain.com/oss/javascript/langgraph/durable-execution
  - title: "Inngest - How functions are executed: Durable Execution"
    url: https://www.inngest.com/docs/learn/how-functions-are-executed
  - title: "Trigger.dev - Self-hosting overview"
    url: https://trigger.dev/docs/self-hosting/overview
references:
  - id: A-005
    rel: extends
    file: ../architecture/20260505-telegraph-agent-runtime-extension-host-theory.md
  - id: A-008
    rel: related-to
    file: ../architecture/20260509-telegraph-final-process-architecture.md
  - id: D-015
    rel: extends
    file: ./20260520-agent-runtime-product-layer-alignment.md
  - id: P-007
    rel: related-to
    file: ../roadmap/20260521-agent-run-cockpit-implementation-plan.md
  - id: A-013
    rel: related-to
    file: ../architecture/20260522-telegraph-remote-agent-os-architecture.md
    note: A-013 将本文的 durable run 分层并入 Remote Agent OS 外部入口架构。
  - id: P-010
    rel: related-to
    file: ../roadmap/20260522-remote-agent-os-implementation-roadmap.md
    note: P-010 根据本文将实施顺序调整为 DurableRunLedger → RunBroker Projection → CLI/Mobile/Computer Use。
---

# Durable Execution 与 Agent Run Ledger 设想

> 本文沉淀一次关于 Telegraph agent 层引入 **durable execution** 的讨论。结论是：durable 不应成为新的 framework-first runtime 概念，而应围绕 `Run` 建成可持久化、可恢复、可审计的执行语义；外部 durable execution 库只能藏在 adapter / engine 层，不能替代 `RuntimeEvent` 作为 Telegraph 的核心观测协议。

## 1. 背景

当前 agent 体系已经有 durable 的基础材料：

- `packages/agent-protocol/src/runtime.ts` 定义了 `RunInput` / `AgentRunRequest` / `AgentRuntime`。
- `packages/agent-protocol/src/events.ts` 定义了统一的 `RuntimeEvent` / `AgentEvent`，包含 `run_started`、`model_request`、`tool_call`、`child_run_started` 等运行事实。
- `packages/agent/src/persistence/AgentRunRepository.ts:109-127` 已经有 file-backed run repository API：`createRun`、`appendEvent`、`listRunEvents`、`importRunBundle`、`markRunningRunsRecovered`。
- `apps/design/src/application/node/DesignRunStore.ts:7-86` 仍是内存态投影，pagelet 重启后会丢失 design run 列表和事件摘要。
- `apps/design/src/application/node/DesignPageletWorker.ts:129-164` 目前在 `for await` 中把 agent event 直接 emit 到 `DesignHarnessRunController`，尚未把 design run 主链路写入 durable run repository。
- `packages/agent/src/harness/AgentHarness.ts:224-230` 的 `traceSink` 是非阻塞观测通道，适合 trace，但不能作为强 durable 保证的唯一入口。

因此当前缺口不是“没有 durable 类型”，而是 **design/chat pagelet 的 run 主链路还没有统一写入 durable run ledger**。

## 2. Durable 不只是一件事

Agent 层的 durable 至少分四层，不能混为一谈：

| 层级 | 目标 | 当前可落地性 | 说明 |
|------|------|--------------|------|
| Durable Trace / Run Ledger | 记录发生过什么 | 高 | append-only 保存 `AgentEvent`，支持历史 run、trace、导出、回放投影 |
| Recovery Semantics | 崩溃后状态收敛 | 高 | 启动时把 orphan `queued/running` run 标记为 `runtime_recovery` 或 `recoverable` |
| Durable Resume / Checkpoint | 从中断点继续执行 | 中 | 需要 runtime 支持 checkpoint、thread id、可序列化状态 |
| Side-effect Idempotency | 工具副作用不重复执行 | 中到低 | 需要 tool call idempotency key、外部 API 幂等、文件补丁应用记录 |

第一阶段应优先做 **Run Ledger + Recovery**。这两项直接提升稳定性与可跟踪性，且与现有 `AgentRunRepository` 对齐。

真正的 resume 是更高阶能力。它要求 runtime 的内部状态可持久化，工具调用具备幂等或补偿策略，模型调用、文件写入、shell 命令等非确定性操作必须被隔离为 durable step / task。否则“恢复”会变成“重复执行副作用”。

## 3. 推荐形态

Durable run 主链路建议放在 pagelet 内，而不是 main / daemon：

```text
Renderer
  -> pagelet RPC sendAgent(request)
      -> DurableRunLedger.createRun(...)
      -> AgentHarness.run(...)
          -> RuntimeEvent stream
      -> DurableRunLedger.appendEvent(runId, event)
      -> DesignRunStore / live subscribers projection
      -> terminal event flush

Renderer
  -> pagelet RPC listAgentRuns / getAgentRun / listRunEvents
      -> DurableRunLedger projection
```

这个位置符合 A-008：Runtime / Extension Host 的承载边界在 Pagelet 内，renderer 只消费 pagelet 暴露的业务 service，main 不 import runtime implementation，daemon 不掌握 agent 业务状态。

### 3.1 强 durable 与非阻塞 trace 分层

`traceSink` 保持非阻塞是正确的，因为 trace 不应拖慢模型流。Durable run ledger 需要单独建模：

- `createRun` 应在 runtime 启动前完成。
- 生命周期事件、tool call/result、permission、child run、terminal event 应作为关键事件写入 ledger。
- 高频 `assistant_delta` / `model_event` 可批量写入，必要时做 rawRef 或 compact event，避免每个 token 都阻塞模型流。
- terminal 返回前应确保关键事件和最终状态已经落盘。

换句话说：**trace 可以降级，run ledger 不能丢关键生命周期事实**。

## 4. 与 RuntimeEvent 的关系

`RuntimeEvent` 仍应是 Telegraph 的核心事实协议。durable execution 库产生的内部 journal / workflow history 不应直接进入 UI 或 protocol union。

建议保持两层：

```text
Telegraph protocol
  Run / RuntimeEvent / ToolEvent / WorkflowEvent / PermissionEvent

Durable engine internals
  journal / workflow id / checkpoint id / durable step id / resume token
```

桥接规则：

- UI 和 extension 继续只看 `RuntimeEvent`。
- durable library 的 step / checkpoint 信息进入 `raw` 或单独 checkpoint repository。
- 如果未来新增一等 `checkpoint_saved` / `run_resumable` 事件，必须按 A-005 的 schemaVersion / golden fixture / unknown event fallback 规则处理。
- framework-specific 概念只存在 adapter 内，不能把 LangGraph graph 或 Restate journal 抬成 Telegraph 核心类型。

## 5. 库选型讨论

### 5.1 首推 Restate

Restate 与 Telegraph 的长期形态最贴近：

- TypeScript SDK 友好。
- 官方定位覆盖 durable workflows、AI agents、backend services。
- 通过 journal 保存已完成步骤，崩溃或重启后 replay journal 并跳过已完成步骤。
- 支持 durable steps、workflow key、signals、timers 与观测 UI。
- 单 binary / server 模式比 Temporal 轻，但仍是显式基础设施组件。

接入建议：先只在 `telegraph-subagents` 或 `design-build` 试点，封装成 `DurableRunEngine`，不要让 Restate 类型泄漏到 `agent-protocol`。

主要代价：引入 Restate server。按 A-008，它不能成为 renderer 直连对象；应由 pagelet 内 runtime adapter 调用，或作为清晰定义的本地基础设施服务由 pagelet 通过受控 client 使用。

### 5.2 DBOS 作为轻量备选

DBOS 的优势是“库式”接入，workflow / step 写在 TypeScript 代码中，依赖 Postgres 保存 checkpoint，恢复到最后完成的 step。它适合不想运维 Temporal 这类独立 workflow server，但接受 Postgres 的团队。

与本仓库的主要摩擦：

- DBOS 官方文档要求 DBOS library 和 DBOS workflows 不要被 Webpack / Vite / Rollup / esbuild 等 bundler 打包，需要 external 处理。
- Telegraph 当前 Electron utility process 由 Vite 构建，接入时必须验证 `vite.design.config.ts` / forge 打包外部化是否可靠。
- 还需要引入 Postgres，这与当前 file-backed repository / SQLite memory store 的轻量路径不同。

因此 DBOS 可以作为第二候选，但不适合作为不验证构建链的直接默认方案。

### 5.3 Temporal 作为重型生产方案

Temporal 是 durable execution 的成熟重型方案。它适合：

- 后续 Telegraph 把 agent execution 服务端化；
- 多 worker 分布式执行；
- 长时间后台任务；
- 强 SLA、审计与任务队列治理。

但对当前本地 Electron / pagelet utility process 来说，它带来的 server、worker、deterministic workflow 规则和部署复杂度都偏重。除非产品明确转向后台服务化，否则不应作为第一阶段接入库。

### 5.4 LangGraph 只适合 graph runtime 内部

LangGraph 官方 durable execution 依赖 checkpointer 和 thread id，并要求把非确定性操作与副作用包装成 task。这与 `telegraph-orchestrator` / `orchestrator-core` 类型 runtime 很契合。

但它不应成为 Telegraph agent 核心协议。正确边界是：

- graph runtime adapter 内部可使用 LangGraph checkpointer；
- adapter 对外仍 emit `RuntimeEvent`；
- Run Console / TracePanel 不直接依赖 graph-specific state；
- 其他 runtime 不被迫接受 graph / node / edge 语义。

### 5.5 Inngest / Trigger.dev / Hatchet 暂不作为首选

Inngest、Trigger.dev、Hatchet 都有 durable workflow 能力，但它们更像后台任务平台或云端 worker 平台。当前 Telegraph 是 local-first Electron + pagelet runtime 架构，第一阶段引入这类平台会把问题从“run ledger 缺失”变成“平台部署与 worker 生命周期治理”。

其中 Trigger.dev 官方 self-host 文档还明确列出 checkpoints 是 Cloud-only 特性，因此不适合作为本地 durable checkpoint 的默认依赖。

## 6. 分阶段落地建议

### Phase A：Run Ledger 接入 Design Pagelet

- 在 design pagelet 启动时创建 `FileAgentRunRepository`。
- `handleSendAgent` 启动前 `createRun`。
- `for await (event of agentHarness.run(...))` 中追加 `appendEvent`。
- `listAgentRuns` / `getAgentRun` 改为 repository projection，`DesignRunStore` 保留 live cache。
- pagelet boot 时调用 `markRunningRunsRecovered`。

验收：

- design run 结束后可在重启后查询。
- cancelled / failed / completed 都有 terminal status。
- pagelet crash 后 orphan running run 不再永久显示 running。

### Phase B：Durable Event Projection

- 从 persisted `AgentEvent` 投影 Design Run Console、subagent snapshots、artifact refs。
- live stream 与 persisted events 使用同一 projector，避免 UI 逻辑分叉。
- 高频 delta 支持 compact / batch 写入。

验收：

- Run Console 能从历史 event log 还原 timeline。
- child run / tool call / artifact patch 可定位到对应 runId / callId。

### Phase C：Durable Engine Spike

先不要全局替换 runtime。选一个高价值但可控的 runtime 做 spike：

- 候选 1：`design-build`，因为它天然多阶段、产物可引用、失败成本高。
- 候选 2：`telegraph-subagents`，因为它天然 parent / child run、parallel / chain、结果回流明显。

Spike 目标：

- 引入 `DurableRunEngine` 内部接口。
- Restate 作为第一候选 adapter。
- LLM call、tool call、artifact patch 作为 durable step。
- 每个 durable step 同步产生 `RuntimeEvent`。
- 所有 side effect 带 `runId + callId` idempotency key。

验收：

- 中途杀掉 pagelet 或 durable worker 后，恢复时不重复已完成 tool side effect。
- Run Console 可看出恢复点。
- 不破坏 A-008 pagelet boundary。

### Phase D：Resume 语义产品化

只有当 runtime 真正支持 checkpoint/resume 时，才开放 UI：

- `resumeRun(runId, checkpointId)`；
- `retryRun(runId, fromEventSeq?)`；
- `forkRun(runId, fromEventSeq?)`；
- `RuntimeCapabilityDescriptor.resume` 从 `unsupported/partial` 变为 `supported`。

对不支持 resume 的 runtime，只提供 retry/fork，不能伪装成原地恢复。

## 7. 关键风险

- **副作用重复执行**：文件写入、shell、API 调用必须有 callId / idempotency key 或补偿策略。
- **隐私与密钥落盘**：`model_request.raw`、tool input/output 可能包含 API key、文件内容或用户敏感信息，需要 redaction / encryption / retention policy。
- **schema migration**：durable event log 跨版本存在，`schemaVersion` 和 projection fallback 必须可靠。
- **背压**：不能让 trace / token delta 每条同步 fsync 拖慢模型流。
- **framework 泄漏**：Restate journal、DBOS workflow id、LangGraph checkpoint 都不能直接成为 UI 核心类型。

## 8. 当前结论

推荐路线：

1. 先用现有 `AgentRunRepository` 完成 pagelet-local durable run ledger。
2. 设计 `DurableRunEngine` 内部接口，不急着把具体库接到全局 runtime。
3. Restate 作为第一外部候选做 spike。
4. DBOS 作为 Postgres / external bundling 可接受时的轻量备选。
5. Temporal 留给未来服务端化或强分布式执行。
6. LangGraph checkpoint 只用于 graph runtime adapter 内部。

这条路线能先拿到稳定性和可跟踪性的确定收益，同时避免过早把 Telegraph 核心锁进某个 durable execution framework。
