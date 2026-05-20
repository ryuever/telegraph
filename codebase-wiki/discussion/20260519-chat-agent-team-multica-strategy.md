---
id: D-014
title: Chat Agent Team 与 Multica 差异化策略讨论归档
description: >
  归档一次围绕 Telegraph Chat 长期定位的产品与架构讨论：在 agent team、
  open source tools integration 与 Multica 已经快速产品化的背景下，Telegraph
  应避免正面复制项目管理控制平面，转向本地 agent runtime cockpit / runtime lab，
  以 Run、Trace、Permission、Handoff Contract、Replay 与 Capability Matrix 形成差异化。
category: discussion
created: 2026-05-19
updated: 2026-05-20
tags:
  - chat
  - agent-team
  - multica
  - runtime-cockpit
  - mcp
  - trace
  - permission
  - team-router
status: draft
sources:
  - title: MCP Introduction
    url: https://modelcontextprotocol.io/docs/getting-started/intro
  - title: Dify Introduction
    url: https://docs.dify.ai/en/use-dify/getting-started/introduction
  - title: LangGraph Overview
    url: https://docs.langchain.com/oss/python/langgraph/overview
  - title: CrewAI
    url: https://www.crewai.dev/
  - title: AutoGen Multi-agent Conversation Framework
    url: https://microsoft.github.io/autogen/0.2/docs/Use-Cases/agent_chat/
  - title: OpenHands
    url: https://www.openhands.dev/
  - title: Multica
    url: https://multica.ai/
  - title: Multica Changelog
    url: https://multica.ai/changelog
  - title: Multica Docs - How Multica works
    url: https://multica.ai/docs/how-multica-works
  - title: Multica Docs - Tasks
    url: https://multica.ai/docs/tasks
  - title: Multica Docs - Agents
    url: https://multica.ai/docs/agents
  - title: Multica Docs - Skills
    url: https://multica.ai/docs/skills
  - title: Multica Docs - Squads
    url: https://multica.ai/docs/zh/squads
  - title: Multica Docs - AI coding tools matrix
    url: https://multica.ai/docs/providers
references:
  - id: D-001
    rel: extends
    file: ./20260504-multica-vs-pi-multi-agent-for-telegraph.md
  - id: A-004
    rel: related-to
    file: ../architecture/20260504-multica-implementation-map-and-telegraph-adaptation.md
  - id: A-005
    rel: extends
    file: ../architecture/20260505-telegraph-agent-runtime-extension-host-theory.md
  - id: D-015
    rel: extended-by
    file: ./20260520-agent-runtime-product-layer-alignment.md
  - id: P-001
    rel: related-to
    file: ../roadmap/20260504-multi-agent-telegraph-roadmap.md
  - id: P-006
    rel: related-to
    file: ../roadmap/20260518-harness-capability-extension-plan.md
---

# Chat Agent Team 与 Multica 差异化策略讨论归档

> 本文归档 2026-05-19 关于 Telegraph Chat 长期定位的讨论。核心结论是：Chat 不应只做“支持 agent team + 很多开源工具接入”的通用智能体入口，因为这已经成为开源社区的公共方向。Telegraph 更应该做成本地优先的 **agent runtime cockpit / runtime lab**：把 Run、Trace、Tool、Permission、Handoff、Replay 与 Capability Matrix 做成产品核心，让用户能够看清、控制、复盘和接管 agent team 的每一次执行。

## 来源

- [MCP Introduction](https://modelcontextprotocol.io/docs/getting-started/intro)
- [Dify Introduction](https://docs.dify.ai/en/use-dify/getting-started/introduction)
- [LangGraph Overview](https://docs.langchain.com/oss/python/langgraph/overview)
- [CrewAI](https://www.crewai.dev/)
- [AutoGen Multi-agent Conversation Framework](https://microsoft.github.io/autogen/0.2/docs/Use-Cases/agent_chat/)
- [OpenHands](https://www.openhands.dev/)
- [Multica](https://multica.ai/)
- [Multica Changelog](https://multica.ai/changelog)
- [Multica Docs - How Multica works](https://multica.ai/docs/how-multica-works)
- [Multica Docs - Tasks](https://multica.ai/docs/tasks)
- [Multica Docs - Agents](https://multica.ai/docs/agents)
- [Multica Docs - Skills](https://multica.ai/docs/skills)
- [Multica Docs - Squads](https://multica.ai/docs/zh/squads)
- [Multica Docs - AI coding tools matrix](https://multica.ai/docs/providers)

---

## 1. 讨论背景

用户提出的初始判断是：

> Chat 的整体规划应该是一个支持 agent team 概念，同时支持一系列 open source tools integration 的智能体。

这个方向本身成立，但已经不够形成差异化。原因是 2026 年前后的 agent 生态已经快速收敛到几个公共能力：

- **Agent team / multi-agent orchestration** 已经被 CrewAI、AutoGen、LangGraph、Dify、Flowise、OpenHands、Multica 等项目分别覆盖。
- **工具接入** 正在被 MCP 标准化，单纯“支持 MCP / 支持很多工具”会越来越接近基础设施要求，而不是产品卖点。
- **本地 coding agent** 赛道已有 OpenHands、Claude Code、Codex、OpenCode、OpenClaw、Pi 等强执行器，重复做“更会跑代码的 agent”很难建立护城河。
- **Managed agents / agent teammate** 叙事已经由 Multica 明确产品化：agent 被当作 workspace member，进入 issue、assignee、comment、runtime、skill、squad 等协作表面。

因此本轮讨论的重点不是“Telegraph 要不要做 agent team”，而是：

1. 如果其他项目也在做类似能力，Telegraph 的独特性在哪里？
2. Multica 已经把 agent teammate 产品化后，Telegraph 应该学什么、避开什么？
3. 在当前 Telegraph 架构中，哪些已有资产可以承接这个方向？
4. 可落地的阶段路径应该如何调整？

---

## 2. 外部生态对比

### 2.1 MCP：工具接入标准化，不能当差异化本身

MCP 的定位是把 AI 应用连接到外部系统，包括本地文件、数据库、工具、工作流和专业 prompt。它的价值在于降低 N × M 集成成本，让工具提供方和 agent host 之间有稳定接口。

对 Telegraph 的含义：

- **支持 MCP 是基础能力**，不是最终卖点。
- 真正可差异化的是 MCP 工具调用之后的治理层：权限、审计、trace、输入输出 schema、失败归类、回放、可撤销或可审批。
- 如果只是把 MCP server 列成工具清单，Telegraph 很快会和 Claude Desktop、ChatGPT Desktop、Cursor、VS Code、Dify、n8n 等客户端同质化。

### 2.2 Dify / Flowise：可视化 workflow 平台

Dify 已经明确是 open-source agentic workflow platform，覆盖 visual workflow、RAG、integrations、deployment。Flowise 同样偏低代码 LLM flow / agent builder。

对 Telegraph 的含义：

- Telegraph 不应把第一差异化放在“拖拽式 workflow builder”。
- 如果以后做 workflow UI，应该服务于运行事实调试与回放，而不是先定义一套自有 graph DSL。
- 这与 [A-005](../architecture/20260505-telegraph-agent-runtime-extension-host-theory.md) 的原则一致：先抽象 `RuntimeEvent`，后抽象编排表达。

### 2.3 CrewAI / AutoGen / LangGraph：framework 与 orchestration runtime

CrewAI 强调 engineer-friendly multi-agent automation；AutoGen 把 multi-agent conversation 做成抽象；LangGraph 提供长运行、有状态、可持久化、human-in-the-loop 的 graph runtime。

对 Telegraph 的含义：

- Telegraph 不应该成为某个 framework 的 UI 外壳。
- Telegraph 核心应保持 framework-neutral：所有 framework 差异经 adapter 映射到 `RuntimeEvent`、`ToolDefinition`、`ExtensionManifest`、`RunInput`。
- LangGraph 的 durable execution、checkpoint、human-in-the-loop 值得学习，但不应先把 Telegraph 核心锁成 graph-first 产品。

### 2.4 OpenHands：coding agent 执行深度已经很强

OpenHands 的重点是“让 coding agent 真正执行工程任务”，覆盖 repo、shell、PR、CI、sandbox、规模化运行等场景。

对 Telegraph 的含义：

- 如果 Telegraph 正面做“端到端 coding agent”，会遇到 OpenHands 这样已经很深的竞品。
- Telegraph 更适合定位在本地桌面的 agent runtime cockpit：用户可以在一个桌面工作台里调度不同 runtime，观察其真实上下文与工具行为，必要时接管。

### 2.5 Multica：agent 项目管理控制平面

Multica 已经明确不是普通 agent chat，而是“human + agent team”的项目管理平台。它把 agent 变成 workspace member，通过 issue、assignee、comment、task queue、daemon、runtime、skill、squad 形成完整控制平面。

对 Telegraph 的含义：

- Multica 是最直接的参照，但不一定是最适合复制的对象。
- Multica 的强项是 **coordination plane**，即项目管理、任务队列、成员权限、运行时监控、活动流。
- Telegraph 的强项应该是 **local runtime cockpit**，即本地执行、细粒度 trace、权限治理、工具审计、回放接管、多 runtime 实验。

---

## 3. Multica 最新视角

### 3.1 从“多 agent”升级为“managed agents platform”

Multica 官网与 README 的核心叙事是：coding agents are teammates。agent 出现在 board 上，可以被分配 issue、报告进展、创建 issue、回复评论，和人类成员共享协作表面。

这不是“多 agent 聊天”，而是“把 agent 放进组织工作流”。它回答的问题是：

- 谁把什么任务交给哪个 agent？
- 哪台 runtime 能跑？
- 任务卡在哪个状态？
- 失败是否应该重试？
- 结果写回 issue / comment / PR 时如何展示？
- agent 的能力和 skill 如何复用？

### 3.2 Task 是所有 agent run 的统一单位

Multica 文档把 task 定义为每次 agent run 的单位。无论是 assign issue、@mention、chat，还是 Autopilot 定时触发，都会生成 task。task 进入队列，由 daemon 领取并交给对应 AI coding tool，完成后写回服务器。

Multica 的 task 状态机包括：

- `queued`
- `dispatched`
- `running`
- `completed`
- `failed`
- `cancelled`

失败还分 retryable 和 non-retryable：

- `runtime_offline`
- `runtime_recovery`
- `timeout`
- `agent_error`

它还区分 automatic retry 和 manual rerun：

- 自动重试用于基础设施失败，可以继承 session。
- 手动 rerun 表示用户判断上一次结果不好，因此 fresh session，避免继续污染上下文。

对 Telegraph 的启发：

- `Run` 必须成为 Chat 的第一实体，而不是消息流的附属品。
- `run_failed` 不应只有字符串 error，应该有稳定 failure reason。
- session / workDir / artifact 指针应该早于 terminal event 持久化，否则无法支持 crash recovery。
- manual rerun 与 infrastructure retry 应该有不同 session 策略。

### 3.3 Daemon / runtime 是执行平面，不是 UI 细节

Multica 的 server 不执行 agent；agent 在本机 daemon 上执行。daemon 会探测本机 CLI，注册 runtime，并周期性 poll / heartbeat。文档中给出的关键数字包括：

- 每 3 秒 poll task。
- 每 15 秒 heartbeat。
- 超过 45 秒无 heartbeat 后 runtime 失联。
- daemon 层默认并发 20。
- agent 层默认并发 6。

对 Telegraph 的启发：

- Telegraph 不必复制 Multica 的 server/daemon 分布式形态，但需要有等价的 local runtime registry。
- 对本地 desktop 而言，runtime registry 可以先是 pagelet-local 或 workspace-local；未来再扩展到多机器。
- UI 应该能解释“为什么这个 agent 没跑”：runtime missing、tool not installed、permission denied、concurrency full、model unavailable、session resume unsupported 等。

### 3.4 Agent 是成员，不是 persona

Multica 的 agent 可以：

- 被分配 issue。
- 被 `@mention`。
- 发评论。
- 创建 issue。
- 成为 project lead。
- 被 archive / restore。
- 有 visibility、custom env、custom args、model、MCP config、skills、concurrency limit。

对 Telegraph 的启发：

- Telegraph 的 agent profile 不能只是 name + system prompt。
- 更应该包含 runtime binding、tool scope、permission profile、memory scope、capability matrix、handoff contract、artifact output contract。
- 如果未来支持“agent team”，team member 也不能只是 prompt 模板，而应该是可执行能力单元。

### 3.5 Squad 的本质是路由，不是并行编排

Multica 5 月中旬引入 Squad：一组 agent / human member 由 leader agent 领导。把 issue 分配给 squad 时，不是所有成员一起执行，而是 leader 读取 issue 与 squad roster，然后决定 @ 哪个成员接手。

这点非常关键：

- Squad 不增加基础执行能力，它增加的是 **stable routing target**。
- `@FrontendTeam` 是稳定入口；实际响应者可以按 issue 内容变化。
- leader 的职责是选择、记录 evaluation、派活后停止；后续成员回复可以再次唤醒 leader 做下一步判断。

对 Telegraph 的启发：

- 第一版 agent team 不应急着做复杂 DAG。
- 更应该先做 `Team Router v0`：用户把任务交给一个 team，leader 根据成员能力与任务上下文选择一个成员或请求人类澄清。
- 这种方式比“启动四个 agent 并行跑”更可控，也更符合真实工作流。

### 3.6 Skills 与 MCP 是两种不同能力

Multica 文档明确区分：

- Skill 是知识包：`SKILL.md` + supporting files，用于告诉 agent 遇到某类任务时如何思考和行动。
- MCP 是工具通道：连接外部服务、数据库、文件系统、API 等。

Multica 支持从 GitHub、ClawHub、本地目录导入 skill，并在 task 执行时放到不同工具的原生 skill discovery path。它也明确指出第三方 skill 安全风险：Multica 不签名、不审计、不沙箱，用户需要自己审查。

对 Telegraph 的启发：

- Telegraph 可以把 Skill 安全治理做成差异化。
- 不能只做 skill import，应补上：来源信任、manifest review、权限预览、脚本扫描、危险指令检测、运行前 diff、per-run approval。
- Skill 与 MCP 应分层：Skill 给 agent 增加知识与流程，MCP 给 agent 增加动作能力；二者都必须进入 trace / permission / audit。

### 3.7 Capability matrix 是产品能力

Multica 提供 11 款 AI coding tools 的能力矩阵，明确区分：

- session resumption 是否真实可用。
- MCP 是否真实可用。
- skill injection path 在哪里。
- model selection 是 static、dynamic 还是由账号 entitlement 决定。

对 Telegraph 的启发：

- Runtime picker 不应该只是 backend 下拉框。
- 它应该展示能力事实：resume、raw trace、MCP、skills、tool approval、sandbox、model discovery、parallel safety、session isolation、worktree support。
- 用户选择 runtime 时，需要知道“这个 runtime 能不能恢复”“能不能接 MCP”“是否能看到 raw model request”“是否支持高风险 tool approval”。

### 3.8 本地 Multica checkout 与官网文档的差异

本机 `/Users/ryuyutyo/Documents/code/modules/ai/multica` checkout 当前 HEAD 为：

```text
1ff4e27e feat(quick-create): cache agent prompt draft across navigation (#2039)
AuthorDate: Mon May 4 06:03:27 2026 +0800
```

而官网 changelog 已经更新到 2026-05-18 `v0.3.2`。本机 checkout 未检索到 `Squad` 相关源码，因此本次关于 Squad 的判断以官网 docs / changelog 为准；本机源码只用于验证旧有 task / daemon / backend / session pin 这些基础抽象已经存在。

这也提示：对快速变化的竞品，应以 docs / changelog / 最新 release 为准，不能只依赖旧本地 checkout。

---

## 4. Telegraph 当前已有资产

### 4.1 `RuntimeEvent` 已经具备 cockpit 的协议基础

`packages/agent-protocol/src/events.ts:7-94` 已经把事件分成 lifecycle、model、tool、workflow、extension、human interaction、runtime log 几类：

- `run_started / run_completed / run_failed / run_cancelled`
- `model_request / model_event / assistant_delta / assistant_message`
- `tool_call / tool_result / tool_error`
- `step_started / step_completed / edge_taken`
- `child_run_started / child_run_completed`
- `permission_requested / permission_resolved`
- `runtime_log`

这说明 Telegraph 已经有能力把 agent 执行过程抽象成“运行事实”，而不是锁定某个 framework 的概念。

关键差距：

- 目前缺少持久化 `Run` registry。
- failure reason 还不够结构化。
- artifact / handoff / evaluation 还没有一等事件。
- `RuntimeEvent` 与 legacy chat trace 仍在并存，最终应收敛到 `RuntimeEvent` 为主。

### 4.2 `AgentHarness` 已经具备 runtime-neutral adapter 层

`packages/agent/src/harness/AgentHarness.ts:22-49` 定义 runtime factory、trace sink、hooks、capabilities，并把执行暴露为 `AsyncIterable<AgentEvent>`。

`packages/agent/src/harness/AgentHarness.ts:131-183` 的执行逻辑已经包含几个正确方向：

- 等待 capability 注册完成。
- 基于 settings 选择 runtime。
- 校验每个 runtime event。
- 对 terminal event 做统一处理。
- trace sink 非阻塞，避免 observability 阻塞 run stream。
- 在 runtime 未正确 terminal 时合成失败或取消事件。

这说明 Telegraph 不需要从零做 agent runtime host，下一步应该把它产品化为 visible run lifecycle。

### 4.3 Chat pagelet 已经在 pagelet-local runtime 边界上运行

`apps/chat/src/application/node/ChatPageletWorker.ts:78-139` 已经把 chat run 放在 pagelet worker 中执行，创建 pagelet-local `AgentHarness`，并注册多个 runtime：

- `pi-ai`
- `embedded-kernel`（Native Harness 底层）
- `telegraph-native-subagents`
- `telegraph-orchestrator` / `orchestrator-core`

这与 [A-005](../architecture/20260505-telegraph-agent-runtime-extension-host-theory.md) 和 A-008 的边界一致：runtime 不应该跑在 main / daemon，而应该跑在 pagelet utility process 内。

关键差距：

- `ChatPageletWorker` 目前每次 send 创建 harness，缺少长期 registry / run store。
- `activeRuns` 是内存 Map，取消可以做，但重启恢复做不了。
- 它同时发送 `runtime_event` 与 legacy `text_delta / run_completed`，说明 UI 仍在迁移期。

### 4.4 Renderer 侧仍保留 legacy bridge

`apps/chat/src/application/browser/pagelet-agent-service.ts:66-105` 中，renderer 侧优先消费 `runtime_event`，但仍兼容 legacy projection event。`apps/chat/src/application/common/index.ts:31-39` 的 `ChatStreamEvent` 也仍包含 `text_delta / done / error / llm_trace / runtime_event` 混合协议。

这对当前兼容是必要的，但长期会阻碍 cockpit 产品化。建议逐步改为：

- Chat message projection 是 `RuntimeEvent -> UI projection` 的派生层。
- Trace / Run Console 直接消费 `RuntimeEvent`。
- Legacy `llm_trace` 只作为历史兼容或 debug import 格式。

### 4.5 `LlmTracePanel` 已经有 timeline 雏形

`apps/chat/src/application/browser/components/LlmTracePanel.tsx:16-24` 已按 event family 给 trace badge 分类；`LlmTracePanel.tsx:221-266` 已按 root run、child run、step 展示 timeline。

这正是 Telegraph 可以领先于普通 chat UI 的地方。下一步不是改成更漂亮的“日志面板”，而是升级为 `Run Console`：

- 左侧 run list：queued / running / failed / completed。
- 中间 execution timeline：root run、child runs、steps、tool calls、permissions、artifacts。
- 右侧 raw inspector：model request、tool input/output、schema、raw payload。
- 顶部 actions：cancel、retry infrastructure、manual rerun fresh session、fork from step、export trace。

### 4.6 Telegraph Native Subagent Harness 与 OrchestratorCore 是两条 team 路线

2026-05-20 对齐后，`pi-subagents` 不再作为长期 runtime adapter 定位；代码已收敛到 `packages/agent/src/runtime/telegraphSubagents/`。chain / parallel / role delegation 归属 Telegraph Native Subagent Harness；Pi 官方 `pi-subagents` 行为则通过 Pi CLI External Agent Runtime 兼容。

`packages/agent/src/runtime/OrchestratorCoreRunner.ts:43-89` 则把 `@/packages/orchestrator-core` graph invoke 转成 Telegraph orchestrator signal；`OrchestratorCoreRunner.ts:151-205` 通过 instrument node action 产生 node_started、node_completed、edge_taken。

这表示 Telegraph 已经有两种 team 承载方式：

- Telegraph Native Subagent Harness：快速验证 chain / parallel / role delegation。
- Telegraph-native orchestrator-core：更适合长期做 framework-neutral team router、checkpoint、human-in-the-loop。

建议优先做 `Team Router v0`，不要先做 full DAG builder。

### 4.7 ToolRegistry / ExtensionRegistry 已经有基本注册能力，但需要治理层

`packages/agent/src/runtime/toolExecution/ToolRegistry.ts:19-29` 定义了工具 ID、name、schema、execute、source、version、sourceUrl。`ToolRegistry.ts:56-140` 提供内存注册、卸载、列表、统计。

`packages/agent/src/extensions/node/ExtensionRegistry.ts:53-149` 支持扫描 extension manifest 并注册工具；`ExtensionRegistry.ts:154-173` 把 manifest tool 转为 registry tool；`ExtensionRegistry.ts:193-233` 加了 timeout / retry wrapper。

这些是 open source tools integration 的基础，但还不是差异化。差异化要靠：

- 每个 tool 的 permission scope。
- 每次 tool call 的 trace。
- 高风险 tool 的 approval。
- tool output 的 machine-readable + display 双通道。
- extension / skill 的来源与安全状态。
- per-run capability profile，而不是全局启用。

这与 [P-006](../roadmap/20260518-harness-capability-extension-plan.md) 的 capability / integration profile 方向一致。

---

## 5. 核心结论

### 5.1 不要把差异化押在“agent team + 很多工具”

这个方向已经是生态共识：

- MCP 正在标准化 tool integration。
- Dify / Flowise 覆盖 visual workflow。
- CrewAI / AutoGen / LangGraph 覆盖 framework 与 orchestration。
- OpenHands 覆盖 coding agent 执行深度。
- Multica 覆盖 human + agent project management。

Telegraph 如果只做“能拉 agent team、接 MCP、画流程”，会很快同质化。

### 5.2 Telegraph 的差异化应是 local runtime cockpit

建议定位：

> Telegraph 是本地优先的 agent runtime cockpit / runtime lab：让用户编队、运行、观察、回放、比较、接管 agent team，而不是替代 Linear/Jira 管项目。

这里的关键词不是“聊天”，而是：

- `Run`
- `RuntimeEvent`
- `Trace`
- `Permission`
- `Tool Governance`
- `Handoff Contract`
- `Replay / Fork`
- `Runtime Capability Matrix`
- `Pagelet-local execution`

### 5.3 Multica 是控制平面，Telegraph 应做运行面

Multica 的强项：

- issue / project / assignee / comment。
- task queue / retry / daemon / runtime monitoring。
- agents as teammates。
- squads as routing layer。
- workspace skills。
- GitHub / PR / CI / Autopilot。

Telegraph 不应该正面复制这些控制平面能力。更合理的位置是：

- 本地 run console。
- 深 trace。
- permission / approval。
- skill / MCP 安全治理。
- runtime adapter 实验。
- team handoff debugging。
- model / runtime comparison。

未来可以把 Multica 当成外部 task source / control plane：

```text
Multica issue/task  ->  Telegraph runtime cockpit  ->  RuntimeEvent trace / approval / artifact
```

而不是把 Telegraph 改造成另一个 Multica。

### 5.4 Agent team 的第一版应该是 Router，不是 DAG

最小可行 team 不应该是“多个 agent 全部启动”。

建议第一版：

```text
TeamSpec
  leader: router agent
  members:
    - id: scout
      capability: research / context discovery
    - id: implementer
      capability: patch / test
    - id: reviewer
      capability: review / risk
  routingPolicy:
    - DB / migration -> implementer with db skill
    - unclear requirement -> ask human
    - high-risk filesystem write -> permission required
```

执行时：

1. 用户把任务发给 team。
2. leader 读取 task context、member capabilities、runtime matrix。
3. leader 选择一个成员、请求澄清，或拆出 typed subtask。
4. 被选成员产生 child run。
5. handoff / result 进入 trace，并可以被评估。

这比直接做 `scout -> planner -> worker -> reviewer` 固定链更贴近真实产品，也更容易做权限与可观测。

### 5.5 Handoff Contract 比 orchestration pattern 更重要

多 agent 系统真正容易坏的地方不是 chain / parallel 形态，而是 agent 之间传递的信息没有结构化约束。

Telegraph 应把 handoff 作为一等对象：

```typescript
interface HandoffArtifact {
  artifactId: string
  fromRunId: string
  toAgentId: string
  schemaId: string
  payload: unknown
  acceptanceCriteria: string[]
  evidenceRefs: string[]
  eval?: {
    status: 'passed' | 'failed' | 'needs_human'
    notes: string
  }
}
```

这可以映射为新的 `RuntimeEvent` 或 artifact event，而不是先发明 workflow DSL。

---

## 6. 建议产品形态

### 6.1 第一屏：Chat 仍是入口，但不是普通聊天

用户仍然通过 Chat 输入任务，但 Chat 应该展示：

- 当前 active run。
- runtime / model / capability profile。
- team / selected agent。
- pending permissions。
- live tool calls。
- child run 状态。
- artifacts。
- trace drawer / run console。

Chat message 是人类可读投影；Run Console 是真实执行记录。

### 6.2 Run Console

Run Console 是 Telegraph 的核心差异化 UI：

| 区域 | 内容 |
|------|------|
| Run List | queued/running/failed/completed；支持按 session/team/runtime/filter |
| Timeline | root run、child runs、steps、model requests、tool calls、permissions、artifacts |
| Inspector | raw model request、raw model event、tool input/output、origin、schemaVersion |
| Controls | cancel、retry infrastructure、manual rerun fresh session、fork from step、export |
| Comparison | 同一 task 用不同 runtime/model/team 重跑并比较 |

### 6.3 Runtime Capability Matrix

Runtime picker 应展示能力矩阵，而不是隐藏在设置中：

| 能力 | 说明 |
|------|------|
| Raw model request | 是否能看到真实发给模型的 request |
| Raw model event | 是否能保留 SDK/CLI 原始事件 |
| Tool approval | 是否支持高风险 tool 手动审批 |
| MCP | 是否真实消费 MCP config，不只是保存字段 |
| Skills | 是否有原生 skill path / fallback path |
| Session resume | 是否真的可恢复 |
| Sandbox | 是否有文件/命令隔离 |
| Worktree | 是否支持并行修改隔离 |
| Model discovery | 静态、动态、账号 entitlement |
| Cost / usage | 是否能报告 usage |

这会让 Telegraph 成为 agent runtime 的“控制台”，而不是单纯模型选择器。

### 6.4 Skill / MCP 安全治理

建议 UI 把 capabilities 分为三层：

| 层 | 例子 | 默认策略 |
|----|------|----------|
| Knowledge | `SKILL.md`、style guide、schema docs | 可读，需来源标记 |
| Tool | MCP server、native tool、extension tool | 需要 manifest + schema + permission |
| Action | shell、patch、network write、external app write | 默认审批或 policy gate |

重点不是“装更多技能”，而是“知道技能和工具在 run 中做了什么”。

### 6.5 Team Router

第一版 team 功能建议只支持：

- 创建 team。
- 添加 member。
- 为 member 写 capability / role / tool scope。
- 写 team-level routing instructions。
- leader 每次只做 routing / clarification / escalation。
- 成员 run 作为 child run 展示。

不要第一版就做：

- 可视化 DAG 编辑器。
- 无限递归 agent 互调。
- marketplace。
- 自动后台触发。

---

## 7. 实现路径

### Phase 0：术语与边界收敛

目标：把产品语言从 “ChatBot / Agent Team” 调整为 “Run / Runtime / Team Router / Capability / Trace”。

动作：

- 在 docs / UI 文案中明确：Chat 是 run entry，不是 runtime 本身。
- 使用 `Run` 作为所有执行单位。
- 定义 `RuntimeCapability` 类型草案。
- 确认 pagelet-local runtime 边界不变。

验收：

- 新设计不要求 main / daemon 调用 `runtime.run()`。
- 新类型不引入 framework-specific union。

### Phase 1：Run Registry

目标：把一次 chat send 持久化为可恢复、可查询的 run。

建议字段：

```typescript
interface AgentRunRecord {
  runId: string
  sessionId: string
  parentRunId?: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  runtimeId: string
  teamId?: string
  agentId?: string
  failureReason?: 'runtime_offline' | 'runtime_recovery' | 'timeout' | 'agent_error' | 'permission_denied' | 'cancelled'
  sessionRef?: string
  workDir?: string
  artifactRefs: string[]
  createdAt: number
  startedAt?: number
  completedAt?: number
}
```

落点：

- 首版可放 `packages/agent/src/persistence`，复用当前 persistence 方向。
- Chat pagelet 负责创建 / 更新 run record。
- `RuntimeEvent` 入库可先用 append-only JSONL 或 SQLite 表。

验收：

- 应用重启后可看到历史 run。
- running orphan 可标记为 failed / runtime_recovery。
- manual rerun 与 infrastructure retry 分开。

### Phase 2：Runtime Capability Matrix

目标：让 runtime 选择变成可解释决策。

动作：

- 为每个 runtime adapter 暴露 capability descriptor。
- UI 在 settings / run header / team member editor 显示 capability。
- 对不支持能力的 runtime 禁用相关按钮，例如 resume、MCP、raw trace、tool approval。

验收：

- 用户切换 runtime 时能看到能力差异。
- Team Router 可以基于 capability 做 routing。

### Phase 3：Run Console 替代 LLM Trace Panel

目标：将 `LlmTracePanel` 升级为 agent execution console。

动作：

- 保留 `RuntimeEvent` timeline。
- 增加 Run List。
- 增加 raw inspector。
- 增加 tool / permission / artifact filter。
- 将 legacy trace 标记为 compatibility source，逐步下沉。

验收：

- 发送一次普通 chat 可看到 root run。
- 发送一次 Telegraph native subagent chain / parallel 可看到 child runs / steps。
- tool call input/output 可展开。
- raw model request 可查看。

### Phase 4：Tool / Skill / MCP Governance

目标：工具集成成为可治理能力，而不是黑盒插件。

动作：

- 为 `ToolDefinition` 扩展 permission metadata。
- MCP server adapter 映射到 `ToolDefinition`。
- Skill registry 存来源、版本、文件列表、风险扫描结果。
- PermissionBroker 在高风险 action 前发 `permission_requested`。
- Trace 显示 tool / skill 来源。

验收：

- 用户能看到某次 run 启用了哪些 skill / MCP / native tool。
- 高风险 tool call 进入审批。
- tool result 同时有 machine-readable payload 与 display summary。

### Phase 5：Team Router v0

目标：做最小 agent team，不做 DAG 平台。

动作：

- 定义 `TeamSpec`。
- 定义 `TeamMemberSpec`。
- leader runtime 首先只做 routing。
- routing 结果生成 child run 或 human clarification。
- child run 与 handoff artifact 进入 Run Console。

验收：

- 用户把任务发给 team。
- leader 选择一个 member 或请求澄清。
- member 执行结果回到 parent run。
- trace 中能看到 routing rationale 和 handoff artifact。

### Phase 6：Replay / Fork / Compare

目标：让 Telegraph 成为调试 agent team 的工作台。

动作：

- Replay run with same input。
- Fork from step / child run。
- Compare model / runtime / team result。
- Export trace bundle。
- 对 handoff artifact 加 eval。

验收：

- 同一任务可用不同 runtime 重跑并比较。
- 某个 failed tool step 可 fork 重试。
- handoff schema 可做最小 regression check。

### Phase 7：Autopilot-like triggers

目标：在治理能力稳定后支持后台自动触发。

动作：

- webhook trigger。
- schedule trigger。
- file watcher trigger。
- GitHub issue / PR trigger。
- 每个 trigger 必须绑定 capability profile 与 permission policy。

验收：

- 自动触发的 run 仍完整进入 Run Registry / Run Console。
- 没有 trace / permission 的 trigger 不允许启用。

---

## 8. 与现有路线图的关系

### 8.1 对 D-001 的更新

[D-001](./20260504-multica-vs-pi-multi-agent-for-telegraph.md) 的核心判断需要按 [D-015](./20260520-agent-runtime-product-layer-alignment.md) 更新：Multica 是协作平台，pi-subagents 是可参考的编排引擎；Telegraph 应先做 **Telegraph Native Subagent Harness** 与可观测 run 系统，而不是把 Pi-native 编排作为长期核心。

本次讨论新增结论：

- Multica 已经进一步产品化到 Squads / Autopilots / runtime usage / GitHub PR status。
- Telegraph 更不应复制完整 PM 控制平面。
- Agent team 第一版应偏 router，而非 parallel workers。
- Skill / MCP 安全治理是可区别于 Multica 的机会。

### 8.2 对 A-004 的更新

[A-004](../architecture/20260504-multica-implementation-map-and-telegraph-adaptation.md) 仍是源码级映射参考，但本机 Multica checkout 已落后于官网 5 月中旬能力。后续研究 Multica 时，应同时看：

- 当前 upstream code。
- docs。
- changelog。
- release tag。

不能只基于 2026-05-04 本地 checkout 推断产品状态。

### 8.3 对 A-005 的更新

[A-005](../architecture/20260505-telegraph-agent-runtime-extension-host-theory.md) 的核心原则继续作为底座：

- 先抽象运行事实。
- 核心类型不绑定 framework。
- Run 是第一概念。
- Trace 是协议一等投影。
- Extension 通过 capability / registry 进入，不直接控制宿主。

本次讨论是 A-005 在 Chat 产品策略上的展开。

### 8.4 对 P-001 的更新

[P-001](../roadmap/20260504-multi-agent-telegraph-roadmap.md) 的阶段路线需要重新排序：

- 原本的“daemon utility-process 托管执行器”要结合 A-008 / pagelet-local runtime 重新审视。
- Run Registry 与 RuntimeEvent UI 收敛仍是优先级最高。
- Team Router 应先于复杂 DAG。
- Multica 集成应降为可选外部 control plane bridge，而不是主线。

### 8.5 对 P-006 的更新

[P-006](../roadmap/20260518-harness-capability-extension-plan.md) 与本次结论高度一致：

- Extension / Tool / MCP / Skill 不应全局默认启用。
- chat / design / coding pagelet 应按 capability profile 选择能力。
- Shell / filesystem / patch 属于 integration capability，需要 permission。
- Skill / MCP 安全治理应成为 Chat agent team 方向的一部分。

---

## 9. 决策记录

| 决策 | 结论 | 理由 |
|------|------|------|
| Chat 是否做 agent team | 做，但第一版是 Team Router | 避免复杂 DAG 和失控并发 |
| 是否复制 Multica | 不复制完整 control plane | Multica 已强，Telegraph 应做 runtime cockpit |
| MCP 是否是差异化 | 不是 | MCP 是标准化工具接口，差异在 governance |
| 是否先做 marketplace | 不先做 | registry / permission / trace 未稳前 marketplace 空转 |
| 是否先做 workflow DSL | 不先做 | A-005 原则：先 RuntimeEvent，后 orchestration expression |
| 是否支持多 runtime | 支持，但通过 capability matrix 暴露差异 | 用户必须知道 runtime 能力和限制 |
| 是否支持 skill import | 支持，但必须加安全治理 | 第三方 skill 有 prompt / script 风险 |
| 是否接 Multica | 可作为外部 task source / control plane bridge | 主线不应变成 PM 平台 |

---

## 10. 待澄清问题

1. **Run Registry 存储选型**  
   SQLite、JSONL、现有 session repository、或 per-workspace store，哪一种最适合作为第一版？

2. **Runtime Capability 类型边界**  
   capability 应放在 `packages/agent-protocol` 还是 `packages/agent`？如果 UI 需要展示，就需要可序列化 descriptor。

3. **Handoff Artifact 是否进入 protocol**  
   如果进入 `RuntimeEvent`，需要 schemaVersion / fixture；如果先作为 artifact metadata，则需要 Run Console 支持 artifact ref。

4. **Team Router runtime 选择**  
   第一版 leader 应使用 `telegraph-orchestrator`、`pi-ai`，还是轻量 embedded model call？

5. **MCP adapter 落点**  
   MCP client 是 pagelet capability、agent package adapter，还是独立 services package？

6. **Skill 安全扫描深度**  
   第一版做 manifest / file list / source trust / dangerous token scan，还是更进一步做 script static analysis？

7. **Multica bridge 的时机**  
   是等 Run Console 稳定后再做，还是先实现 task import/export adapter 作为验证？

---

## 11. 下一步建议

最小可执行下一步：

1. 定义 `AgentRunRecord` 与 `RunRepository`。
2. 让 `ChatPageletWorker` 在 `send()` 中创建 run record，并在每个 terminal event 更新状态。
3. 把 `LlmTracePanel` 重命名 / 演进为 `RunConsolePanel`，先复用现有 timeline。
4. 为现有 runtime 添加 capability descriptor：
   - `pi-ai`
   - `embedded-kernel`
   - `telegraph-native-subagents`
   - `telegraph-orchestrator`
5. 在 settings 中展示 capability matrix。
6. 定义 `TeamSpec` 草案，但暂不实现复杂 DAG。

验收标准：

- 普通 chat run 可持久化、可重启查看。
- Telegraph native subagent run 可显示 child run / step。
- runtime picker 能显示至少 5 个能力维度。
- 团队功能设计不突破 pagelet-local runtime 边界。

---

## 12. 一句话总结

Multica 的启发不是“Telegraph 也要做一个 agent 项目管理工具”，而是确认了 agent team 的核心已经从聊天变成任务化、路由化、运行时化。Telegraph 要形成独特性，应把 Chat 做成 **本地 agent runtime cockpit**：每个 agent run 都能被观察、解释、治理、回放、比较和接管。
