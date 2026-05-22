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

状态：2026-05-22 已落地 `packages/run-protocol`、`packages/remote-protocol` 与
`packages/computer-use-protocol` 类型骨架和 golden fixtures；Shared RunBroker 公共类型已改为复用
`run-protocol` 并向后 re-export。

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

状态：Design pagelet ledger projection MVP 已于 2026-05-22 落地；DesignView 已可从 persisted event replay projector 水合历史 session。`FileAgentRunRepository` 已补齐 `appendEvents` batch primitive，可一次落盘多条 RuntimeEvent 并只更新一次 run record。chat/design pagelet 已接入 buffered ledger writer：高频 `assistant_delta` / `model_event` 可 batch，连续 assistant delta 可 compact，关键 lifecycle/tool/permission/terminal event 会触发 flush。Phase 1 尚需继续补齐跨 pagelet projector 收敛。

交付：

- Pagelet-local `DurableRunLedger`，可复用现有 `AgentRunRepository`。
- chat pagelet：`createRun`、`appendEvent`、terminal flush、orphan recovery。
- [x] design pagelet：将 `DesignRunStore` 从纯内存投影改为 ledger projection，并补充 `listAgentRunEvents`。
- [x] 高频 delta compact / batch 写入策略。
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

状态：2026-05-22 已在 Shared 落地 `RunBrokerStore`，覆盖 run intent、run projection subscription 与 approval request/decision；Design 与 Chat pagelet 已将 ledger summary projection bridge 到 Shared RunBroker。Projection subscription 已支持按 cursor replay change history，用于 CLI/外部入口断线后恢复控制面状态。RunBroker 控制面索引已接入 file-backed snapshot repository，持久化 intents/projections/projection history/approvals；RunProjection 也已携带 run-level `artifactRefs`，并由 chat/design pagelet 从 pagelet-local ledger event output 恢复 `mediaType` / `title` / `sizeBytes` / `sha256` 等 metadata，供远程入口生成 screenshot/artifact preview；pagelet-local ledger 仍是 runtime event 的 source of truth。

交付：

- [x] Shared `RunBrokerService`：
  - `createRunIntent`
  - `claimRunIntent`
  - `registerRunProjection`
  - `subscribeRunProjection`
  - `requestApproval`
  - `decideApproval`
- [x] Pagelet -> RunBroker 的 summary/projection bridge：Design 与 Chat pagelet 已接入。
- [x] Approval 状态统一存储和投递：Shared 状态与 file-backed snapshot 已接入；RunBroker 已支持 approval change history / subscription；remote-control relay 已可代理 `listApprovals` / `decideApproval` 并暴露 `subscribeApprovals` 推送流，CLI/MCP 已有本地远程审批入口；真实 Mobile/Telegram adapter 待实现。
- [x] Projection artifact refs：chat/design 从 pagelet-local ledger summary 索引 observation artifact refs，并通过 Shared RunBroker projection/history 持久化；projection bridge 会回看 ledger events 保留 artifact metadata。

验收：

- Desktop UI、未来 CLI/Mobile 可以按 `runId + cursor` 订阅 projection。
- approval 决策写入 RunBroker，同时由 pagelet ledger 记录对应 permission event。
- Shared 重启不影响 pagelet-local ledger 的完整性。

No-Go：

- RunBroker 不作为 durable event store 的唯一 source of truth。
- RunBroker 不调用 `runtime.run()`。

### Phase 3：CLI 与 MCP Gateway MVP

目标：本机 CLI 能发起、观察、审批和恢复 event stream。

状态：2026-05-22 已落地 `cli-gateway` headless Pagelet 与 `@telegraph/cli` 薄入口；local socket / named pipe gateway 由 `cli-gateway` 托管，并通过 Shared RPC 访问 RunBroker 的 intents、projections 与 approvals，避免外部 CLI 直接进入 Main/Shared/Daemon。root 已提供 `pnpm cli -- ...` 入口；`telegraph ask` 会创建 design intent，Design pagelet 已可 claim queued design intent 并执行；Chat pagelet 也已可 claim `targetPagelet=chat` 的 queued intent 并执行；`telegraph attach <runId>` 已支持订阅 projection 变化，并可用 `--after <cursor>` replay 断线期间的 projection history；`telegraph events <runId> --pagelet design|chat --after <seq>` 可读取 pagelet-local persisted event ledger；`telegraph open <runId>` 走 cli-gateway extension method，先查 RunBroker projection，再通过 pagelet→Main RPC 聚焦 Desktop Run Console 并传入目标 runId；`telegraph mcp` 已提供 stdio JSON-RPC MCP server，暴露 run intent、remote ExternalMessage submit/replies、run projection、run open、event ledger 与 approval tools。

交付：

- [x] `cli-gateway` headless Pagelet。
- [x] local socket / named pipe transport。
- [x] CLI 命令：

```bash
telegraph intent create --pagelet design "..."
telegraph ask "..."
telegraph runs
telegraph projection get <runId>
telegraph attach <runId>
telegraph approve <approvalId>
telegraph deny <approvalId>
telegraph pause|cancel|stop <runId>
```

- [x] `telegraph open <runId>`：通过 cli-gateway 打开 Run Console 并聚焦目标 run。
- [x] MCP gateway server：包含 RunBroker tools、run control tools、`telegraph_run_open` 与 `telegraph_remote_submit`（通过 remote-control local relay gateway）。

验收：

- [x] CLI 发起的 design intent 可由 Design pagelet claim 并执行；`targetPagelet=chat` intent 可由 Chat pagelet claim 并执行。
- [x] Desktop UI 发起的 run 可由 CLI attach projection。
- CLI 断线后可用 cursor 恢复事件流。
- approval 决策走 RunBroker，并同步进入 pagelet ledger 的 permission event。

No-Go：

- CLI 不直接连 Main/Shared/Daemon。
- CLI 不使用裸 Electron IPC。

### Phase 4：Run Console 与 Mobile/Telegram MVP

目标：远程入口可以安全触发任务，并由 Mobile/Telegram 完成基础审批。

交付：

- [x] Desktop Run Console MVP：main renderer 新增 `Runs` keep-alive 页面，聚合 chat/design pagelet-local ledger runs/events，并在 pagelet 未就绪时按 source 降级。
- [x] Remote Control Pagelet scaffold：headless Pagelet 已接入 Electron 启动链，提供 `ExternalMessage -> RunIntent` 桥接、queued `ChannelReply`、projection-derived `ChannelReply` outbox 与最小 device binding service；真实 Mobile/Telegram adapter 仍待实现。
- [x] Relay protocol v0：`remote-control` 已托管 local dev JSON-line socket gateway，`telegraph remote submit ...` 可发送标准 `ExternalMessage` 并创建 RunIntent；`telegraph remote replies ...` / MCP `telegraph_remote_replies_list` 可轮询 ChannelReply outbox；local relay socket 也支持 `subscribeChannelReplies` 推送 live `ChannelReply` 与初始 replay；adapter 可通过 `ackChannelReply` / `telegraph remote reply ack` / MCP `telegraph_remote_reply_ack` 标记投递 sent/failed/skipped，delivery state file-backed 持久化；`telegraph remote runs|projection get` 与 MCP remote run tools 可经 remote-control 代理 run list/projection；`telegraph remote approvals|approve|deny` 与 MCP remote approval tools 可经 remote-control 代理基础审批；`telegraph remote devices|device bind|device revoke` 与 MCP device tools 可管理 device binding；local relay socket 已暴露 `handleTelegramUpdate` 命令路由入口；self-host relay 仍待实现。
- Mobile MVP：
  - [x] device list protocol/storage：remote-control device bindings 已接入 file-backed repository，重启后可恢复绑定列表；CLI/MCP 已可 list/bind/revoke；真实 Mobile UI 待实现。
  - [x] run list protocol path：remote-control relay 已可代理 `listRunProjections` / `getRunProjection`；真实 Mobile UI 待实现。
  - [x] live status protocol path：remote-control local relay socket 已支持 `subscribeChannelReplies`，真实 Mobile/Telegram adapter 待实现。
  - approval inbox
  - [x] screenshot/artifact preview protocol path：RunProjection `artifactRefs` -> remote-control `ChannelReply.artifactRefs` 已打通；真实 Mobile UI 待实现。
- Telegram MVP：
  - [x] `/ask` local command router：Telegram update -> `ExternalMessage -> RunIntent`。
  - [x] `/runs` local command router：Telegram update -> remote-control run projection list。
  - [x] `/screen` local command router：Telegram update 会优先返回已有 RunProjection screenshot/artifact refs；无 artifact 时回退为 read-only screenshot prompt routed to chat pagelet；真实 Telegram Bot API 发送图片待实现。
  - [x] `/approve` local command router：Telegram update -> remote-control approval decision。
  - [x] `/deny` local command router：Telegram update -> remote-control approval decision。
  - [x] `/pause` / `/cancel` / `/stop` local command router：Telegram update -> Shared RunBroker run control command；协议已区分 pause、cancel、stop 的允许状态，pagelet 执行 subscriber 待接。

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

状态：2026-05-22 已落地 `packages/computer-use` 只读 observation broker：`ComputerUseBroker.observe()` 通过 provider 捕获 screenshot/window/accessibility/OCR payload，并强制写入 artifact store 后只返回 `ObservationArtifactRef`；默认提供 macOS `screencapture` 截图 provider 与 file-backed artifact store。macOS provider 已支持 desktop screenshot 与显式 `windowId` 的 app/window scoped screenshot（通过 `screencapture -l`），缺少 numeric windowId 时仍显式失败，避免把窄 scope 静默拓宽成全屏。Agent harness 已支持 runtime executable tools，`computer-observe` profile 会在 Pagelet capability layer 挂载只读 `computer.observe` tool，并按 profile scopes 校验 target；pi-ai embedded tool loop 返回 observation artifact refs。Pagelet-local ledger 会从 `tool_result.output.observations[].artifactRef` 索引 run-level artifact refs；Main 已注册只读 `telegraph://computer-use-artifacts/...` 协议 handler，Desktop Run Console 可从 persisted tool result 提取 artifact preview metadata 并加载本地截图；remote-control 已能把 projection artifact refs 转成 `ChannelReply.artifactRefs`，真实 Mobile preview UI 尚未实现。

交付：

- [x] `ComputerUseBroker.observe()`。
- [x] screenshot capture provider（macOS `screencapture`，artifact-backed）。
- [x] window list provider 接口与默认占位 artifact。
- [x] accessibility tree snapshot provider 接口。
- [x] OCR fallback 的接口占位。
- [x] observation artifact store。
- [x] `computer.observe` agent runtime tool：仅 observation，返回 artifact refs，不开放 action。
- [x] `computer.observe` target scope enforcement：`desktop:read` / `app:*` / `window:*` 等 profile scopes 先校验再 observe。
- [x] observation artifact refs 写入 pagelet-local run summary 索引。
- [x] `telegraph://computer-use-artifacts/...` 本地只读 artifact 协议 handler。
- [x] Desktop Run Console observation artifact preview。
- [x] Mobile screenshot preview protocol bridge：remote-control `ChannelReply` 已携带 projection artifact refs；真实 Mobile UI 待实现。

验收：

- [x] observation 进入 RuntimeEvent trace：pi-ai tool loop 会产生 `tool_call` / `tool_result`，payload 只包含 artifact refs。
- screenshot/accessibility payload 不直接塞进 event。
- [x] app/window scoped screenshot 不会被静默拓宽为 full-desktop；真实 scoped capture provider 待后续补齐。
- 未授权 app 不出现在 model context 中。

No-Go：

- 不开放 click/type/hotkey。
- 不把真实桌面 screenshot 默认上传 cloud relay。

### Phase 6：Computer Use 受控行动

目标：开放 click/type/hotkey/scroll，但必须有 policy、approval、lock 和审计。

状态：2026-05-22 已落地 `ComputerUseBroker.act()` 安全地基：动作默认要求 `approvalId`，未授权直接返回 `permission_denied`；真实动作只会通过注入的 `ComputerActionProvider` 执行，默认 provider 不启用真实桌面操作；broker 已具备单 action lock，重叠 action 会返回 `locked`。2026-05-23 补齐了 broker-level action budget、global stop gate、before/after screenshot observation refs、provider/observation 异常归一的 `ActionResult`、按 target/app/window/browser tab 拉高 approval 要求的策略基线，以及 broker-level 坐标/过期 observation ref 校验：normalized 坐标必须在 0..1，pixel 坐标必须声明 viewport bounds 且落在边界内，action 引用的 observation 超过 `maxObservationAgeMs` 会返回 `stale_ref`。这仍只是受控 action 的协议与安全门骨架，尚未接入 agent runtime tool、approval broker 与真实 click/type provider。

交付：

- [x] `ComputerUseBroker.act()` 安全骨架。
- [x] SafetyGate：默认要求 approval，限制 action kind。
- [x] per-app approval：broker policy 支持按 target/app/window/browser tab 要求 `approvalId`；UI/policy profile 接入待补。
- [x] machine-wide lock：broker 内单 action lock，防止并发真实桌面 action。
- [x] global stop：broker 可进入 stopped gate，后续 action 返回 `stopped`。
- [x] before/after observation：broker 默认围绕每个 approved action 记录 screenshot artifact refs。
- [x] action budget：broker 支持 per-run `maxActionsPerRun`，超限返回 `budget_exceeded`。
- [x] coordinate scaling / stale ref detection：broker 已有 normalized/pixel bounds 与 observation age 校验；真实显示缩放标定可在 provider 接入时继续细化。

验收：

- 同时只能有一个真实桌面 Computer Use session。
- 高风险 app 显示 sentinel warning。
- [x] action 失败可归因：permission denied / stale ref / coordinate mismatch / app hidden / timeout / locked / budget exceeded / stopped / unknown。
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

状态：2026-05-23 已在 `computer-use-protocol` 补齐隔离执行环境的协议 baseline：`ExecutionTargetDefinition`
描述真实桌面、isolated browser 与 VM target 的 trust level、network policy、profile sync 与 artifact transfer
边界；`selectExecutionTarget()` 可按“需要本地状态 / 互联网自动化 / 指定 target kind / domain allowlist”选择目标。
这仍是 target/provider 接入前的协议与策略层，不代表真实 isolated browser 或 VM runtime 已可启动。

交付：

- isolated browser target。
- VM desktop target。
- [x] profile sync 策略 baseline：协议只允许 `none` / `bookmarks-only` / `selected-cookies` / `managed-profile`，不提供同步完整主 Chrome profile 的默认路径。
- [x] domain allowlist。
- [x] network policy。
- [x] artifact export/import policy baseline：`ArtifactTransferPolicy` 区分 disabled、explicit approval 与 workspace-scoped transfer。

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

## 5. 后续 TODO 清单

> 本清单记录当前尚未完成、需要后续继续细化的事项。先保持 TODO 粒度，不在本节展开完整设计。

### Remote / Mobile / Telegram

- [ ] 实现 React Native Mobile App：device list、run list、live status、approval inbox、artifact/screenshot preview。
  RN App 只作为 remote-control 的移动端入口/控制面，不承载本地 agent runtime，也不直接访问 Main/Shared/Daemon。
- [x] 实现真实 Telegram Bot API adapter：`TELEGRAPH_TELEGRAM_BOT_TOKEN` 配置后 remote-control 会启动 Bot API polling；adapter 使用 `getUpdates` 拉取 update，调用现有 command router，再用 `sendMessage` / `sendPhoto` 投递回复。HTTP(S) image artifact 会走 `sendPhoto`，本地-only artifact 会降级为文本 artifact ref；webhook 模式待后续补。
- [x] 将 `handleTelegramUpdate` 从本地 socket 骨架接到真实 Telegram update intake：Bot API adapter 已复用同一 command router，socket `handleTelegramUpdate` 仍作为本地调试入口。
- [x] 定稿 Telegram `/pause` 的控制语义：`run-protocol` 新增 `RunControlCommandKind` / `RunControlCommandRecord` / `evaluateRunControlCommand()`，Shared RunBroker 持久化 control command 与 change history；Telegram `/pause`、`/cancel`、`/stop` 已路由为 accepted/rejected control command。
- [x] 将 accepted run control command 接入 chat/design pagelet 执行层：`cancel` / `stop` 会通过现有 AbortSignal/`AgentRunControl` 中断运行并回写 `applied`，控制命令同步进入 pagelet-local ledger 审计。
- [ ] 为 checkpoint-capable runtime 实现真正 `pause` / `resume`，当前 chat/design 收到 `pause` 只写入“不支持 checkpoint pause”的审计日志，不伪装成 applied。
- [x] Telegram `/screen` 支持发送 screenshot artifact，而不仅是提交 read-only observation prompt：本地 command router 已可从 RunProjection `artifactRefs` 返回带附件引用的 `ChannelReply`，真实 Bot API adapter 消费待实现。
- [x] 明确 Telegram group policy baseline：默认只允许 `/runs` 与已有 artifact 的 `/screen` 只读查询；写操作仍拒绝；`TELEGRAPH_TELEGRAM_ALLOWED_GROUPS` 可 allowlist 特定群开放本地命令路由写入口。管理员审批与审计仍待实现。
- [x] 实现 approval inbox 的远程推送：RunBroker approval change history / subscription 与 remote-control `subscribeApprovals` local relay stream 已落地；真实 Mobile/Telegram adapter 消费待实现。
- [x] 为 remote-control 增加 channel reply delivery ack / retry / sent marker：`ChannelReply` 已携带 delivery metadata；remote-control outbox 支持 file-backed delivery state，socket/CLI/MCP 可 ack sent/failed/skipped 并按 `deliveryStatus` 查询。

### Relay / Network

- [x] 设计并实现 self-host relay：新增 `@telegraph/relay-protocol`，定义 routing-only `SelfHostRelay` 边界与 `InMemorySelfHostRelay` 基线，只转发 `ExternalMessage` / `ChannelReply` / projection / approval control-plane envelope，不持有 desktop execution capability。
- [x] relay 断线恢复控制面基线：remote-control local relay gateway 已支持按 cursor 补发 `ChannelReply`、`RunProjectionChangeEvent` 与 `ApprovalRequestChangeEvent`；CLI/MCP 已暴露 `remote projection-changes` / `telegraph_remote_projection_changes_list` 等调试入口，真实 self-host relay 消费待实现。
- [x] relay 身份与设备绑定基线：remote-control 已有 file-backed device binding；`submitExternalMessage` 可按 adapter 选项强制要求 active binding，并拒绝 revoked/expired/actor mismatch 的已知 device；CLI/MCP remote submit 暴露 `requireDeviceBinding`。policy profile 与 relay session 级绑定仍待 self-host relay 接入时细化。
- [x] relay 安全策略基线：remote-control intake 已有 `messageId` replay protection 与 per-actor sliding-window rate limit；token rotation / local-only secret 留到 self-host relay transport 层实现。
- [x] 明确 cloud relay 与 enterprise self-host relay 的部署边界：`RelayBoundaryPolicy` / `deploymentBoundary()` 已把 local-dev、self-host、cloud 的 execution capability、secret boundary、payload persistence 与 audit/retention 责任显式化；cloud/self-host 均禁止持有 desktop execution capability。

### RunBroker / Approval / Ledger

- [x] approval 决策写入 pagelet-local ledger：chat/design pagelet 订阅 RunBroker approval changes；若 approval `proposedAction.permission` 是标准 `PermissionRequest`，回写 `permission_resolved`，否则回写带 raw approval 的 `runtime_log` 审计事件。
- [x] RunBroker approval subscription：Shared RunBroker 已持久化 approval change history 并支持 `subscribeApprovals`；remote-control relay 已代理该流。
- [x] RunBroker run control subscription：Shared RunBroker 已持久化 `pause/cancel/stop` control command 与 change history，local RunBroker gateway、remote-control relay、CLI/MCP 均可 request/list/replay；chat/design 已订阅 accepted command 并执行 cancel/stop。
- [x] RunProjection artifact metadata 增强：chat/design projection bridge 会从 tool result / run output 中恢复 `mediaType`、`sizeBytes`、`title`、`sha256`。
- [x] orphan/recovered run projection 收敛：chat/design pagelet 在 Shared 连接就绪后会发布 boot recovery 标记出的 recovered run projection，避免 Shared 继续显示陈旧 running。
- [x] 为 remote-control 的 ChannelReply outbox 增加可持久化 delivery state，而不是只从 intent/projection 重建。

### Computer Use

- [x] `computer.act` agent runtime tool：`computer-act` capability profile 会挂载 `computer.act`，工具接入 `ComputerUseBroker.act()`，支持 action/profile scope 限制，默认仍由 broker 要求 `approvalId`；真实 provider 仍未启用。
- [x] per-app approval：broker policy 支持按 target/app/window/browser tab 要求 `approvalId`；domain/profile 维度后续接 policy pack。
- [x] before/after observation：broker 默认自动记录操作前后 screenshot artifact refs。
- [x] global stop：broker 已有 stopped gate；后续仍需接 UI/remote 控制面。
- [x] action budget：broker 支持 per-run action count budget；后续仍需接 profile/policy 配置。
- [x] coordinate scaling / stale ref detection：broker 已有 normalized/pixel bounds 与 observation age 校验；真实 provider 接入后继续补显示缩放标定。
- [x] scoped screenshot provider：macOS provider 支持 numeric `windowId` 的 app/window scoped capture；缺少 windowId 时显式失败，不退化为 full desktop。
- [x] redaction pipeline：ComputerUseBroker 支持 target/app/window 级 redacted/denied observation policy；redacted 目标写本地占位 artifact，denied 目标在 provider 捕获前拒绝。
- [ ] 真实 click/type/hotkey/scroll provider：仅在 policy、approval、lock、trace 完备后启用。

### Durable Run Engine

- [x] 定义 `DurableRunEngine` interface 与 idempotency key 规范：`packages/agent/src/durable` 已提供 `DurableRunEngine` / `DurableStepLedger` / `durableIdempotencyKey()`，并有 ledger-backed baseline，completed step 会按 idempotency key 复用而不重复 side effect。
- [ ] 选择 spike 场景：优先 `design-build` 或 `telegraph-subagents`。
- [ ] Restate adapter spike；DBOS 作为备选评估。
- [x] durable step 到 RuntimeEvent 的同步映射：durable baseline 只使用既有 `step_started` / `step_completed` / `runtime_log`，通过 `raw.durable` 携带 kind/idempotencyKey/callId/input，不新增 framework-specific 事件类型。
- [x] kill/restart 后验证不重复执行已完成 side effect：`FileDurableStepLedger` 可持久化 completed step record，测试用新 engine/ledger 实例模拟重启，确认相同 idempotency key 不会再次执行 executor。
- [x] 明确 retry/fork/resume 的 UI 与协议边界，避免伪 resume：`run-protocol` 新增 `RunContinuationKind` / `RunContinuationCapabilities` / `evaluateRunContinuation()`，`resume` 只有 runtime 声明 `checkpointed` 才允许，retry/fork 明确是新 attempt / 新 run 语义。

### Slack / Team Governance

- [ ] Slack OAuth/app install 设计。
- [x] slash command、app mention、thread projection router baseline：`SlackCommandRouter` 可将 slash command / app mention 转为标准 `ExternalMessage`，并保留 Slack channel/thread 到 `ChannelReply.channelId/threadId`；真实 Slack Events API adapter 与 OAuth 待接。
- [x] Block Kit approval router baseline：Slack `block_actions` 的 `telegraph_approve` / `telegraph_deny` 可转为 RunBroker approval decision；真实 Block Kit message rendering 与 Slack signature verification 待接。
- [ ] workspace/user/device binding 与 team audit log。
- [ ] policy profiles：personal、team-readonly、team-operator、admin-approved。
- [ ] token revoke / user leave workspace 后的权限回收。

### Isolation / Sandbox

- [x] 隔离执行环境协议 baseline：`ExecutionTargetDefinition` 已统一描述真实桌面、isolated browser 与 VM target 的 trust/network/profile/artifact 边界。
- [ ] isolated browser target provider/runtime。
- [ ] VM desktop target provider/runtime。
- [x] target selection：`selectExecutionTarget()` 已支持真实桌面 / 隔离浏览器 / VM 的策略选择，互联网自动化默认偏向 isolated browser，需要本地状态时偏向真实桌面。
- [x] domain allowlist 与 network policy：`DomainNetworkPolicy` / `evaluateDomainNetworkPolicy()` 支持 offline、allowlist、restricted、open、blocked domain 与 wildcard domain。
- [x] artifact export/import policy：协议层已显式区分禁用、显式审批与 workspace-scoped transfer。
- [x] profile sync 策略：协议层禁止默认同步完整主 Chrome profile 或 home directory，只允许 bookmarks-only、selected-cookies、managed-profile 与 selected-path mount 语义。

### Ecosystem / SDK

- [x] 稳定 `telegraph mcp` tool schema 与版本策略：MCP tool descriptors 已统一带 `_meta.telegraph/toolSchemaVersion` 与 transport 标记；`telegraph mcp-schema` 可导出版本化 tool manifest，已覆盖 run intent、projection、approval、run control、remote relay、device binding 与 event ledger tools，方便外部 adapter 固定契约。
- [x] channel adapter SDK：新增 `@telegraph/channel-adapter-sdk`，第三方 adapter 通过版本化 `ChannelAdapterManifest` 声明 capability，并只依赖 `ExternalMessage` / `ChannelReply` / approval / projection / device binding host surface。
- [x] policy packs：`packages/agent/src/policy` 新增 versioned `PolicyPack` / `PolicyProfile`，可声明 task capability profile、workspace policy、Computer Use policy 与 remote binding/channel 策略，并提供 resolver/validator。
- [x] tool/capability marketplace：`packages/agent/src/marketplace` 新增 versioned `CapabilityMarketplaceListing` / `MarketplaceToolDefinition` 与 `InMemoryCapabilityMarketplace`，第三方 tool 必须声明 task capability、permission、approval policy 与 risk，高风险 tool 禁止 `approval=none`。
- [x] remote run templates：`run-protocol` 新增 versioned `RunTemplate` / `RunTemplateVariable` / `instantiateRunTemplate()`，支持 required/default variables、metadata merge 与 unresolved placeholder fail-fast。
- [ ] enterprise self-host relay packaging。

## 6. Repo 落点建议

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

## 7. 风险清单

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

## 8. 第一批 PR 建议

1. `packages/run-protocol` 类型骨架 + fixtures，明确 `RunBroker` / `DurableRunLedger` / `DurableRunEngine`。
2. chat/design 接入 pagelet-local `DurableRunLedger`，复用 `AgentRunRepository`。
3. `RunBrokerService` interface + run summary / approval projection，不做强 event ledger。
4. `cli-gateway` Pagelet + `telegraph ask/attach/runs`。
5. Desktop Run Console 同时读取 ledger history 与 broker projection。

这些完成后，Mobile、Telegram、Computer Use 都能在同一地基上生长，不会各自发明一套 session 或 recovery 语义。

## 9. 长期判断

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
