---
id: A-004
title: Multica 源码实现映射与 Telegraph「类 Multica」能力适配路径
description: >
  基于 multica-ai/multica 仓库的分层与关键 Go 包，拆解协调平面、daemon 执行平面、
  Agent Backend 与实时事件管线；对照 Telegraph 现有 Pi-ai 流式调用与多进程拓扑，
  给出从「单会话 IPC」演进到任务队列、运行时隔离与事件总线的实现锚点与分阶段适配路径。
category: architecture
created: 2026-05-04
updated: 2026-05-05
tags:
  - multica
  - telegraph
  - daemon
  - task-queue
  - websocket
  - pi
  - electron
status: draft
sources:
  - title: multica-ai/multica（GitHub）
    url: https://github.com/multica-ai/multica
references:
  - id: D-001
    rel: extends
    file: ../discussion/20260504-multica-vs-pi-multi-agent-for-telegraph.md
  - id: A-002
    rel: related-to
    file: ./20260504-multi-process-topology.md
  - id: P-001
    rel: derives
    file: ../roadmap/20260504-multi-agent-telegraph-roadmap.md
  - id: I-002
    rel: related-to
    file: ../issue/20260505-pi-ai-llm-trace-await-sink-deadlock.md
  - id: A-005
    rel: extended-by
    file: ./20260505-telegraph-agent-runtime-extension-host-theory.md
---

# Multica 源码实现映射与 Telegraph「类 Multica」能力适配路径

本文假设 Multica 源码位于本地 **`/Users/ryuyutyo/Documents/code/modules/ai/multica`**（与上游 [multica-ai/multica](https://github.com/multica-ai/multica) 同步）。宏观产品讨论见 **D-001**；进程拓扑背景见 **A-002**；可执行的阶段清单见 **P-001**。

---

## 1. Multica 的三层分解（读代码时的 mental model）

| 层次 | 职责 | Multica 中的主要落点 |
|------|------|----------------------|
| **协调平面（coordination）** | Workspace / Issue / Comment / 权限 / 任务排队 / 状态机 / Skills 元数据 / 活动流 | `server/` Go：`internal/handler/*`、`internal/service/task.go`、`pkg/db/generated/*`（sqlc）、`pkg/protocol/events.go` |
| **实时扇出（realtime）** | 浏览器与 daemon 订阅 scope；任务进度、Issue 更新推送 | `server/internal/realtime/hub.go`（JWT、WebSocket、`ScopeAuthorizer`） |
| **执行平面（execution）** | 本机 daemon 轮询/认领任务、准备目录、spawn 各厂商 CLI、上报消息与 session | `server/internal/daemon/daemon.go`、`internal/daemon/execenv/*`、`pkg/agent/*` |

Telegraph 今天要做的「适配」，本质是：**在不留协调平面的情况下**，至少要补齐执行平面若干块（队列、环境、流式上报）；若要「像 Multica」的体验，还要么 **自建协调平面**，要么 **嵌入/对接 Multica 后端**，并把 UI 事件对齐到 `task:*` / `issue:*` 一类语义。

---

## 2. Multica 关键源码锚点（思考笔记）

### 2.1 任务生命周期与 daemon 协同

- **`internal/handler/task_lifecycle.go`**  
  - `RecoverOrphanedTasks`：daemon 启动时按 runtime 回收「派发中/运行中」孤儿任务，走与失败相同的后续管线（事件、重试、Issue 回滚）。这说明 Multica 把 **daemon 崩溃恢复** 视作一等场景，而不是 UI 手动刷新。  
  - `PinTaskSession`：daemon 在 Agent 产出 session/work_dir 后立即持久化，便于中断后续跑。  
  - **Telegraph 对照**：当前无「任务行」与持久 queue；若引入后台 Agent run，需要等价物：**run 记录表或本地 KV + 进程重启时的 orphan 收敛策略**。

- **`internal/service/task.go`**（体量很大）  
  - `TaskService` 注入 `realtime.Hub`、`events.Bus`、可选 `EmptyClaimCache`（Redis 侧「空队列」快路径）。  
  - 负责任务 enqueue、claim、完成/失败、评论触发摘要、与 Issue/Agent 协调。  
  - **Telegraph 对照**：若要单机版「任务服务」，可先做 **简化状态机**（queued → running → completed/failed）+ **内存或 SQLite**，不必一上来复制 Postgres/sqlc/Redis。

### 2.2 Daemon：本地运行时的心脏

- **`internal/daemon/daemon.go`**  
  - `Daemon` 结构体维护 workspace → runtime 集合、`repoCache`、WebSocket 心跳、活跃任务计数、`agentVersions` 等。  
  - 注释写明：**Daemon 是 poll/ws 驱动、在本地执行任务的运行时**。  
  - **Telegraph 对照**：Telegraph 已有 **`DaemonProcessMain`** 启动的 **daemon utility-process**（见 **A-002**），但职责是 **端口经纪与 RPC 路由**，不是 Multica 意义上的「抢任务并 spawn CLI」。适配路径可以是：**在现有 daemon 进程内新增「AgentRuntime」子模块**，或 **单独 fork Node/Go 子进程** 专门跑队列（避免阻塞端口握手）。

### 2.3 执行环境：每任务隔离目录与技能注入

- **`internal/daemon/execenv/execenv.go`**  
  - `PrepareParams` / `TaskContextForEnv`：把 Issue、Agent 指令、Skills 文件、仓库列表、项目资源等 **物化为磁盘上下文**（`workdir`、`CLAUDE.md` 注入 agent instructions 等）。  
  - **Telegraph 对照**：今日 **无 per-task 沙箱目录**；Pi 侧若以后跑 CLI + pi-subagents，需要类似 **`.telegraph/runs/<id>/`** 的约定，以及可选 git worktree（对齐 pi-subagents 的 `worktree: true` 思路）。

### 2.4 Agent 抽象：Multica 如何统一「厂商 CLI」与 Pi

- **`server/pkg/agent/agent.go`**  
  - `Backend` 接口：`Execute(ctx, prompt, opts) → Session`，Session 通过 channel 流式 `Message`，最终 `Result`（含 `SessionID`、`Usage`）。  
  - `ExecOptions` 含 `ResumeSessionID`、`McpConfig`、`CustomArgs` 等 — **恢复会话与 MCP 是统一选项**。  

- **`server/pkg/agent/pi.go`**  
  - `piBackend`：**子进程**执行 `pi`，非交互 **`--mode json`**，`--session` 指向 **追加事件的文件路径**；该路径即 opaque session id，下一轮 `ResumeSessionID` 传回。  
  - **Telegraph 对照（重要）**：Telegraph 的 `PiAgent` 走的是 **`@mariozechner/pi-ai` 库内 `stream()`**（直连模型 API），**不是** Multica 那种 spawn Pi CLI。二者都可称为「Pi 生态」，但 **会话格式、工具链、与 pi-subagents 的可组合性** 不同：  
    - **pi-ai 路径**：嵌入成本低，适合现有 `ipcMain.handle` 流式 UI。  
    - **Pi CLI 路径**：与 Multica daemon、`pi-subagents`、磁盘 `.jsonl` 会话一致，利于 **多角色子进程** 对齐上游扩展。

### 2.5 实时协议：前端与 daemon 共用一套事件名

- **`pkg/protocol/events.go`**  
  - 约定 `EventTaskQueued`、`EventTaskDispatch`、`EventTaskProgress`、`EventTaskCompleted`、`EventTaskFailed`、`EventTaskMessage` 等；注释说明前端可按 `task:` 前缀订阅并失效缓存。  
  - **Telegraph 对照**：renderer 今日用 **`AGENT_STREAM_DATA_CHANNEL`** 推送 `text_delta` / `error` / `done`。若要类 Multica 活动流，需要 **规范化事件枚举**（可与 protocol 对齐命名，或映射一层），并决定 **是否 WebSocket**（Telegraph 桌面内部可用 **MessagePort / IPC** 替代 WS，但语义可对齐）。

### 2.6 WebSocket Hub：权限与 scope

- **`internal/realtime/hub.go`**  
  - `ScopeAuthorizer`：按 userId + workspaceId + scopeType + scopeId 鉴权；典型用于 task/chat 订阅。  
  - **Telegraph 对照**：单机单用户阶段可用 **省略 ACL** 的 hub；多账号/workspace 时再引入等价校验。

---

## 3. Telegraph 现状锚点（与 Multica 对齐时的「缺口」）

### 3.1 Agent 入口：`AgentHandler` + `PiAgent`

主进程注册 IPC，`renderer → main` 单次请求，`PiAgent` 用 pi-ai 流式回调推回：

```13:48:apps/telegraph/src/services/agent/electron-main/AgentHandler.ts
export function setupAgentHandler() {
  try {
    ipcMain.handle(AGENT_STREAM_CHANNEL, async (event, req: StreamRequest) => {
      const agent = new PiAgent(req.settings)
      try {
        await agent.send({
          messages: [{ role: 'user', content: req.message }],
          callbacks: {
            onTextDelta: (text: string) => {
              event.sender.send(AGENT_STREAM_DATA_CHANNEL, { type: 'text_delta', text })
            },
            // ...
          },
        })
```

```6:36:packages/agent/src/PiAgent.ts
 * Streaming agent built on top of pi-ai. Stateless w.r.t. conversation —
 * the caller passes in messages on each `send`. State (history, tools,
 * loop-on-toolcall, …) is the harness's job; PiAgent is the thin wire.
export class PiAgent {
  // ...
  async send(input: AgentSendInput): Promise<Message> {
    const model = resolveModel(this.settings)
    const s = stream(model, context, {
      apiKey: this.settings.apiKey,
      signal: input.signal,
    } as Parameters<typeof stream>[2])
```

**与 Multica 对比**：

| 能力 | Multica | Telegraph 现状 |
|------|---------|----------------|
| 调用形态 | daemon 内 `agent.Backend.Execute`，Pi 为 **CLI JSON 流** | main 进程 **pi-ai 直连模型** |
| 会话恢复 | DB `PinTaskSession` + CLI `--session` 文件 | 由 harness 自建；`PiAgent` 单次 `messages` 传入 |
| 任务队列 / claim | `TaskService` + daemon poll | 无 |
| 执行目录隔离 | `execenv.Prepare` | 无（全局 cwd） |
| 多 Agent 编排 | Issue 指派多个 Agent / 多次任务；侧翼可用 Codex multi-agent 等 | 单 IPC 会话；无内置 scout/worker 链 |

### 3.2 进程：`TelegraphApplication` 与 daemon utility-process

```72:75:apps/telegraph/src/application/telegraph-application.ts
  private sharedProcess: UtilityProcess

  private daemonProcess: UtilityProcess
```

**适配启示**：Multica 的「抢任务 + spawn」放在 **长期存活、贴近机器」** 的 daemon 侧更合理。Telegraph 可将 **重负载 AgentRunner** 从 main 挪到 **daemon utility-process**（或 fork/pagelet），main 只做 **授权与窗口**，避免阻塞与内存膨胀 — 这与 **A-002** 中的角色划分一致。

---

## 4. 「类 Multica」能力 → Telegraph 模块映射表

下表用于拆分 backlog（详情步骤见 **P-001**）。

| Multica 能力 | 代表性源码 | Telegraph 建议落地位置 |
|--------------|------------|-------------------------|
| 任务队列与状态机 | `service/task.go`、`handler/task_lifecycle.go` | 新建 `services/agent-runtime` 或扩展现有 `services/agent`：**本地 store**（SQLite/Level）+ **Run 实体**；daemon 或 main 后台轮询 |
| daemon 认领 / 心跳 | `daemon/daemon.go` | **daemon utility-process** 内新增模块，或独立 child process；与现有 `AcquirePort` 生命周期对齐 |
| 执行环境 | `execenv/*` | `core` 或 `services/file-access` 之下：**runs/<id>/workdir** + 元数据 `manifest.json` |
| Agent Backend 抽象 | `pkg/agent/agent.go` | `packages/agent`：定义 `AgentBackend` 接口；实现 **`PiAiBackend`（现有）** + 可选 **`PiCliBackend`（对齐 Multica）** |
| 流式消息标准化 | `pkg/agent` Message 类型、`protocol/events.go` | renderer 订阅：**统一 `AgentRunEvent` discriminated union**，再由 UI 映射为时间线 |
| 实时扇出 | `realtime/hub.go` | 首阶段：**EventEmitter + IPC**；后期若 Web UI：**可选 WS 或与账户服务对接** |
| 孤儿任务恢复 | `RecoverOrphanedTasks` | 启动时扫描 `running` run，标记 failed 或 retry，并发事件 |
| Skills 注入 | `execenv` + skill handler | 复用 Pi **SKILL.md** 发现规则，或同步 Multica 的「写入任务目录」语义 |

---

## 5. Telegraph 适配路径（实现视角小结）

下列路径与 **P-001** 中阶段一一对应，此处强调 **源码级因果**。

### 路径 A — 「嵌入式 Multica」最小耦合

- Telegraph **不负责**任务与 Issue；仅嵌入 WebView 或 deep-link 打开 Multica；本机安装 **multica daemon**。  
- **适配量极小**：账号、窗口、自动更新引导；**multi-agent 产品力完全依赖上游**。

### 路径 B — 「自建协调平面 + Telegraph daemon 执行」（最像 Multica 自托管）

- 引入 **HTTP API + DB**（可精简版），事件管道对齐 `pkg/protocol/events.go` 的语义。  
- daemon：**Go Multica daemon 复用**（Telegraph 启动子进程）或 **TypeScript 重写 claim/exec 循环**（调用 `packages/agent`）。  
- **工程量最大**，长期可与 Multica 上游 diff 对齐。

### 路径 C — 「Telegraph 单机 AgentRuntime + Pi 栈深化」（推荐渐进）

1. **抽象 `AgentBackend`**，保留 pi-ai，增加可选 Pi CLI / pi-subagents 调用路径（与 Multica `piBackend` 同源思路）。  
2. **Run registry**：持久化 run、session 指针、logs path（对标 `PinTaskSession`）。  
3. **daemon utility-process** 托管执行器：claim（可先单机内存队列）、`execenv` 等价目录、流式事件 IPC 到 renderer。  
4. UI：**run 列表 + 进度时间线**（映射 `task:progress` 语义）。  
5. 再考虑 **多角色**：在 CLI 路径上装 **pi-subagents**，或在应用层编排多次 `Backend.Execute`（scout → planner → worker）。

---

## 6. 结论

- Multica 的实现强项是 **数据库驱动的任务状态机 + daemon 执行网格 + 协议化实时事件**；源码上从 **`task_lifecycle` / `TaskService` / `daemon` / `execenv` / `pkg/agent`** 读即可串起主线。  
- Telegraph 当前 Agent 路径是 **轻量 pi-ai IPC**，与 Multica 的 **Pi CLI 子进程** 不同；若要深度对齐 **pi-subagents**，应显式评估 **引入 CLI 后端**这一分叉。  
- **daemon utility-process** 已是天然挂载点（**A-002**）；把「抢任务 + 准备目录 + spawn」迁出 main，是适配 Multica 式架构时阻力最小、收益最大的一步。

---

## 来源与外部仓库

- [multica-ai/multica](https://github.com/multica-ai/multica)
