---
layout: home

hero:
  name: "Telegraph Wiki"
  text: "源码阅读与概念笔记"
  tagline: 架构分析 · 技术讨论 · Issue 记录 · 参考手册 · 路线图
  actions:
    - theme: brand
      text: 文档索引
      link: /INDEX#文档索引
    - theme: alt
      text: 书写规范
      link: /CONVENTIONS

features:
  - title: 架构分析
    details: 模块职责、依赖与系统设计笔记。
    link: /INDEX
  - title: 技术讨论
    details: 方案对比、概念辨析与深度笔记。
    link: /INDEX
  - title: Issue 记录
    details: AI coding 实操过程中的问题现象、修复动作与回归结论。
    link: /INDEX
  - title: 参考手册
    details: 目录结构与速查。
    link: /INDEX
  - title: 规划路线
    details: 差距分析、优先级与待办。
    link: /INDEX
---

> 本目录（`codebase-wiki/`）存放 AI 辅助生成的分析文档、技术讨论、Issue 记录、参考手册与规划路线。  
> 书写规范请参考 [CONVENTIONS.md](./CONVENTIONS.md)（也可在仓库中直接打开该文件）。

在分类子目录下添加首篇文档后，在仓库根目录运行 skill 自带的 `regenerate-sidebar.mjs` 以更新侧栏与导航。

## 文档索引

### architecture/ — 架构分析

| # | 文件 | 标题 | 概述 |
|---|------|------|------|
| A-001 | [20260504-di-and-cross-platform-paradigm.md](./architecture/20260504-di-and-cross-platform-paradigm.md) | Telegraph DI 容器与多平台代码维护范式 | 剖析 `@x-oasis/di` 容器、`common/node/electron-main/browser` 跨平台目录分层与"同接口跨进程"的 RPC 代理范式，沉淀新增服务的开发规范。 |
| A-002 | [20260504-multi-process-topology.md](./architecture/20260504-multi-process-topology.md) | Telegraph 多进程拓扑（main / daemon / shared / pagelet / preload / renderer） | 五大进程角色的职责定位、构建配置、启动顺序与端口握手；端口经纪人 + RPC 路由全貌。 |
| A-003 | [20260504-stability-and-performance-monitoring.md](./architecture/20260504-stability-and-performance-monitoring.md) | Telegraph 性能与稳定性监控体系 | 七个监控维度（崩溃 / 性能 / 心跳 / 日志 / 诊断快照 / 端口健康 / 错误边界）展开，并标注代码层差距与改进项。 |
| A-004 | [20260504-multica-implementation-map-and-telegraph-adaptation.md](./architecture/20260504-multica-implementation-map-and-telegraph-adaptation.md) | Multica 源码实现映射与 Telegraph「类 Multica」能力适配路径 | 基于 multica server/daemon/execenv/pkg/agent/realtime 分层对照 Telegraph AgentHandler、PiAgent（pi-ai）与 daemon 进程；三条适配路径与模块映射表。 |
| A-005 | [20260505-telegraph-agent-runtime-extension-host-theory.md](./architecture/20260505-telegraph-agent-runtime-extension-host-theory.md) | Telegraph Agent Runtime 与 Extension Host 理论基础 | 将 Telegraph 从 Pi GUI/CLI wrapper 提升为通用 agent runtime host 与 extension host，定义 Run、RuntimeEvent、Tool、Extension、Hook、Trace、Workflow Pattern 等长期抽象。 |
| A-006 | [20260505-chat-to-llm-data-flow.md](./architecture/20260505-chat-to-llm-data-flow.md) | Chat 消息到 LLM 数据流（当前架构） | 从用户输入到 LLM 返回的五层调用链（renderer → main → daemon → runtime → pi-ai）、IPC/RPC 通道设计、RuntimeEvent 统一事件协议与响应回流路径。 |
| A-007 | [20260506-pagelet-process-communication.md](./architecture/20260506-pagelet-process-communication.md) | Telegraph 多进程架构全貌 | 完整多进程架构文档：进程拓扑、Panel/Pagelet/PageletProcess 三层机制、侧边栏 IPC 面板切换（Chat/Design/Home）、MessagePort 通信、Resume 断线重连、Monitor 改造案例与踩坑记录、生命周期管理。**已被 A-008 替代为目标态架构。** |
| A-008 | [20260509-telegraph-final-process-architecture.md](./architecture/20260509-telegraph-final-process-architecture.md) | Telegraph 最终进程架构（Main · Shared · Daemon · Pagelet） | 不背历史包袱的目标态权威定义：Renderer 只与 Pagelet 直连；Shared/Daemon/Main 能力由 Pagelet ForwardingProxy 透明转发；Daemon 仅监控、Main 独占进程治理；所有 channel 经 x-oasis ConnectionOrchestrator 编排；进程崩溃通过 `replaceParticipantChannel` 透明换链。 |
| A-009 | [20260512-runtime-directory-convention-and-file-structure.md](./architecture/20260512-runtime-directory-convention-and-file-structure.md) | Telegraph 运行时目录分层与文件结构约定 | 以 VS Code 的 node/electron-browser/browser-common/browser 范式为参照，系统梳理 Telegraph 的 common / electron-main / electron-browser / browser / node 五层运行时目录含义、代码边界、完整文件映射与跨目录 import 规则矩阵。 |
| A-010 | [20260513-vscode-contribution-model-for-telegraph.md](./architecture/20260513-vscode-contribution-model-for-telegraph.md) | VS Code Contribution 模型对 Telegraph 可扩展架构的启示与落地路径 | 以 VS Code extension 的 contributes 声明式贡献点为参照，分析 apps-v2 中 4 套隐式注册模式（participant ID / service path / PageConfig / DI Registry），提出 TelegraphManifest 声明式契约设计与三层贡献模型（Static Manifest → DI Registration → Runtime Binding），使新 Pagelet 接入从改 6 处代码收敛到写 1 份 manifest。 |
| A-011 | [20260515-connection-topology-and-patterns.md](./architecture/20260515-connection-topology-and-patterns.md) | Telegraph 连接拓扑与通信模式 | 三层通信模型（IPC / Direct / Utility Control）的全局拓扑、各进程启动建连时序、Pagelet 全生命周期连接演变、重连策略、以及跨 Pagelet 高频交互的 Shared 服务发现 + P2P 直连方案。 |

### discussion/ — 技术讨论

| # | 文件 | 标题 | 概述 |
|---|------|------|------|
| D-001 | [20260504-multica-vs-pi-multi-agent-for-telegraph.md](./discussion/20260504-multica-vs-pi-multi-agent-for-telegraph.md) | Multica 范式与 Pi / pi-subagents 生态下的 Telegraph 多智能体能力对比 | 从产品线形态、编排队列、角色与技能、运行时与观测性等维度对比 Multica 与 Pi（含 pi-subagents），并映射到 Telegraph Electron 多进程的集成取舍与能力缺口。 |
| D-002 | [20260506-flue-pi-integration-analysis.md](./discussion/20260506-flue-pi-integration-analysis.md) | Flue 框架的 PI 集成模式与 Role/Connector 机制分析 | 分析 Flue（withastro/flue）如何集成 PI（pi-agent-core + pi-ai）作为嵌入式运行时，详细阐述 Role 角色指令系统和 Connector 第三方服务适配机制，并探讨对 Telegraph 的借鉴价值。 |
| D-003 | [20260506-spawn-cli-vs-embed-orchestra-agent-invocation.md](./discussion/20260506-spawn-cli-vs-embed-orchestra-agent-invocation.md) | Spawn CLI 与 Embed Orchestra 两种 Agent 调用模式对比 | 以 open-design（spawn CLI）和 Telegraph（embed orchestra）为实例，对比两种宿主应用集成 AI agent 的架构范式的优缺点与适用场景。 |
| D-004 | [20260506-electron-multi-renderer-vs-single-renderer.md](./discussion/20260506-electron-multi-renderer-vs-single-renderer.md) | Electron 多 Renderer vs 单 Renderer 面板架构调研与迁移方案 | 调研 VS Code、Slack、Discord 等主流应用架构，分析 Telegraph 从 BrowserView 多 renderer 迁移到单 renderer 的可行性、影响面与实施路径。 |
| D-005 | [20260508-renderer-pagelet-channel-convergence.md](./discussion/20260508-renderer-pagelet-channel-convergence.md) | Renderer ↔ Pagelet 通道收敛设计（Forwarding Proxy） | 对比 renderer 通道收敛三种方案，确定 "1 条 direct port + pagelet Forwarding Proxy" 方案 A，给出 exposeRemoteService 工具函数草稿。 |
| D-006 | [20260508-x-oasis-orchestrator-capability-gaps.md](./discussion/20260508-x-oasis-orchestrator-capability-gaps.md) | x-oasis ConnectionOrchestrator 能力缺口分析（telegraph 视角） | 盘点 @x-oasis/async-call-rpc-electron v0.3.0 的 8 项能力缺口，分 P0/P1/P2 三档，给出 API 草案与 telegraph 阻塞 Phase。 |
| D-007 | [20260514-x-oasis-capability-gaps-v2.md](./discussion/20260514-x-oasis-capability-gaps-v2.md) | x-oasis 能力差距盘点 v2（telegraph apps/ 实际落地视角） | D-006 P0 三项落地后的演进版：把 9 项"已就绪未使用" vs 7 项"上游真实缺失"分开，重点指出 CircuitBreaker 接入 RPC 调用栈缺失（空壳 bug）与 UtilityProcessSupervisor 缺失，给 x-oasis ROI 排序需求清单与 telegraph 第一波改造清单。 |
| D-008 | [20260515-apps-framework-gap-review-after-supervisor.md](./discussion/20260515-apps-framework-gap-review-after-supervisor.md) | apps/ 框架层短板审查（D-007 类别 A 落地后视角） | D-007 类别 A 落地后对 apps/ + packages/services/ 的重新盘点：列出 7 项已稳固能力 + 11 项短板（H1-H11，🔴/🟡/🟢 分级）+ 3 项必须等 x-oasis 上游 + 6 步第一波改造建议。 |
| D-009 | [20260515-renderer-spa-framework-selection.md](./discussion/20260515-renderer-spa-framework-selection.md) | Renderer SPA 框架选型（React Router v7 + 自实现 KeepAlive） | 从"侧边栏多入口/切换不丢状态/路由级 lazy"诉求出发对比 Remix / Next.js / RR v7 / TanStack Router，决定 Vite + React Router v7 (data mode, SPA) + 自实现 PageletHost (display 切换) 方案，并定义与 A-008 ConnectionOrchestrator + Pagelet 的协作约定。 |
| D-010 | [20260515-react-native-mobile-monorepo-integration.md](./discussion/20260515-react-native-mobile-monorepo-integration.md) | React Native Mobile 接入 Monorepo 调研 | 调研在现有 Electron + pnpm monorepo 基础上接入 Expo RN 移动端的目录结构、包共享边界（runtime-contracts/stores 可共享，services/ui 不可共享）、NativeWind vs Tamagui 选型、Metro 配置要点、服务接口抽象层设计（IChatService 等），以及 Bluesky / Solito / Tamagui starter 三个可借鉴项目。 |
| D-011 | [20260517-chat-agent-runtime-integration.md](./discussion/20260517-chat-agent-runtime-integration.md) | Chat Agent Runtime 接入迁移文档 | 将 apps/chat 的 mock agent 能力替换为真实 agent runtime 执行（PiAiRuntime / PiEmbeddedRuntime / LangGraphRuntime / VercelAiRuntime），含端到端数据流设计、RuntimeEvent → ChatStreamEvent 映射表、实施步骤与风险分析。 |
| D-012 | [20260517-telegraph-vs-open-design-agent-comparison.md](./discussion/20260517-telegraph-vs-open-design-agent-comparison.md) | Telegraph vs Open Design Agent 接入方式对比分析 | 深入分析 Open Design 的 CLI-Adapter 模式（spawn 外部 CLI 子进程 + per-format stdout parser）与 Telegraph 的 SDK-Embedded 模式（进程内 RuntimeExecutor）的核心差异，给出 12 维度对比表、CLI Adapter 实施工作量评估（~15 天）、关键决策分析（支持/反对/推荐混合模式）。 |
| D-013 | [20260517-orchestrator-core-harness-control-feasibility.md](./discussion/20260517-orchestrator-core-harness-control-feasibility.md) | `@orchestrator/core` 作为 Harness Control 接入可行性分析 | 评估 langgraphjs/libs/orchestrator 零依赖 Pregel 图编排引擎接入 Telegraph 的可行性：5 个核心契合点（进程合规、API 桥接、HITL 映射、Checkpoint、Swarm）、4 个摩擦点与解决方案、三步集成策略、风险与架构合规性自检。 |

### issue/ — Issue 记录

| # | 文件 | 标题 | 概述 |
|---|------|------|------|
| I-001 | [20260504-chat-tailwind-not-applied-postmortem.md](./issue/20260504-chat-tailwind-not-applied-postmortem.md) | Chat 页面 Tailwind 未生效故障复盘 | 归档 2026-05-04 chat 页面“无样式”问题的现象、根因拆解、时间线、修复动作、回归验证与复发排查清单。 |
| I-002 | [20260505-pi-ai-llm-trace-await-sink-deadlock.md](./issue/20260505-pi-ai-llm-trace-await-sink-deadlock.md) | pi-ai 流式首包后卡住与助手长期 pending（llm_trace await sink 死锁） | pi-ai 路径下首条 stream 为 `start` 后 await `llm_trace` 的 sink.push 与主进程 `invoke(runStream)` 互等；改为 `safePushLlmTrace` 及回归要点。 |
| I-003 | [20260508-renderer-design-rpc-ping-debug.md](./issue/20260508-renderer-design-rpc-ping-debug.md) | Renderer ↔ Design Utility RPC Ping 全链路调试复盘（Phase 4–5） | 三个独立 Bug：port 提前到达被丢弃（earlyPorts 队列修复）、MessagePort 无法跨 contextBridge（移入 preload 修复）、RPCServiceHost 空数组误判导致 handler 静默丢弃（isHandlerMap 加 length > 0 修复）。 |

### reference/ — 参考手册

| # | 文件 | 标题 | 概述 |
|---|------|------|------|
| R-001 | [20260508-x-oasis-link-to-source-setup.md](./reference/20260508-x-oasis-link-to-source-setup.md) | x-oasis 本地 source link 配置手册（telegraph） | 把 telegraph 4 个 app 全部指向本地 x-oasis source 的完整步骤：上游 12 个包改 main + telegraph pnpm.overrides + 移除 vite external + tsconfig paths。 |

### roadmap/ — 规划路线

| # | 文件 | 标题 | 概述 |
|---|------|------|------|
| P-001 | [20260504-multi-agent-telegraph-roadmap.md](./roadmap/20260504-multi-agent-telegraph-roadmap.md) | Telegraph 多智能体（类 Multica）分阶段路线图 | 从 Run/事件契约、execenv 与 Backend 分叉、daemon 托管执行，到 pi-subagents 编排与可选协调平面/Multica 集成的分阶段清单与验收标准。 |
| P-002 | [20260505-agent-runtime-extension-host-phase-gates.md](./roadmap/20260505-agent-runtime-extension-host-phase-gates.md) | Telegraph Agent Runtime / Extension Host 实施 Phase-Gate 模板 | 基于 A-005 的阶段门禁模板，按 Entry/Exit/Gate Evidence/No-Go 管理 contracts、runtime 迁移、extension host、安全与 SLO 落地。 |
| P-003 | [20260508-port-management-orchestrator-migration-plan.md](./roadmap/20260508-port-management-orchestrator-migration-plan.md) | Port Management → ConnectionOrchestrator 迁移计划（design 先行） | 把 telegraph 手工 port 编排迁移到 ConnectionOrchestrator 的 9 阶段路线图；第一阶段只覆盖 design，含可视化 Connections Tab 验收物与 x-oasis 能力依赖。 |
| P-004 | [20260518-agent-protocol-pagelet-harness-plan.md](./roadmap/20260518-agent-protocol-pagelet-harness-plan.md) | Telegraph Agent Protocol 与跨 Pagelet Agent 架构计划 | 将 runtime-contracts 升级为 Agent Protocol Layer，并在 packages/agent 内建设 pagelet-local harness，支撑 chat、design、multi-agent 与未来 orchestrator adapter 的统一演进。 |
| P-005 | [20260518-orchestrator-core-controlled-migration-plan.md](./roadmap/20260518-orchestrator-core-controlled-migration-plan.md) | Orchestrator Core 受控迁入与 Agent Harness 接入计划 | 将 langgraphjs/libs/orchestrator 作为可独立演进的 orchestrator-core 内核迁入 Telegraph，并通过 Agent Runtime adapter 接入 pagelet-local harness，保持协议层与 graph 实现解耦。 |
