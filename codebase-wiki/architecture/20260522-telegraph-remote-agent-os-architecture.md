---
id: A-013
title: Telegraph Remote Agent OS 与外部控制架构
description: >
  将 Mobile、CLI、Slack、Telegram、Webhook、MCP 与 Computer Use 统一纳入
  Telegraph local-first agent host 的目标架构：外部入口只产生 RunIntent，
  桌面端 Pagelet 承载 Runtime/Tool/Permission 与 DurableRunLedger，Shared
  RunBroker 负责入口路由、索引、订阅聚合与审批，Computer Use 作为分层执行兜底。
category: architecture
created: 2026-05-22
updated: 2026-05-22
tags:
  - remote-control
  - mobile
  - cli
  - slack
  - telegram
  - computer-use
  - run-broker
  - run-ledger
  - durable-execution
  - approval
status: draft
sources:
  - title: OpenAI Computer Use API
    url: https://developers.openai.com/api/docs/guides/tools-computer-use
  - title: OpenAI Computer-Using Agent
    url: https://openai.com/index/computer-using-agent/
  - title: Anthropic Computer Use Tool
    url: https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool
  - title: Claude Code Computer Use
    url: https://code.claude.com/docs/en/computer-use
  - title: Slack Events API
    url: https://docs.slack.dev/apis/events-api/
  - title: Telegram Bot API
    url: https://core.telegram.org/bots/api
  - title: Touchpoint Desktop Accessibility API
    url: https://github.com/Touchpoint-Labs/touchpoint
  - title: OSWorld Benchmark
    url: https://arxiv.org/abs/2404.07972
  - title: OS-Harm Benchmark
    url: https://arxiv.org/abs/2506.14866
references:
  - id: A-008
    rel: extends
    file: ./20260509-telegraph-final-process-architecture.md
  - id: A-005
    rel: related-to
    file: ./20260505-telegraph-agent-runtime-extension-host-theory.md
  - id: A-012
    rel: related-to
    file: ./20260520-telegraph-harness-extension-architecture.md
  - id: P-007
    rel: related-to
    file: ../roadmap/20260521-agent-run-cockpit-implementation-plan.md
  - id: P-010
    rel: derives
    file: ../roadmap/20260522-remote-agent-os-implementation-roadmap.md
  - id: D-017
    rel: related-to
    file: ../discussion/20260522-durable-execution-agent-run-ledger.md
    note: D-017 细化本文中 RunBroker / DurableRunLedger / DurableRunEngine 的 durable execution 分层。
---

# Telegraph Remote Agent OS 与外部控制架构

> 本文沉淀一次围绕 Mobile、Telegram、Slack、CLI、MCP 与 Computer Use 的产品架构讨论。结论是：
> Telegraph 不应被设计成远程桌面工具，而应成为 local-first Agent OS。桌面端是可信执行宿主，
> 外部入口只是会话与审批表面，Computer Use 是最后一公里执行能力。

## 来源

- [OpenAI Computer Use API](https://developers.openai.com/api/docs/guides/tools-computer-use)
- [OpenAI Computer-Using Agent](https://openai.com/index/computer-using-agent/)
- [Anthropic Computer Use Tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)
- [Claude Code Computer Use](https://code.claude.com/docs/en/computer-use)
- [Slack Events API](https://docs.slack.dev/apis/events-api/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Touchpoint Desktop Accessibility API](https://github.com/Touchpoint-Labs/touchpoint)
- [OSWorld Benchmark](https://arxiv.org/abs/2404.07972)
- [OS-Harm Benchmark](https://arxiv.org/abs/2506.14866)

## 1. 核心定位

Telegraph 的远程控制能力应定位为：

```text
Local-first Agent Host
  + Remote Entry Surfaces
  + Governed Run/Approval Protocol
  + Layered Computer Use Harness
```

不要定位成：

```text
Remote Desktop
  + Chat Bot Frontend
  + Direct Desktop Control
```

原因：

- 远程桌面是高度同质化赛道，且很容易把产品重心带到视频流、延迟、手势映射等基础设施问题。
- Agent 产品真正的差异点是 run、trace、approval、tool governance、replay/fork 与本地权限边界。
- Computer Use 的社区共识正在从纯 screenshot + coordinate click 转向 API/MCP/DOM/Accessibility 优先，vision/raw input 兜底。
- Telegraph 已有 Pagelet / RuntimeEvent / Harness Extension / ConnectionOrchestrator 方向，天然适合做“外部入口进入本地 agent host”。

## 2. 目标能力总览

| 能力 | 支持判断 | 架构位置 | 备注 |
|------|----------|----------|------|
| CLI | 必做 | `cli-gateway` Pagelet + local socket / MCP stdio | 开发者入口、脚本化、CI、本地自动化的基础。 |
| Mobile | 必做但先轻量 | Mobile app + relay + approval center | 先做状态、审批、截图，不先做完整远程桌面。 |
| Telegram | 值得早做 | TelegramAdapter + personal remote channel | 个人遥控闭环快，适合 `/ask`、`/screen`、`/approve`。 |
| Slack | 第二阶段 | SlackAdapter + team workflow | 团队价值高，但 OAuth、workspace 身份、审计复杂。 |
| Webhook | 支持低权限 | signed webhook adapter | 适合自动化触发，默认只读或受限 profile。 |
| MCP Server | 必做 | `telegraph mcp` -> local socket -> gateway | 让 Codex/Claude/Pi 等 CLI 生态复用 Telegraph 能力。 |
| Computer Use | 必做但受控 | ComputerUseBroker + Harness tools | 作为 fallback，不作为第一执行路径。 |
| 实时远程桌面 | 暂缓 | WebRTC view/control target | 只作为 debug/接管能力，不进入 P0-P2 核心。 |
| Cloud Relay | 必做可 self-host | identity / queue / routing / approval mirror | 不拥有电脑权限，只做连接和队列。 |
| VM / Isolated Browser | 长期必做 | execution target | 高风险或互联网任务优先进入隔离环境。 |

## 3. 总体拓扑

```text
External Surfaces
  Mobile / CLI / Slack / Telegram / Webhook / MCP Client
        |
        v
Channel Adapters
  ExternalMessage -> RunIntent -> ChannelReply
        |
        v
Relay Layer (optional cloud or self-host)
  Identity Mapping / Device Registry / Inbox-Outbox Queue
  Approval Router / Audit Mirror / Presence
        |
        | outbound WebSocket / WebRTC DataChannel / local socket
        v
Telegraph Desktop
  Main
    Process governance / native capability boundary
  Shared
    RunBroker / RunIndex / Approval / Policy / Identity / Settings
  Daemon
    Metrics / watchdog / diagnostics / audit shipping
  Pagelets
    chat / design / remote-control / cli-gateway / computer-use
    DurableRunLedger / optional DurableRunEngine
        |
        v
Agent Runtime + Harness Extension + Tool Registry
        |
        v
Execution Layer
  API/MCP -> Browser DOM/CDP -> Accessibility -> OCR/Vision -> Raw input
```

该拓扑扩展 [A-008](./20260509-telegraph-final-process-architecture.md) 的原则：

- 外部入口不成为 Main participant。
- runtime、tool、extension、Computer Use broker 仍在 Pagelet 内。
- Shared 持有入口路由、run 索引、订阅聚合与 approval 状态，但不跑 runtime。
- Pagelet 持有 durable run event ledger，是执行事实的 source of truth。
- Main 只暴露受控系统能力，不直接执行 agent loop。
- 所有 Telegraph 内部跨进程调用继续走 ConnectionOrchestrator + RPC。

## 4. 进程与模块归属

### 4.1 Remote Control Pagelet

`remote-control` 是外部聊天入口和移动端入口的本地 BFF。

职责：

- 接收 Relay 下发的 `ExternalMessage`。
- 将外部消息归一成 `RunIntent`。
- 将 `RuntimeEvent` 投影回 Mobile/Slack/Telegram/Webhook。
- 协调 approval 请求与回复。
- 选择或唤起目标 pagelet，例如 chat/design/computer-use。

禁止：

- 不直接持有 Main process handle。
- 不越过 Shared 直接找其他 Pagelet P2P。
- 不把 Slack/Telegram raw payload 泄漏到核心 RuntimeEvent 顶层类型。

### 4.2 CLI Gateway Pagelet

`cli-gateway` 是本机 CLI 与 MCP 的入口。

职责：

- 监听 Unix domain socket / Windows named pipe。
- 提供 JSON-RPC 与 event subscription。
- 实现 `telegraph ask`、`telegraph attach`、`telegraph approve`、`telegraph runs`。
- 提供 `telegraph mcp` stdio server，将外部 MCP client 桥到 Telegraph 本地能力。

关键点：

- CLI 不是 ConnectionOrchestrator participant。
- 真正进入拓扑的是 `pagelet:cli-gateway:1`。
- CLI 与 Desktop UI 是同一个 run 的两个观察者。

### 4.3 RunBroker / DurableRunLedger / DurableRunEngine 三层

Remote Agent OS 需要把三个相近概念拆开，避免把控制面和执行语义混在一起：

| 概念 | 归属 | 职责 | 不做什么 |
|------|------|------|----------|
| `RunBroker` | Shared | 入口路由、run 索引、订阅聚合、approval 状态、跨入口 attach | 不跑 runtime，不做每条 event 的强写入，不执行工具 |
| `DurableRunLedger` | Pagelet | `createRun`、append-only event log、terminal flush、orphan recovery、历史 projection | 不做跨入口路由，不定义 checkpoint 语义 |
| `DurableRunEngine` | Pagelet runtime adapter 内部 | checkpoint、resume、durable step、side-effect idempotency | 不替代 `RuntimeEvent`，不把 Restate/DBOS/LangGraph 类型泄漏到协议层 |

关键原则：**Shared 负责“大家怎么找到 run”，Pagelet 负责“run 实际发生了什么”，DurableRunEngine 负责“run 能不能从中断点继续”。**

### 4.4 Shared RunBroker

`RunBrokerService` 是所有外部入口的控制面中枢。

```typescript
export interface IRunBrokerService {
  createRunIntent(input: RunIntentInput): Promise<RunRecord>
  claimRunIntent(req: { appId: string; runId?: string }): Promise<RunClaim | null>
  registerRunSummary(req: RunSummary): Promise<void>
  subscribeRunProjection(req: { runId: string; cursor?: string }): AsyncIterable<RuntimeEventEnvelope>
  requestApproval(req: ApprovalRequest): Promise<ApprovalTicket>
  decideApproval(req: ApprovalDecision): Promise<void>
  listRuns(filter?: RunListFilter): Promise<RunRecord[]>
}
```

RunBroker 放 Shared 的理由：

- 多个入口需要共享同一套 run 索引和状态摘要。
- 多个 Pagelet 需要领取 run intent。
- Desktop UI、CLI、Mobile、Slack 可以同时 attach。
- approval 需要跨入口投递和决策。

RunBroker 不做的事情：

- 不调用 `runtime.run()`。
- 不作为 pagelet-local event ledger 的替代。
- 不执行 Computer Use action。
- 不直接控制桌面。
- 不把 Shared 放进模型 token stream 或高频 trace 的关键路径。

### 4.5 Pagelet DurableRunLedger

`DurableRunLedger` 是每个执行型 Pagelet 内的强 durable 写入点。

```typescript
export interface DurableRunLedger {
  createRun(input: CreateRunInput): Promise<RunRecord>
  appendEvent(runId: string, event: RuntimeEvent): Promise<EventCursor>
  listRuns(filter?: RunListFilter): Promise<RunRecord[]>
  listRunEvents(runId: string, cursor?: string): Promise<RuntimeEventEnvelope[]>
  markRunningRunsRecovered(now?: number): Promise<RunRecord[]>
}
```

落在 Pagelet 的理由：

- runtime event 在 Pagelet 内生成，关键生命周期事件应就近落盘。
- 高频 `assistant_delta` / `model_event` 不应跨进程同步写 Shared。
- pagelet crash recovery 可以在 pagelet boot 时扫描 orphan run 并收敛状态。
- 符合 A-008：Runtime / Extension Host 的边界在 Pagelet 内。

写入策略：

- `createRun` 必须在 `AgentHarness.run()` 前完成。
- `run_started`、tool call/result、permission、child run、terminal event 属于关键事件。
- token delta / raw model event 可以 compact / batch / rawRef。
- terminal 返回前必须确保关键事件和最终状态已经落盘。

### 4.6 Pagelet DurableRunEngine

`DurableRunEngine` 是可选的高阶执行能力，只在 runtime 真正支持 checkpoint/resume 时启用。

```typescript
export interface DurableRunEngine {
  run(input: DurableRunInput): AsyncIterable<RuntimeEvent>
  resume(input: ResumeRunInput): AsyncIterable<RuntimeEvent>
  getCheckpoints(runId: string): Promise<CheckpointRef[]>
}
```

它可以封装 Restate、DBOS、LangGraph checkpointer 或自研 step journal，但这些内部概念不能替代 Telegraph 的 `RuntimeEvent`。

### 4.7 Main DesktopPrimitiveService

Main 只暴露必须由 Electron main 或 OS API 提供的能力：

```typescript
export interface IDesktopPrimitiveService {
  notifyUser(req: NotifyUserRequest): Promise<void>
  requestNativePermission(req: NativePermissionRequest): Promise<NativePermissionResult>
  listWindows(): Promise<WindowDescriptor[]>
  focusWindow(req: { windowId: string }): Promise<void>
  captureScreen(req: CaptureScreenRequest): Promise<ScreenCaptureRef>
}
```

点击、输入、shell、browser automation 等更高层工具不直接放 Main。Main 可以提供 primitive，
但风险判定、tool policy、run trace 应落在 Pagelet 的 broker/harness 中。

## 5. 统一协议

### 5.1 ExternalMessage

外部 channel adapter 的入口事件。

```typescript
export type ExternalChannel =
  | 'mobile'
  | 'cli'
  | 'mcp'
  | 'slack'
  | 'telegram'
  | 'webhook'

export interface ExternalMessage {
  channel: ExternalChannel
  sourceUserId: string
  sourceWorkspaceId?: string
  conversationId: string
  messageId: string
  text: string
  attachments?: ExternalAttachment[]
  receivedAt: number
  rawRef?: string
}
```

`rawRef` 指向外置存储，避免把 Slack/Telegram 的大 payload 或附件直接塞进 RuntimeEvent。

### 5.2 RunIntent

所有入口统一转成 `RunIntent`。

```typescript
export interface RunIntentInput {
  actor: RemoteActor
  target: RunTarget
  goal: string
  source: ExternalMessage
  requestedCapabilities: CapabilityRequest[]
  approvalPolicy: 'auto_readonly' | 'ask_before_write' | 'ask_every_tool'
}

export interface RemoteActor {
  actorId: string
  channel: ExternalChannel
  trustLevel: 'first_party' | 'workspace_member' | 'personal_bot' | 'group_chat' | 'webhook'
}
```

### 5.3 ChannelReply

同一个 `RuntimeEvent` 在不同入口上有不同投影。

| RuntimeEvent | Mobile | Slack | Telegram | CLI |
|--------------|--------|-------|----------|-----|
| `run_started` | Run header | Thread reply | Message | stdout status |
| `assistant_delta` | live stream | thread update | edit/send message | stdout stream |
| `tool_call` | step row | compact progress | compact progress | structured line |
| `permission_request` | approval sheet | Block Kit buttons | inline keyboard | prompt / command |
| `artifact_created` | preview card | file/link | photo/file | path/link |
| `run_completed` | summary | summary reply | summary | exit code + summary |

## 6. Computer Use Harness

Computer Use 是执行层，不是入口层。它应该被包装成 `ComputerUseBroker` 与一组 governed tools。

### 6.1 执行优先级

```text
1. Structured API / MCP
   Slack API, GitHub API, filesystem, shell, app-specific MCP

2. Browser DOM / CDP / Playwright
   已登录浏览器、网页表单、后台系统

3. Accessibility Tree
   macOS AX, Windows UIA, Linux AT-SPI

4. OCR + Screenshot Vision
   accessibility 不完整的 app、canvas、图片化 UI

5. Raw Mouse / Keyboard
   最后兜底，只用于短步骤、强审计、高确认场景
```

### 6.2 Observation 与 Action

```typescript
export type ComputerTarget =
  | { kind: 'local_desktop'; displayId?: string }
  | { kind: 'isolated_browser'; profileId?: string }
  | { kind: 'vm_desktop'; vmId: string }
  | { kind: 'app'; appId: string }

export interface Observation {
  target: ComputerTarget
  screenshotRef?: string
  accessibilityTreeRef?: string
  domSnapshotRef?: string
  ocrText?: string
  windows: Array<{ id: string; app: string; title: string; bounds: Rect }>
  capturedAt: number
}

export type ComputerAction =
  | { type: 'click'; target: ElementRef | Point }
  | { type: 'type'; text: string; target?: ElementRef }
  | { type: 'hotkey'; keys: string[] }
  | { type: 'scroll'; deltaY: number; target?: ElementRef | Point }
  | { type: 'drag'; from: Point; to: Point }
  | { type: 'screenshot' }
  | { type: 'focus_app'; appId: string }
```

### 6.3 Safety Gate

每次 action 执行前进入 `SafetyGate`：

```text
action proposal
  -> policy classification
  -> app/window scope check
  -> actor trust check
  -> approval requirement
  -> execution budget check
  -> run trace append
  -> execute
  -> after observation append
```

最小强约束：

- machine-wide lock：同一时刻只允许一个 Computer Use session 控制真实桌面。
- per-app approval：首次控制某 app 前必须确认。
- hidden/unapproved apps：真实桌面模式下隐藏或屏蔽未授权 app。
- global stop：Desktop/Mobile/CLI 都能 stop；本机 Esc 优先。
- before/after trace：每个动作记录 window metadata、action、observation refs。
- coordinate scaling：所有坐标 action 必须带 capture 尺寸与实际屏幕尺寸映射。

## 7. 入口适配

### 7.1 Mobile

Mobile 是富控制台：

- run 列表与实时状态。
- approval inbox。
- screenshot/artifact preview。
- pause/stop/resume。
- device selector。

不建议 P0 做完整远程桌面。实时屏幕和手势控制可以作为 debug/接管模式进入后续阶段。

### 7.2 Telegram

Telegram 是个人遥控器：

```text
/ask <task>
/devices
/runs
/screen
/approve <id>
/deny <id>
/pause <runId>
```

Bot API 的 webhook/long polling 差异应封在 adapter 内。Telegram group 默认低信任，只允许 mention 或 allowlist 用户发起任务。

### 7.3 Slack

Slack 是团队操作台：

- slash command：`/telegraph ask ...`
- app mention：`@Telegraph ...`
- thread：每个 run 一个 thread。
- Block Kit：approve/deny/pause/open trace。
- modal：选择 device/workspace/profile。

Slack Events API 需要快速 ack；adapter 应先 ack，再异步写入 relay queue / RunBroker。

### 7.4 CLI 与 MCP

本地 CLI：

```bash
telegraph ask "帮我跑测试并总结失败"
telegraph attach run_123
telegraph approve approval_456
telegraph runs
telegraph open run_123
telegraph mcp
```

`telegraph mcp` 是 stdio MCP server，内部通过 local socket 接入 `cli-gateway`。这样 Codex、Claude Code、Pi CLI 等外部 agent 可以把 Telegraph 的 screenshot、approval、computer-use、run trace 能力作为 governed tools 使用。

## 8. 安全与身份模型

### 8.1 信任等级

| 来源 | 默认信任 | 默认能力 |
|------|----------|----------|
| First-party Mobile | 高 | read + approve + medium by policy |
| Local CLI | 高但本机限定 | read + run + approve，危险动作仍按 policy |
| Slack workspace | 中 | 团队任务、approval、受限工具 |
| Telegram private chat | 中 | 个人任务、approval |
| Telegram group | 低 | read-only 或 mention + allowlist |
| Webhook | 最低 | signed + allowlist + scoped profile |

### 8.2 能力等级

| 等级 | 示例 | 默认策略 |
|------|------|----------|
| `read_only` | 状态、截图、日志、UI tree | 可自动 |
| `low` | 打开 URL、切换窗口、滚动 | profile 控制 |
| `medium` | 点击、输入、写文件、运行测试 | 按 actor/profile |
| `high` | shell、删除文件、发送消息、提交代码 | 必须 approval |
| `critical` | 付款、交易、读取密钥、系统设置 | 桌面或 Mobile 二次确认 |

### 8.3 Relay 边界

Relay 可以知道：

- 哪个用户向哪个设备发了任务。
- run 状态、队列、approval 待处理状态。
- channel 投影所需的摘要。

Relay 不应该拥有：

- desktop tool execution capability。
- OS credential。
- raw screen stream 的默认持久化。
- 绕过 Desktop policy 的 approval 权限。

企业/高隐私模式应支持 self-host relay 或 local-only mode。

## 9. 关键流程

### 9.1 外部消息发起 Run

```text
Telegram/Slack/Mobile
  -> ChannelAdapter parses ExternalMessage
  -> Relay routes to online Desktop
  -> RemoteControlPagelet validates actor/device/profile
  -> Shared RunBroker creates RunIntent and run index entry
  -> target Pagelet claims run
  -> target Pagelet DurableRunLedger creates run and appends events
  -> Runtime emits RuntimeEvent
  -> RunBroker receives projections / summaries
  -> ChannelProjection sends replies
```

### 9.2 CLI 发起 Run

```text
telegraph ask
  -> local socket / named pipe
  -> cli-gateway Pagelet
  -> RunBroker createRunIntent
  -> target Pagelet claim
  -> target Pagelet DurableRunLedger append events
  -> CLI attach run projection stream by cursor
```

### 9.3 Computer Use Action

```text
AgentRuntime tool_call(computer.observe)
  -> ComputerUseBroker captures observation
  -> model proposes action
  -> SafetyGate classifies risk
  -> PermissionBroker requests approval if needed
  -> ActionExecutor invokes OS/app primitive
  -> after observation appended
  -> RuntimeEvent tool_result
```

### 9.4 Approval

```text
PermissionBroker
  -> RunBroker requestApproval
  -> projection to Mobile/Slack/Telegram/CLI/Desktop
  -> first valid decision wins
  -> decision appended to pagelet DurableRunLedger as permission event
  -> blocked tool resumes or fails
```

## 10. Red Lines

- 不让 Telegram/Slack/Mobile 直接调用 Main/Shared/Daemon。
- 不让 CLI 直接使用 Electron IPC 或裸 MessagePort。
- 不在 Main/Shared/Daemon 中 import runtime implementation 或调用 `runtime.run()`。
- 不把 framework-specific event 类型提升到核心 RuntimeEvent 顶层。
- 不把 screenshot/raw payload 无限制塞进 event；使用 `rawRef` / `artifactRef`。
- 不让 Computer Use 绕过 approval/policy/trace。
- 不把 cloud relay 设计成拥有本地电脑执行权的服务。

## 11. 开放问题

1. `RunBrokerService` 是否作为 Shared 的第一批全局服务落地，还是先在 chat/remote-control pagelet 内做 MVP 后再上提？
2. `cli-gateway` 是否独立 Pagelet，还是作为 `remote-control` 的本地 endpoint 子模块？倾向独立，便于 headless 与 MCP 生命周期隔离。
3. Computer Use 的 macOS 实现是先集成外部 MCP server，还是直接做 native AX/ScreenCaptureKit binding？倾向先 wrapper，再替换核心能力。
4. Relay 是否第一版必须 SaaS？倾向支持 local-only + self-host + SaaS 三种拓扑，但 MVP 可以先 local-only/开发者 relay。
5. 外部 channel 的 raw payload 保存多久？需要按用户/企业 policy 配置 retention。
