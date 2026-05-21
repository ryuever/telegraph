---
id: P-007
title: Agent Run Cockpit 可跟踪实施计划
description: >
  将 Chat 从消息流升级为本地 agent run cockpit：先落 Run Registry 与 Run Console，
  再接 Runtime Capability Matrix、Permission Approval、Team Router v0 与 Replay/Fork。
category: roadmap
created: 2026-05-21
updated: 2026-05-21
tags:
  - chat
  - run-registry
  - run-console
  - agent-team
  - permission
  - runtime-cockpit
status: wip
references:
  - id: A-005
    rel: extends
    file: ../architecture/20260505-telegraph-agent-runtime-extension-host-theory.md
  - id: A-008
    rel: constrained-by
    file: ../architecture/20260509-telegraph-final-process-architecture.md
  - id: A-012
    rel: extends
    file: ../architecture/20260520-telegraph-harness-extension-architecture.md
  - id: D-014
    rel: implements
    file: ../discussion/20260519-chat-agent-team-multica-strategy.md
  - id: D-015
    rel: constrained-by
    file: ../discussion/20260520-agent-runtime-product-layer-alignment.md
  - id: P-004
    rel: extends
    file: ./20260518-agent-protocol-pagelet-harness-plan.md
  - id: P-006
    rel: extends
    file: ./20260518-harness-capability-extension-plan.md
---

# Agent Run Cockpit 可跟踪实施计划

> 目标：把 Chat 的下一阶段落点从“支持 agent team + tools integration”收敛为可观察、可治理、可复盘的本地 run cockpit。所有实现保持 pagelet-local runtime 边界：renderer 只通过 chat pagelet RPC 查询 run 数据，main/shared/daemon 不 import runtime implementation。

## Phase A：Run Registry MVP

- [x] 定义 `AgentRunRecord`、`AgentRunEventRecord` 与 repository API。
- [x] 实现 pagelet-node 可用的 file-backed run repository：record JSON + event JSONL。
- [x] 支持 create / append event / status update / list / get / orphan recovery。
- [x] 将 ChatPageletWorker 的 send lifecycle 写入 repository。
- [x] 在 chat RPC contract 暴露 list/get run 与 list run events。

验收：

- [x] 普通 chat run 结束后可查询 run record 与 event 列表。
- [x] cancel / failed / completed 都能落 terminal 状态。
- [x] 进程重启后 orphan running run 可标记为 `runtime_recovery`。

## Phase B：Run Console MVP

- [x] renderer 增加 run repository client/service。
- [x] `LlmTracePanel` 增加 Run Console 视图：run list、status、runtime/model、event count。
- [x] 选择 run 后可加载该 run 的 persisted events，并投影到现有 timeline/raw inspector。
- [x] 保留 live trace，避免破坏当前 Chat 工作流。

验收：

- [x] 用户能在 Chat 右侧面板看到历史 run。
- [x] 点击 run 能看到已持久化的 runtime events。
- [x] live trace 与 persisted run 不互相覆盖。

## Phase C：Runtime Capability Matrix

- [x] 定义 runtime capability descriptor。
- [x] 为 `pi-ai`、`pi-embedded`、`telegraph-subagents`、`telegraph-orchestrator` 暴露 descriptor。
- [x] settings / run header 显示 raw trace、tool approval、child run、resume、MCP、skills 等能力差异。
- [x] 禁用当前 runtime 不支持的 UI 操作。

## Phase D：Permission Approval

- [x] 将 `PermissionBroker.prompt` 从默认 deny 接到 pagelet-local approval request。
- [x] renderer 显示 permission pending card / modal。
- [x] 用户 approve / deny 后恢复 run。
- [x] Run Console 显示 permission request / resolution 与来源。

## Phase E：Team Router v0

- [x] 定义 `TeamSpec`、`TeamMemberSpec`、`TeamRouteDecision`。
- [x] 将 Telegraph native subagents 的 chain/parallel 执行入口收敛为 router-first 决策。
- [x] leader 只负责 route / clarify / direct，不引入复杂 DAG builder。
- [x] child run、routing rationale 与 handoff artifact 进入 Run Console 的 RuntimeEvent 流。

已落地：

- `telegraph-subagents` 运行时先执行 Team Router v0，再将 `single` / `parallel` / `review` 适配到现有 orchestrator。
- `direct` / `clarify` 不启动 child run；错误的 direct/clarify 工具调用也不会落回默认委派。
- 默认 chain 偏好现在收敛为 `worker -> reviewer` 的 review handoff，旧四段 scout/planner/worker/reviewer 不再作为默认 fallback。
- Run Console 可看到 `Team Router` step，包含 team spec、decision、task count 与 route summary。

## Phase F：Replay / Fork / Compare

- [x] 支持 manual rerun fresh session。
- [x] 支持 infrastructure retry 继承 session。
- [x] 支持 run-level fork 到新 session。
- [x] 支持从具体 step / child run fork。
- [x] 支持 runtime/model/team compare 视图。
- [x] 支持 export trace bundle。
- [x] 支持 import trace bundle。

已落地：

- `AgentRunRecord` 保存可复放的 `input.message` 与 `replay` 来源元数据。
- Run Console 对选中 run 暴露 `Rerun`、`Retry`、`Fork`、`Export`。
- persisted timeline 的 step / child-run 节点暴露 `Fork`，并记录 `sourceEventSeq` / `sourceChildRunId`。
- 选中 run 后显示轻量 compare 面板，对比 status、runtime、model、team、event count。
- replay/fork 继续走现有 chat pagelet `send` 流，不新增 RuntimeEvent 类型。
- export 生成包含 run record 与 event JSONL 投影的 trace bundle。
- import 接收同一 bundle schema，写回 pagelet-local run repository；本地已有同 runId 时不覆盖。
- import 使用共享 validator 校验 schemaVersion、run metadata、event record 一致性、event/run id 一致性。
- replay/fork 前提示当前 settings 与原 run 的 provider/model/backend/team/permission profile 差异。

## 当前执行切片

当前已执行到 Phase F：Run Registry MVP + Run Console MVP + Runtime Capability Matrix + Permission Approval + Team Router v0 + Replay/Fork/Compare/Export/Import。下一步进入收敛与硬化：trace bundle 导入冲突处理、权限决策复用策略、以及更细的 compare diff。
