---
id: D-001
title: Multica 范式与 Pi / pi-subagents 生态下的 Telegraph 多智能体能力对比
description: >
  基于 multica 与 pi-subagents 的本地源码证据，系统比较控制平面、执行平面、角色编排、
  恢复与可观测性、隔离与扩展成本，并给出 Telegraph 在 Pi 生态优先前提下的目标形态、
  路径选择与阶段性落地建议。
category: discussion
created: 2026-05-04
updated: 2026-05-19
tags:
  - multi-agent
  - multica
  - pi
  - pi-subagents
  - orchestration
  - telegraph
status: draft
sources:
  - title: Multica（官网）
    url: https://multica.ai/
  - title: multica-ai/multica（GitHub）
    url: https://github.com/multica-ai/multica
  - title: Pi Coding Agent（官网）
    url: https://pi.dev/
  - title: nicobailon/pi-subagents（GitHub）
    url: https://github.com/nicobailon/pi-subagents
references:
  - id: A-002
    rel: related-to
    file: ../architecture/20260504-multi-process-topology.md
  - id: A-004
    rel: extended-by
    file: ../architecture/20260504-multica-implementation-map-and-telegraph-adaptation.md
  - id: P-001
    rel: related-to
    file: ../roadmap/20260504-multi-agent-telegraph-roadmap.md
  - id: A-005
    rel: extended-by
    file: ../architecture/20260505-telegraph-agent-runtime-extension-host-theory.md
  - id: D-014
    rel: extended-by
    file: ./20260519-chat-agent-team-multica-strategy.md
---

# Multica 范式与 Pi / pi-subagents 生态下的 Telegraph 多智能体能力对比

## 来源

- [Multica 官网](https://multica.ai/)
- [multica-ai/multica](https://github.com/multica-ai/multica)
- [Pi 官网](https://pi.dev/)
- [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents)

---

## 背景与评估口径

Telegraph 目标不是“只有流式输出”，而是可持续运行的 **multi-agent 协作能力**：角色可分配、任务可并行/链式、过程可观测、失败可恢复、状态可管理。

本文采用“多维能力 + 目标适配”方式比较：

- 控制平面（任务/权限/协作）
- 执行平面（runtime/队列/会话）
- 编排能力（角色/chain/parallel/async/fork）
- 可观测与恢复（事件、状态、orphan 回收）
- 隔离与安全（worktree、递归防护、工具边界）
- 集成成本与演进风险（对 Telegraph 现有代码与进程模型的冲击）

---

## 1. 基于源码的事实对照（关键证据）

### 1.1 Multica：平台化“控制平面 + 执行平面”分离

- `TaskService` 显式承载队列与状态流转，包含 `enqueue/claim/progress/complete/fail` 语义，同时接入实时 Hub 和事件总线（`server/internal/service/task.go`）。
- 任务事件有稳定协议名（`task:queued|dispatch|progress|completed|failed|message`），前后端都围绕这一协议构建（`server/pkg/protocol/events.go`）。
- daemon 启动时有 `RecoverOrphanedTasks`，并支持尽早 `PinTaskSession`，说明“崩溃恢复与会话续跑”是设计一等公民（`server/internal/handler/task_lifecycle.go`）。
- `execenv` 为每个任务创建独立目录和上下文注入能力（`workdir/output/logs`，可刷新复用），不是简单直接在仓库根执行（`server/internal/daemon/execenv/execenv.go`）。
- `realtime.Hub` 支持 scope 订阅与 authorizer，具备多用户、多工作区广播的基础骨架（`server/internal/realtime/hub.go`）。

### 1.2 Pi + pi-subagents：以“委派编排引擎”为核心

- `subagent` 工具同时支持 single / chain / parallel，且统一在扩展层入口实现（`pi-subagents/index.ts`、`subagent-executor.ts`）。
- 并发能力不是“多次调用拼接”，而是内建：parallel step、并发上限、failFast、结果聚合、链式 `previous` 传递（`chain-execution.ts`、`subagent-executor.ts`）。
- 提供 `context: fork`、`maxSubagentDepth`、嵌套防护，降低递归失控风险（`subagent-executor.ts`）。
- `worktree: true` 时会创建独立 git worktree、输出 patch diff，再统一清理，直接解决并行改同仓冲突（`worktree.ts`）。
- 异步模式有独立 runner 与 `status.json/events.jsonl`，可被前端/工具消费（`async-execution.ts`、README 的 async observability 约定）。

### 1.3 Telegraph 当前能力边界（与上述两者的差异）

- 现状是 “renderer 发起一次请求 -> daemon 调用 `PiAgent.send()` -> main sink 回传 `text_delta/error/done`”，属于单轮流式通道（`apps/telegraph/src/services/agent/electron-main/AgentHandler.ts`、`.../node/AgentStreamService.ts`、`.../electron-main/AgentStreamSink.ts`）。
- `PiAgent` 走 `@mariozechner/pi-ai` 的 `stream()`，并非 Pi CLI 会话编排（`packages/agent/src/PiAgent.ts`）。
- 事件模型目前只有 `text_delta | error | done` 三种，尚未形成 run/task 生命周期状态机（`apps/telegraph/src/services/agent/common/types.ts`）。

---

## 2. 多维度对比（面向“你真正要什么”）

| 维度 | Multica | Pi + pi-subagents | 对 Telegraph 的含义 |
|------|---------|-------------------|---------------------|
| 控制平面 | 原生 workspace、issue、assignee、权限、队列、活动流 | 无统一控制平面；重心是“父会话委派子会话” | 若你要“类 Jira + Agent 同事”，Multica 更近 |
| 执行平面 | daemon 统一调度多 CLI，具备 runtime 注册与健康语义 | 子进程编排强，但主要围绕 Pi 生态 | 若你坚持 Pi 生态，本地执行可先用 pi-subagents 路线 |
| 编排表达力 | 平台化任务流，偏业务流程 | chain/parallel/fork/worktree/async 非常强，偏工程流程 | 代码协作自动化场景（scout/planner/worker/reviewer）Pi 方案更快 |
| 恢复能力 | orphan recovery + session pin 是内建机制 | 有 async 状态与 session 路径，但“业务恢复策略”要自己补 | Telegraph 需要补 run registry 与重启恢复 |
| 实时可观测 | WebSocket + event protocol，团队协作可视化成熟 | TUI + 文件化状态，适合单机/会话内观察 | Electron UI 需自行把状态抽象为可视事件流 |
| 并发文件隔离 | 依赖执行环境与任务目录，非 worktree 主打 | worktree 一等能力，冲突治理明确 | Telegraph 并行代码任务建议优先接 worktree 能力 |
| 生态中立性 | 多厂商 CLI 原生统一后端 | 主要服务 Pi 扩展体系 | 若目标是“多执行器中立”，Multica 思路更有借鉴价值 |
| 接入成本 | 高（平台/数据/权限/生命周期） | 中（扩展级嵌入，重在进程管理与协议桥接） | Pi 路线更适合当前 Telegraph 的增量演进 |

---

## 3. 关键判断：你要“平台能力”还是“编排能力”

### 3.1 如果目标是“像 Multica 一样协作”

真正难点不在“能不能跑多个 agent”，而在：

- 任务主数据与状态机（谁可见、谁可重试、谁可接手）
- 队列/claim 语义与可恢复性
- 活动流与权限作用域

这部分是 Multica 最强项，也是目前 Telegraph 最薄弱部分。

### 3.2 如果目标是“在 Pi 生态下做强 multi-agent”

关键是把 pi-subagents 的“编排中枢能力”搬到 Telegraph 的 daemon 托管模式：

- 角色定义（markdown agent files）
- chain/parallel/fork/worktree
- async 状态文件 + UI 事件桥接

这条路在工程上更贴近你当前约束（本地优先 + Pi 生态）。

---

## 4. 对 Telegraph 的建议路径（Pi 优先前提）

### 4.1 目标形态（建议）

**短中期目标**：先做“Pi-native 编排器”，再决定是否升级为“协作平台”。

1. 在 daemon 内引入 run 抽象（runId、status、session、artifacts、startedAt/updatedAt）。
2. 接入 subagent 编排（single/chain/parallel），先支持核心角色流。
3. 接入 worktree 并发隔离与 async 状态观察。
4. UI 侧将事件从 `text_delta` 升级为 `run:*` / `step:*` / `artifact:*` 语义。

### 4.2 不建议直接做的事

- 不建议在当前阶段直接复制 Multica 的完整控制平面（范围过大，且和现有代码基线不连续）。
- 不建议继续停留在“只有一次 stream 通道”的实现形态，这会把 multi-agent 永久锁死在 demo 级能力。

### 4.3 何时考虑引入 Multica

当出现以下需求时，再考虑“对接/嵌入 Multica”：

- 多人协作、跨机器 runtime 管理、统一权限与审计
- 任务看板与活动流成为核心产品面
- 非 Pi 执行器要成为同等一等公民

---

## 5. 结论（当前版本）

- **Multica 本质是协作平台**（控制平面完备），不是单纯的“多 agent 执行器”。
- **pi-subagents 本质是编排引擎**（委派、并发、隔离、异步很强），但缺乏平台级治理模型。
- 在你明确“基于 Pi 生态”这个前提下，Telegraph 的正确切入点应是：  
  **先做 Pi-native 多角色编排与可观测 run 系统，再视产品需求决定是否引入 Multica 控制平面能力。**
- 该结论与实现映射见 [A-004](../architecture/20260504-multica-implementation-map-and-telegraph-adaptation.md)，与阶段计划见 [P-001](../roadmap/20260504-multi-agent-telegraph-roadmap.md)。

本文保持 `draft`，作为后续架构与 roadmap 收敛的讨论基线。
