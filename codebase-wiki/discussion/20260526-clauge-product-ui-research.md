---
id: D-018
title: Clauge 产品能力与 UI Shell 调研
description: >
  调研 Clauge 的核心能力、开发者场景特点与工程图纸式 UI 风格，
  并映射到 Telegraph 当前 Run Cockpit、Design Page 与主界面 shell 的可借鉴方向。
category: discussion
created: 2026-05-26
updated: 2026-05-26
tags:
  - clauge
  - competitor-research
  - ui-shell
  - run-cockpit
  - design-page
  - workspace
status: draft
sources:
  - title: ryuever/Clauge
    url: https://github.com/ryuever/Clauge
  - title: ansxuman/Clauge
    url: https://github.com/ansxuman/Clauge
  - title: Clauge 主站
    url: https://clauge.in/
  - title: Clauge Sidebar
    url: https://github.com/ryuever/Clauge/blob/main/src/lib/components/sidebar/Sidebar.svelte
  - title: Clauge SidebarButton
    url: https://github.com/ryuever/Clauge/blob/main/src/lib/components/sidebar/SidebarButton.svelte
  - title: Clauge Page Mounting
    url: https://github.com/ryuever/Clauge/blob/main/src/routes/%2Bpage.svelte
references:
  - id: D-014
    rel: related-to
    file: ./20260519-chat-agent-team-multica-strategy.md
  - id: D-016
    rel: related-to
    file: ./20260521-design-page-agent-generation-product-architecture.md
  - id: P-007
    rel: related-to
    file: ../roadmap/20260521-agent-run-cockpit-implementation-plan.md
  - id: P-008
    rel: related-to
    file: ../roadmap/20260521-design-page-agent-generation-implementation-plan.md
---

# Clauge 产品能力与 UI Shell 调研

> Clauge 值得 Telegraph 借鉴的重点不是“再加 REST / SQL / SSH 工具”，而是它把 Agent、Workspace、数据工具、文件工具和场景 AI 收束为一个 mode-first 的开发者操作舱。对 Telegraph 来说，最有价值的启发是：收窄主导航、强化 Run / Workspace / Artifact 的工作流心智，并把 Chat 从独立页面降级为贴着场景工作的 AI 能力。

## 来源

- [ryuever/Clauge](https://github.com/ryuever/Clauge)
- [ansxuman/Clauge](https://github.com/ansxuman/Clauge)
- [Clauge 主站](https://clauge.in/)
- [Clauge Sidebar](https://github.com/ryuever/Clauge/blob/main/src/lib/components/sidebar/Sidebar.svelte)
- [Clauge SidebarButton](https://github.com/ryuever/Clauge/blob/main/src/lib/components/sidebar/SidebarButton.svelte)
- [Clauge Page Mounting](https://github.com/ryuever/Clauge/blob/main/src/routes/%2Bpage.svelte)

## 结论摘要

Clauge 的产品主张可以概括为 **one window, every dev tool**：同一桌面窗口内承载 coding agents、workspace board、REST、SQL、NoSQL、SSH、Explorer，并通过内建 MCP 把 workspace 暴露给外部 agent。

它的差异化不在单个工具能力，而在三层组合：

| 层次 | Clauge 做法 | 对 Telegraph 的启发 |
| --- | --- | --- |
| 模式层 | Agent / Workspace / REST / SQL / NoSQL / SSH / Explorer 是一等 mode | Telegraph 的 Design / Chat / Runs / Connection / Monitor 应像 mode，而不是普通菜单项 |
| 场景 AI | 每个 mode 有自己的上下文、工具与安全边界 | Chat 应降级为能力，Run Reviewer / Design Assistant / Connection Diagnostics 才是主心智 |
| Shell 层 | 72px 左 rail + 当前 mode 工作区 + top tabs | Telegraph 当前 216px 主侧栏 + 256px 二级侧栏过重，应收敛为 compact cockpit |

建议优先推进 UI shell，而不是复制 Clauge 的工具矩阵：Telegraph 的独特性仍应落在本地 Run Cockpit、DesignBuild Artifact、Capability Governance 与可观察执行链路上，详见 [D-014](./20260519-chat-agent-team-multica-strategy.md)、[P-007](../roadmap/20260521-agent-run-cockpit-implementation-plan.md)。

## Clauge 核心能力

### 1. Agent Mode：多 provider coding agent 工作台

Clauge 将 Claude、Codex、Gemini、OpenCode 等外部 coding agent 放入一个统一桌面 shell：session、purpose、provider、binary path、worktree、usage、plugins 和 terminal 都围绕 agent session 展开。其代码侧可见 `src-tauri/src/modes/agent/*` 负责 terminal、worktree、git、usage 与 plugin 等能力。

这个模式对 Telegraph 的启发是：**Agent 不应该只是 Chat 消息流**。Telegraph 已在 [P-007](../roadmap/20260521-agent-run-cockpit-implementation-plan.md) 中把 Chat 推向 Run Console / persisted events / Replay，Clauge 进一步说明用户会自然期待“会话 + 工作目录 + 产物 + 终端 + 使用统计”被放在同一个 agent cockpit。

### 2. Workspace Mode：Board / Note / Coworker 的协作控制平面

Clauge Workspace 包含 boards、cards、notes、coworkers、issue scan、PR、card claim 与 inbox。更重要的是，README 明确强调它内建 MCP server，将 `boards_*`、`cards_*`、`notes_*`、`coworkers_*`、`workspace_*`、`rest_collection_*` 等工具暴露给外部 MCP client。

这对 Telegraph 是一个明显缺口：当前已有 Run、Design Session、Subagent、Trace、Artifact，但缺少一个“工作项聚合层”。如果继续只以 Chat / Design / Runs 分散呈现，用户需要自己记住这些对象之间的关系。Clauge 的 Workspace 提醒我们应该考虑一个 Telegraph Workspace / Inbox：任务、Run、Artifact、Approval、Review、Owner、Status 都能挂上去。

### 3. Tool Modes：传统开发工具 + 场景 AI

Clauge 的 REST、SQL、NoSQL、SSH、Explorer 不只是普通客户端。源码中每个 mode 都有对应 `ai_tools` 或 `ai/context` / `ai/prompt`：

- REST：collection、environment、history、curl import/export。
- SQL：Postgres / MySQL / SQLite / ClickHouse / Cloudflare D1，含 schema introspection、query explain。
- NoSQL：MongoDB / Redis viewer 与 query editor。
- SSH：profile、tunnel、terminal、interactive auth，并对 AI shell execute 做安全限制。
- Explorer：local / SFTP / FTP / S3 / Azure Blob 文件浏览与 transfer。

关键产品信号是：**AI 工具贴着当前 mode 的对象模型工作**。这比全局 chat 的上下文更窄、更安全，也更容易形成用户信任。

### 4. Cross-mode Layer：本地优先 + MCP + cloud sync

Clauge 是 Tauri + Svelte 桌面应用，Rust backend 按 mode 纵切，前端持续挂载 mode panel。`src/routes/+page.svelte:23-38` 注释明确说明所有 mode panel 持续 mounted，切换时只改 `visibility`，以保留 xterm、SSH handle、SFTP session、CodeMirror editor、result table、scroll/focus 状态。

这个模式与 Telegraph 的 PageletHost / keep-alive 方向一致：多 pagelet 的状态保活不是可选体验，而是开发者工具的基本要求。

## 场景特点

Clauge 面向的是“同时打开很多工具的开发者”，不是单次聊天型 AI 用户。它的典型场景有四类：

| 场景 | 用户任务 | 产品要求 |
| --- | --- | --- |
| 多 agent 开发 | 并行开多个 coding session，切换 provider / repo / worktree | 会话必须保活，terminal 不可因切换丢失 |
| 任务板协作 | issue 进入 board，coworker/agent 认领 card，产出 PR | 工作项要有 owner、状态、评论、外部来源 |
| 数据与接口调试 | REST / SQL / NoSQL 查询、历史、环境变量、schema | AI 必须知道当前连接、库表、请求上下文 |
| 远程机器与文件 | SSH terminal、SFTP/S3/Blob 浏览、transfer | 高风险动作需要显式确认和可回放历史 |

Telegraph 的目标场景与 Clauge 有重叠，但不应重合。Telegraph 更适合走 **runtime cockpit / design artifact factory / remote agent OS**：围绕 Run、Artifact、Trace、Permission、Replay、Remote Intent 做深，而不是把每种开发工具都做成客户端。

## UI 设计观察

### 主站视觉：Engineering Schematic

Clauge 主站当前视觉语言很明确：

- 深黑 navy 基底：`#0a0d14`、`#0e121a`、`#07090f`。
- 强 coral accent：`#ff5436`，只用于主 CTA、关键词、active / warning signal。
- hairline grid：细线网格、分割线、plate label、scale annotation。
- 凝缩 display font + mono micro labels：大标题有工程海报感，小标签有仪表盘感。
- 少圆角、少卡片、少彩色块：整体靠线、留白、对比与密度建立“酷”的感觉。

这套视觉和 Telegraph 的 agent cockpit / design runtime 主题是兼容的。它比当前 `packages/ui/src/styles/tokens.css:32-56` 的柔和蓝灰/薄荷/紫调更硬朗，也更适合表达“本地运行时控制台”。

### App Shell：72px mode rail

Clauge app 的左侧主导航是 compact rail：

- `src/lib/components/sidebar/Sidebar.svelte:470-481` 定义 `.sidebar` 宽度为 `72px`。
- `src/lib/components/sidebar/SidebarButton.svelte:39-54` 定义单个入口宽 `60px`、最小高 `52px`。
- `src/lib/components/sidebar/Sidebar.svelte:253-290` 将 Agent / Workspace / REST / SQL / NoSQL / SSH / Explorer / History 全部表达成 mode buttons。

相比之下，Telegraph 当前主导航在 `apps/main/src/application/browser/App.tsx:74-139` 中使用 `w-[216px]` 的完整 sidebar，每个 page entry 还有 label + description。Chat / Design 内部又各自有 `w-64` 二级 session sidebar：

- Chat：`apps/chat/src/application/browser/components/ChatSidebar.tsx:27-31`。
- Design：`apps/design/src/application/browser/DesignSessionSidebar.tsx:35-40`。

在 Design / Chat 这种高密度工作区内，216px + 256px 的组合会明显挤压 preview、source、trace、message timeline。

### 色彩与层次

Telegraph 当前 token：

- light theme 从 `packages/ui/src/styles/tokens.css:1-30` 开始，偏明亮 SaaS。
- dark theme 在 `packages/ui/src/styles/tokens.css:32-56`，仍偏温和蓝灰。
- 主侧栏 active 还用 per-page accent：`apps/main/src/application/browser/App.tsx:25-31`，design/chat/run/monitor/connection 各有颜色。

Clauge app 反而把 mode hues 全 alias 到一个系统 accent，`src/app.css:97-109` 用单一 `--acc` 统摄 `--rest`、`--sql`、`--nosql`、`--agent`、`--ssh`、`--explorer`。这个设计值得借：Telegraph 可以减少“每个入口一个颜色”的玩具感，改为单主 accent + 状态色。

## Telegraph 可借鉴方向

### 1. 主导航从 Page Sidebar 改为 Mode Rail

第一步应只改 shell，不碰 IPC / pagelet topology：

- 将 `apps/main/src/application/browser/App.tsx:76` 的 `w-[216px]` 改为 64-72px rail。
- `PAGE_ICONS` 保留，但 entry 只展示 icon + 极短 label，description 移入 tooltip 或顶部 context bar。
- Settings 移到底部 icon button，避免占据与业务 page 同等的信息宽度。
- active 状态用左侧 2px coral rail / subtle fill，不再使用大块彩色 icon tile。

这一步收益很大，风险很小：只改变 renderer shell，不改 `PageletHost` 与 ConnectionOrchestrator。

### 2. 二级 session sidebar 默认收起

Chat / Design 的 session list 不应默认长期占 `w-64`。建议：

- 默认 collapsed 为 `w-12` 或 `w-14`，保留新建按钮与当前 session 状态点。
- 展开动作由 rail button、快捷键或 hover-intent 触发。
- 展开时可以 overlay 当前内容，而不是挤压 preview/source，尤其是 Design。
- 对 Design session row 保留 status dot，因为它对 run state 有价值。

实现落点是 `ChatSidebar.tsx` 与 `DesignSessionSidebar.tsx`，可以先只调整默认值和展开样式，不改变数据流。

### 3. 建立 Top Context Bar / Tab Strip

Clauge 的另一个启发是：mode rail 只负责切换，当前上下文由顶部细栏承载。Telegraph 可以补一个统一 top context bar：

- 左侧显示当前 mode、active session/run、status。
- 中部显示 pagelet-local tabs 或 artifact tabs。
- 右侧放 settings、trace、model/runtime、connection health。

这样可以把 sidebar 里的 description、底部 brand 文案、pagelet 内重复标题都收掉，让主工作区更像 cockpit。

### 4. Chat 从主入口降级为场景能力

Clauge 的 AI 是 mode-aware 的；Telegraph 可以沿同一方向做产品分层：

- Design 中是 Design Assistant，围绕 artifact、component、preview、source、visual review。
- Runs 中是 Run Reviewer，围绕 trace、tool call、permission、failure、replay/fork。
- Connection 中是 Diagnostics Assistant，围绕 participant、channel、process、log、health。
- Chat 作为全局 command console / scratchpad，而不是唯一 AI 入口。

这与 [D-016](./20260521-design-page-agent-generation-product-architecture.md) 和 [P-008](../roadmap/20260521-design-page-agent-generation-implementation-plan.md) 的 DesignBuild 方向一致。

### 5. 增加 Telegraph Workspace / Inbox 层

Clauge Workspace 的最大启发是把“任务”作为上层对象。Telegraph 也可以新增轻量 Workspace，而不是复制完整 kanban：

- WorkItem：来自用户 prompt、remote intent、issue、design request、chat run。
- Run Link：一个 work item 可以关联多个 run / retry / fork。
- Artifact Link：关联 design artifact、patch、preview、trace bundle。
- Approval：记录等待用户确认的 tool / patch / remote action。
- Inbox：聚合 failed run、waiting approval、needs review、remote request。

这会把 Telegraph 的 Run Cockpit 和 Design Page 串成产品，而不是一组 pagelet。

## 建议实施顺序

| Phase | 目标 | 改动范围 | 验收 |
| --- | --- | --- | --- |
| Phase 0 | UI shell proof | `App.tsx` + tokens | 主导航 72px rail，内容区可用宽度明显增加 |
| Phase 1 | 二级侧栏瘦身 | ChatSidebar / DesignSessionSidebar | 默认 collapsed，展开不破坏工作区布局 |
| Phase 2 | Cockpit theme | `packages/ui/src/styles/tokens.css` | 深黑 navy + coral accent + hairline border，减少多彩 page accent |
| Phase 3 | Top context bar | main renderer + pagelet opt-in props | 当前 page/session/run/status 不再占 sidebar 空间 |
| Phase 4 | Workspace / Inbox concept | protocol + UI prototype | Run、Artifact、Approval 可被同一个 work item 聚合 |

推荐先做 Phase 0-2。它们不会触碰 agent runtime、IPC、RPC 或 pagelet process，只是视觉与布局层改造，能快速改善“入口太占空间、整体不够酷”的问题。

## 风险与 No-Go

- 不要把 Telegraph 做成 Clauge clone。REST / SQL / SSH 客户端不是 Telegraph 当前差异化重点。
- 不要重新引入每个 mode 一个强色。多彩入口会削弱 cockpit 的专业感。
- 不要在主 shell 里塞业务描述。入口只做导航，详情交给 top context bar 和 pagelet 内部。
- 不要为了视觉改动触碰 ConnectionOrchestrator / PageletHost 协议边界。UI shell 改造应先保持纯 renderer。
- 不要默认把二级 sidebar 完全移除。Chat / Design session list 仍然需要，只是默认不应长期占 256px。

## 对既有路线图的影响

- [P-007](../roadmap/20260521-agent-run-cockpit-implementation-plan.md)：Run Console 应从 Chat 内右侧功能逐步升级为 shell 级 cockpit 入口。
- [P-008](../roadmap/20260521-design-page-agent-generation-implementation-plan.md)：Design Page 的 workbench 更需要横向空间，主 rail + collapsed session list 应作为 UI 基础设施优先项。
- [D-014](./20260519-chat-agent-team-multica-strategy.md)：Clauge 再次验证“工具数量不是差异化”，Telegraph 应继续押注 runtime cockpit / capability governance。
- [D-016](./20260521-design-page-agent-generation-product-architecture.md)：Design 的 AI 应贴着 artifact / preview / source / component context，而不是复用全局 Chat 心智。
