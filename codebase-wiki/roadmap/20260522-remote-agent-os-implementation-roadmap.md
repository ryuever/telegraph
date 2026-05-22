---
id: P-010
title: Remote Agent OS 能力象限与实施路线图
description: >
  基于 A-013 的 Remote Agent OS 目标架构，定义 CLI、Mobile、Telegram、
  Slack、MCP、Computer Use、Relay、Sandbox 与 DurableRunLedger 的能力取舍、
  技术象限、分阶段实施路径、验收标准和风险控制。
category: roadmap
created: 2026-05-22
updated: 2026-05-22
tags:
  - remote-control
  - roadmap
  - cli
  - mobile
  - computer-use
  - run-ledger
  - durable-execution
  - slack
  - telegram
  - mcp
  - relay
status: draft
references:
  - id: A-013
    rel: derived-from
    file: ../architecture/20260522-telegraph-remote-agent-os-architecture.md
  - id: P-007
    rel: related-to
    file: ./20260521-agent-run-cockpit-implementation-plan.md
  - id: A-012
    rel: related-to
    file: ../architecture/20260520-telegraph-harness-extension-architecture.md
  - id: D-017
    rel: related-to
    file: ../discussion/20260522-durable-execution-agent-run-ledger.md
---

# Remote Agent OS 能力象限与实施路线图

> 本文是 [A-013](../architecture/20260522-telegraph-remote-agent-os-architecture.md) 的实施路线图。
> 目标是把 Telegraph 从桌面 agent 工作台推进为 local-first Remote Agent OS：外部入口统一产生 run，
> 桌面端统一执行与审计，Computer Use 作为分层执行兜底。

## 1. 决策摘要

优先押注：

- `RunBroker Projection + RuntimeEvent + ApprovalRequest`：所有入口共用的控制面协议地基。
- `DurableRunLedger`：Pagelet-local 的强 durable event ledger，优先级高于外部入口扩展。
- CLI：最快形成开发者闭环，也能为 MCP/外部 agent 提供桥接。
- Mobile approval：远程控制的安全体验中心。
- 分层 Computer Use：API/MCP/DOM/Accessibility 优先，vision/raw input 兜底。
- Ledger / Trace / Audit：从第一天就是核心能力，不是后补。

谨慎推进：

- 完整实时远程桌面：只作为 debug/接管能力，不做 P0 核心。
- Slack team workflow：价值高，但放在身份/审计/approval 稳定之后。
- Cloud SaaS relay：需要隐私与企业策略，先抽象协议，避免早期被云实现锁死。

明确不做：

- 外部 channel 直接调用 Main/Shared/Daemon。
- 让 Computer Use 成为所有任务默认路径。
- cloud relay 持有本机执行权限。

## 2. 技术象限

```text
Quadrant A: Entry Surfaces
  CLI / Mobile / Telegram / Slack / Webhook / MCP

Quadrant B: Runtime Core
  DurableRunLedger / RunBroker / RuntimeEvent / Approval / Trace / Replay

Quadrant C: Execution Layer
  API/MCP / Browser DOM-CDP / Accessibility / OCR-Vision / Raw Input

Quadrant D: Trust & Ops
  Identity / Policy / Audit / Relay / Sandbox / Metrics / Retention
```

推进顺序：

```text
DurableRunLedger -> RunBroker Projection -> A(CLI) -> A(Mobile/Telegram)
  -> C(read-only) -> C(actions) -> DurableRunEngine Spike -> D(team/relay/sandbox)
```

理由：没有 pagelet-local ledger，入口只能看到临时 stream；没有 approval/event projection，Computer Use 越强越危险。

## 3. 能力价值评估

| 能力 | 价值 | 复杂度 | 优先级 | 结论 |
|------|------|--------|--------|------|
| DurableRunLedger | 极高 | 中 | P0 | 必须先做，保证 run 事实可恢复、可审计、可 projection。 |
| RunBroker Projection | 极高 | 中 | P1 | 承接入口路由、run 索引、订阅聚合和 approval。 |
| CLI | 极高 | 中 | P2 | 开发者闭环与 MCP 桥接基础。 |
| Desktop UI Trace | 高 | 中 | P1 | 让所有外部 run 可见、可复盘。 |
| Mobile approval | 高 | 中高 | P3 | 远程控制的安全体验核心。 |
| Telegram | 中高 | 低中 | P3 | 个人遥控最快 MVP。 |
| Computer Use observation | 高 | 中 | P3 | 先只读 observation，降低风险。 |
| Computer Use action | 高 | 高 | P4 | 必须 policy/approval/lock 完备后开放。 |
| DurableRunEngine | 中高 | 高 | P5 | 只在 design-build/subagents 试点，不进全局默认路径。 |
| Slack | 中高 | 高 | P5 | 团队协作强，但 OAuth/审计复杂。 |
| Cloud Relay | 高 | 高 | P5 | 跨网络必须有，但权限不能上云。 |
| Isolated Browser / VM | 高 | 高 | P6 | 高风险互联网任务的长期安全边界。 |
| Remote desktop streaming | 中 | 高 | P6+ | debug/接管能力，不是主线。 |
| Webhook | 中 | 低 | P3/P4 | 只给低权限 profile。 |

## 4. 分阶段路线

### Phase 0：协议地基

目标：定义跨入口、跨 Pagelet、跨外部 adapter 的最小稳定协议。

交付：

- `packages/run-protocol`
  - `RunIntent`
  - `RunRecord`
  - `RunEventRecord`
  - `RuntimeEventEnvelope`
  - `ApprovalRequest`
  - `EventCursor`
  - `RunRecoveryStatus`
- `packages/remote-protocol`
  - `ExternalMessage`
  - `RemoteActor`
  - `ChannelReply`
  - `DeviceBinding`
- `packages/computer-use-protocol`
  - `ComputerTarget`
  - `Observation`
  - `ComputerAction`
  - `ActionResult`

验收：

- 协议类型不引用 Slack/Telegram/OpenAI/Anthropic 的 framework-specific payload。
- 所有大 payload 通过 `rawRef` / `artifactRef` 外置。
- 每个 event 带 `runId`、`source`、`cursor`、`ts`、`schemaVersion`。
- 明确 `RunBroker`、`DurableRunLedger`、`DurableRunEngine` 三个名字和职责。

No-Go：

- 不实现 action executor。
- 不接入真实 Slack/Telegram。
- 不跑 Computer Use。
- 不引入 Restate / DBOS / Temporal 作为全局依赖。

### Phase 1：Pagelet-local DurableRunLedger

目标：先让 chat/design 的 run 事实可持久化、可恢复查看、可 projection。

交付：

- Pagelet-local `DurableRunLedger`，可复用现有 `AgentRunRepository`。
- chat pagelet：`createRun`、`appendEvent`、terminal flush、orphan recovery。
- design pagelet：将 `DesignRunStore` 从纯内存投影改为 ledger projection。
- 高频 delta compact / batch 写入策略。
- `markRunningRunsRecovered` 在 pagelet boot 时执行。

验收：

- chat/design run 结束后可在 pagelet 重启后查询。
- cancelled / failed / completed 都有 terminal status。
- pagelet crash 后 orphan `queued/running` run 不再永久显示 running。
- live stream 与 persisted events 使用同一 projector。

No-Go：

- 不把每条 runtime event 同步写到 Shared。
- 不把 traceSink 当作 durable ledger。
- 不开放 resume UI。

### Phase 2：RunBroker Projection 与 Approval Broker

目标：Shared 只做控制面和聚合，不进入 pagelet runtime 的高频写入路径。

交付：

- Shared `RunBrokerService`：
  - `createRunIntent`
  - `claimRunIntent`
  - `registerRunSummary`
  - `subscribeRunProjection`
  - `requestApproval`
  - `decideApproval`
- Pagelet -> RunBroker 的 summary/projection bridge。
- Approval 状态统一存储和投递。

验收：

- Desktop UI、未来 CLI/Mobile 可以按 `runId + cursor` 订阅 projection。
- approval 决策写入 RunBroker，同时由 pagelet ledger 记录对应 permission event。
- Shared 重启不影响 pagelet-local ledger 的完整性。

No-Go：

- RunBroker 不作为 durable event store 的唯一 source of truth。
- RunBroker 不调用 `runtime.run()`。

### Phase 3：CLI 与 MCP Gateway MVP

目标：本机 CLI 能发起、观察、审批和恢复 event stream。

交付：

- `cli-gateway` headless Pagelet。
- local socket / named pipe transport。
- CLI 命令：

```bash
telegraph ask "..."
telegraph attach <runId>
telegraph approve <approvalId>
telegraph deny <approvalId>
telegraph runs
telegraph open <runId>
```

验收：

- CLI 发起的 run 可在 Desktop UI 打开。
- Desktop UI 发起的 run 可由 CLI attach。
- CLI 断线后可用 cursor 恢复事件流。
- approval 决策走 RunBroker，并同步进入 pagelet ledger 的 permission event。

No-Go：

- CLI 不直接连 Main/Shared/Daemon。
- CLI 不使用裸 Electron IPC。

### Phase 4：Run Console 与 Mobile/Telegram MVP

目标：远程入口可以安全触发任务，并由 Mobile/Telegram 完成基础审批。

交付：

- Remote Control Pagelet。
- Relay protocol v0：local dev relay 或 self-host relay。
- Mobile MVP：
  - device list
  - run list
  - live status
  - approval inbox
  - screenshot/artifact preview
- Telegram MVP：
  - `/ask`
  - `/runs`
  - `/screen`
  - `/approve`
  - `/deny`
  - `/pause`

验收：

- Telegram 私聊可发起 run，Mobile 可审批同一个 run。
- Mobile 发起 run，Desktop UI 与 CLI 可 attach。
- Relay 断开后 run 不丢，恢复后补发状态。
- 所有远程 run 都能回查 pagelet-local persisted event ledger。

No-Go：

- Telegram group 默认不开放写操作。
- Relay 不保存原始屏幕流。

### Phase 5：Computer Use 只读 Observation

目标：让 agent 能看见桌面状态，但不能行动。

交付：

- `ComputerUseBroker.observe()`。
- screenshot capture。
- window list。
- accessibility tree snapshot。
- OCR fallback 的接口占位。
- observation artifact store。
- Desktop/Mobile screenshot preview。

验收：

- observation 进入 RuntimeEvent trace。
- screenshot/accessibility payload 不直接塞进 event。
- 可按 app/window scope 做过滤。
- 未授权 app 不出现在 model context 中。

No-Go：

- 不开放 click/type/hotkey。
- 不把真实桌面 screenshot 默认上传 cloud relay。

### Phase 6：Computer Use 受控行动

目标：开放 click/type/hotkey/scroll，但必须有 policy、approval、lock 和审计。

交付：

- `ComputerUseBroker.act()`。
- SafetyGate。
- per-app approval。
- machine-wide lock。
- global stop。
- before/after observation。
- action budget。
- coordinate scaling。

验收：

- 同时只能有一个真实桌面 Computer Use session。
- 高风险 app 显示 sentinel warning。
- action 失败可归因：permission denied / stale ref / coordinate mismatch / app hidden / timeout。
- 每个 action 可在 trace 中复盘“看到了什么、决定了什么、做了什么、结果是什么”。

No-Go：

- 不允许外部 channel 绕过 approval。
- 不允许无限循环 action。
- 不允许 critical 动作只靠 group chat approval。

### Phase 7：DurableRunEngine Spike

目标：验证真正的 checkpoint/resume/side-effect idempotency，但不全局替换 runtime。

候选：

- `design-build`：多阶段、产物可引用、失败成本高。
- `telegraph-subagents`：parent/child run、parallel/chain、结果回流明显。

交付：

- 内部 `DurableRunEngine` interface。
- Restate adapter spike，DBOS 作为备选评估。
- LLM call、tool call、artifact patch 作为 durable step。
- `runId + callId` idempotency key。
- 每个 durable step 同步产生 `RuntimeEvent`。

验收：

- 中途 kill pagelet 或 durable worker 后，恢复不重复已完成 tool side effect。
- Run Console 能显示恢复点。
- Restate/DBOS/LangGraph checkpoint 不进入 `agent-protocol` 顶层类型。

No-Go：

- 不把 Restate/DBOS/Temporal 变成默认 runtime 依赖。
- 不把 retry/fork 伪装成 resume。
- 不开放 resume UI，除非 runtime capability 标为 supported。

### Phase 8：Slack 与团队治理

目标：把 Remote Agent OS 带入团队工作流。

交付：

- Slack OAuth / app install。
- slash command 与 app mention。
- thread projection。
- Block Kit approval。
- workspace/user/device binding。
- team audit log。
- policy profile：
  - personal
  - team-readonly
  - team-operator
  - admin-approved

验收：

- 每个 Slack run 有 thread、actor、device、policy、approval trail。
- Slack Events API ack 与异步执行解耦。
- 用户离开 workspace 或 token revoke 后失去入口权限。

No-Go：

- Slack bot 不默认拥有所有 desktop capability。
- Slack channel message 不直接变成 shell/Computer Use action。

### Phase 9：隔离执行环境

目标：将高风险互联网任务从真实桌面迁入隔离 target。

交付：

- isolated browser target。
- VM desktop target。
- profile sync 策略。
- domain allowlist。
- network policy。
- artifact export/import。

验收：

- 用户可选择“真实桌面 / 隔离浏览器 / VM”。
- 默认互联网自动化优先进入 isolated browser。
- 真实桌面 Computer Use 变成“需要本地状态或 GUI-only app 时才使用”。

No-Go：

- 不把用户主 Chrome profile 无限制同步到云端浏览器。
- 不在 VM 中默认挂载完整 home directory。

### Phase 10：生态化

目标：让 Telegraph 成为可扩展的 Remote Agent OS 平台。

交付：

- `telegraph mcp` 稳定版。
- channel adapter SDK。
- policy packs。
- tool/capability marketplace。
- remote run templates。
- enterprise self-host relay。

验收：

- 第三方 adapter 能接入 ExternalMessage/ChannelReply，而不用 import Telegraph 内部服务。
- 第三方 tool 必须声明 capability 与 approval policy。
- 企业可审计所有 tool action。

## 5. Repo 落点建议

```text
packages/run-protocol/
  src/run.ts
  src/events.ts
  src/approval.ts
  src/cursor.ts

packages/remote-protocol/
  src/external-message.ts
  src/channel-reply.ts
  src/device.ts
  src/actor.ts

packages/computer-use-protocol/
  src/target.ts
  src/observation.ts
  src/action.ts
  src/result.ts

apps/remote-control/
  src/main.ts
  src/application/node/RemoteControlBootstrap.ts
  src/services/channel-projection/
  src/services/approval/

apps/cli-gateway/
  src/main.ts
  src/application/node/CliGatewayBootstrap.ts
  src/services/local-endpoint/

apps/telegraph/src/services/main-host/
  DesktopPrimitiveService.ts

apps/shared/src/services/run-broker/
  RunBrokerService.ts
  RunIndexRepository.ts
  ApprovalRepository.ts

packages/agent/src/persistence/
  AgentRunRepository.ts          # Pagelet-local DurableRunLedger baseline

packages/agent/src/durable/
  DurableRunEngine.ts            # optional spike boundary
  idempotency.ts
```

如果当前 from-zero 实现还没有 `apps/shared`，第一步可以先在现有 design/chat pagelet 内做 file-backed prototype，
但接口应按 Shared service 归属设计，避免后续迁移破坏协议。

## 6. 风险清单

| 风险 | 表现 | 缓解 |
|------|------|------|
| 入口膨胀 | 每个 channel 一套执行逻辑 | 统一 ExternalMessage / RunIntent / ChannelReply。 |
| Computer Use 失控 | 模型误点、误发、误删 | 分层执行、approval、lock、budget、trace。 |
| Relay 权限过大 | 云端变成远控中心 | relay 只路由，不持有 desktop execution capability。 |
| Ledger 后补困难 | 事故后无法复盘 | Phase 1 就落 pagelet-local DurableRunLedger。 |
| RunBroker 过重 | Shared 被放进模型流关键路径 | RunBroker 只做 projection/index/approval，event source of truth 在 Pagelet。 |
| Resume 误导用户 | retry/fork 被包装成原地恢复 | 只有 runtime checkpoint + side-effect idempotency 成立才开放 resume。 |
| Slack 企业复杂度 | OAuth/token/workspace 边界混乱 | Slack 放 Phase 8，先用 Mobile/Telegram 验证模型。 |
| 真实桌面隐私 | screenshot 泄漏敏感数据 | app/window scope、redaction、local-only artifact。 |
| Pagelet 边界被绕过 | CLI/remote 直接碰 Main | cli-gateway/remote-control 都作为 Pagelet gateway。 |

## 7. 第一批 PR 建议

1. `packages/run-protocol` 类型骨架 + fixtures，明确 `RunBroker` / `DurableRunLedger` / `DurableRunEngine`。
2. chat/design 接入 pagelet-local `DurableRunLedger`，复用 `AgentRunRepository`。
3. `RunBrokerService` interface + run summary / approval projection，不做强 event ledger。
4. `cli-gateway` Pagelet + `telegraph ask/attach/runs`。
5. Desktop Run Console 同时读取 ledger history 与 broker projection。

这些完成后，Mobile、Telegram、Computer Use 都能在同一地基上生长，不会各自发明一套 session 或 recovery 语义。

## 8. 长期判断

Telegraph 的护城河不在“能不能点鼠标”。鼠标键盘只是最后一个执行面。

更值得持续投入的是：

- run lifecycle 的一致性。
- 多入口投影。
- approval 与权限治理。
- trace/replay/fork。
- durable run ledger 与明确的 recovery/resume 边界。
- pagelet-local runtime 隔离。
- structured tools 与 Computer Use fallback 的组合。

如果这些成立，Telegraph 可以同时覆盖开发者 CLI、个人移动遥控、团队 Slack 工作流和 GUI-only 自动化，而不会退化成一个脆弱的聊天机器人或远程桌面壳。
