---
id: D-001
title: Multica 范式与 Pi / pi-subagents 生态下的 Telegraph 多智能体能力对比
description: >
  围绕 Telegraph 期望的「多角色协同」能力，从产品线形态、编排与队列、角色与技能、
  运行时边界、可观测性与持久化等维度对比 Multica 与 Pi（含 pi-subagents），
  归纳能力差距与在 Electron 多进程架构中的可行集成路径。
category: discussion
created: 2026-05-04
updated: 2026-05-04
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
---

# Multica 范式与 Pi / pi-subagents 生态下的 Telegraph 多智能体能力对比

## 背景与目标

Telegraph 希望在产品内具备 **multi-agent** 能力：能够为不同任务分配 **角色（role）**，使多个智能体 **协同或并行工作**，并具备可管理的生命周期与可见进度。参考原型 [Multica](https://multica.ai/) 提供了「人类 + Agent 同一套工作流」的完整产品叙事：看板、指派、活动流、任务队列、运行时面板与可复用 Skills。

另一条路线是坚持 **[Pi](https://pi.dev/) 生态**：Pi 作为极简终端 harness，通过扩展组合能力；社区扩展 [pi-subagents](https://github.com/nicobailon/pi-subagents) 用 **父会话委派子会话** 的方式实现多角色（scout / planner / worker / reviewer 等）、链式与并行编排、异步后台运行、可选 **pi-intercom** 上的督导回调。

本文从多个维度对比这两种范式，并映射到 Telegraph 现有的 **Electron 多进程** 上下文（参见 `apps/telegraph` 与 wiki `A-002`），便于后续在 `roadmap/` 中收敛为具体里程碑。

---

## 来源

| 来源 | 说明 |
|------|------|
| [Multica 官网](https://multica.ai/) | 产品定位：Issue 指派、Agent 档案、活动时间线、任务全生命周期、Skills、统一 Runtime 面板、WebSocket 实时进度等 |
| [multica-ai/multica](https://github.com/multica-ai/multica) | 开源栈：Next.js 前端、Go（Chi + WebSocket + sqlc）后端、PostgreSQL/pgvector；本机 **daemon** 对接多种 Agent CLI（文档列出的后端中包含 Pi） |
| [Pi 官网](https://pi.dev/) | 终端 harness：交互 / print(JSON) / RPC / SDK；强调扩展、Skills、`AGENTS.md`、会话树与上下文工程；核心刻意保持精简 |
| [pi-subagents](https://github.com/nicobailon/pi-subagents) | Pi 扩展：`subagent` 工具、内置角色 Agent、`.chain.md` 工作流、并行 / 链式 / 后台、`worktree` 隔离、深度与递归防护、可选 intercom |

本地克隆路径（用户环境）：`/Users/ryuyutyo/Documents/code/modules/ai/multica` — 可用于对照目录结构与自托管文档，本文不依赖具体提交哈希。

---

## 1. 维度总览

下列对比刻意区分 **「团队协作与任务系统」（Multica 强项）** 与 **「单仓库内的委派编排」（pi-subagents 强项）**。

| 维度 | Multica | Pi + pi-subagents | 对 Telegraph 的含义 |
|------|---------|-------------------|---------------------|
| **产品心智** | 多用户 Workspace；Agent 与人类同为 assignee；Issue + 评论 + 状态机 | 单个（或少量）开发者会话中的 **父→子委派**；自然语言或 slash 触发 | Telegraph 若要走「小团队看板」，更接近 Multica；若走「IDE 侧编排助手」，更接近 Pi 扩展模型 |
| **编排拓扑** | 中心化服务端队列：**enqueue → claim → start → complete/fail**；daemon 在 Runtime 上执行具体 CLI | 去中心化：**父 Pi 会话** 调用 `subagent`，子会话为独立 Pi 进程；支持 chain / parallel / async | Multica 天然跨机器、跨账号；Pi 侧跨进程需自己在 Electron 内接 RPC/SDK 或管理子进程 |
| **角色（Role）建模** | Agent **实体**（配置、绑定 Runtime、Provider）+ Issue 字段 | **Markdown Agent 定义**（frontmatter：tools、model、skills…）+ 内置角色模板 | Pi 角色迭代成本低（文件即 Agent）；Multica 角色与权限和组织绑定更深 |
| **Skills** | 团队级复用、版本化（平台内有 Skills 概念） | Pi **SKILL.md** 注入 + `pi-subagents` 自带 orchestration skill（仅父会话） | 二者都可复利知识；Multica 偏「组织资产」，Pi 偏「仓库与用户目录资产」 |
| **运行时（Runtime）** | 显式 **Runtime** 注册、CLI 自动探测、仪表盘在线状态 | 子 Agent = 新 Pi 子进程；可选 **git worktree** 避免并行写冲突 | Telegraph 已有 **daemon / fork utility-process**（见 `A-002`）；Pi 子进程可落在 daemon 或独立 Node 子进程中 |
| **实时可见性** | WebSocket 推送工具调用与进度条式时间线 | TUI 内联进度；异步 run 的 `status.json` / 通知事件；无等价「企业看板」 | Electron UI 若要「Multica 级」活动流，需自建事件管道或对 Multica **仅消费 API** |
| **人机回路（HITL）** | Issue 评论、阻塞上报、人类改状态 | **pi-intercom**：子 Agent `contact_supervisor` 回调父会话 | Pi 路线可渐进引入 intercom；Multica 则沿用 Issue 交互 |
| **数据主权 / 部署** | 可 SaaS 可自托管（Docker/K8s）；协调面在后端 | 默认本地；会话 `.jsonl`、artifacts 在磁盘 | Telegraph 桌面应用通常偏好本地执行；Multica 自托管可与 Telegraph 同机 |
| **与「非 Pi」Agent 混跑** | daemon 统一调度 Claude Code、Codex、OpenCode 等 | 扩展主要针对 Pi；换 CLI 需额外适配层 | 若 Telegraph 要「厂商中立执行器」，Multica daemon 思路更可复用 |

---

## 2. Multica：能力拆解（与 Telegraph 的对照）

根据公开文档与仓库结构（如 `apps/`、`server/`、`packages/`、`docker/`），Multica 的核心是 **协调平面（coordination plane）** 与 **执行平面（execution plane）** 分离：

- **协调平面**：Issue、成员、权限、活动流、Skills 目录、Runtime 注册、任务状态机、实时事件。
- **执行平面**：用户机器上的 **multica daemon**，在选定 Runtime 上启动具体 Agent CLI（文档声明包含 Pi）。

对 Telegraph 的价值：

- **对标完整「multi-agent 产品能力」**：指派、并行任务队列、阻塞上报、团队可见性 — 这正是「像 Multica 一样」时的检查清单。
- **集成姿势**：Telegraph 不一定要重写后端；可以是 **Multica 的桌面壳 / 富客户端**：OAuth、Issue 视图、Runtime 状态嵌入现有窗口。代价是与 Multica 数据模型和发布节奏耦合。

风险：

- 自托管或多租户复杂度高于「只在本地 fork 里跑 Pi」。
- 桌面应用若强行内嵌完整 Multica 前端，打包体积与更新链路需单独评估。

---

## 3. Pi + pi-subagents：能力拆解（与 Telegraph 的对照）

Pi 官网强调 **RPC / SDK** 与极小内核；**pi-subagents** 在 Pi 之上补齐了「多 Agent」：

- **委派原语**：`subagent({ agent, task })`、并行 `tasks`、顺序 `chain`、fan-out / fan-in。
- **角色库**：scout、planner、worker、reviewer、oracle 等 — 对应用户所说的「分配不同角色」。
- **上下文策略**：`fresh` vs **fork**（从父会话叶子分出真实子会话），利于长链路上下文继承。
- **安全边界**：子 Agent **不注册** `subagent` tool、不带父级 orchestration skill，限制递归爆炸。
- **隔离**：并行编辑可使用 **`worktree: true`**（要求干净工作树、可配置 setup hook）。
- **异步**：后台运行 + `status` / `interrupt` / `resume`；与 **pi-intercom** 组合可做「子任务请示督导」。

对 Telegraph 的价值：

- **与 Pi 生态对齐**：Skills、`AGENTS.md`、扩展市场、未来 Pi 版本升级路径清晰。
- **编排逻辑主要在一个 TypeScript 扩展内**，便于阅读 `pi-subagents` 源码（如 `src/extension/index.ts`、`src/runs/**`）并抽象出自有的「AgentRunner」接口。

风险：

- **缺少组织级 Issue 与权限模型**；若 Telegraph 需要「多人协作看板」，要在应用层自建或与外部 PM 集成。
- Pi 官方文档写明 **核心不带 MCP**（可由扩展补）；Multica 侧重 daemon 与 CLI 探测，二者集成策略不同。
- 在 Electron 内嵌 Pi：**官方路径**是通过 **RPC/SDK** 驱动 Pi，而非假设用户始终在终端打开 Pi TUI — 需要在 main/daemon 进程管理子进程生命周期（与 `A-002` 中的进程模型对齐）。

---

## 4. Telegraph 架构映射（概念层）

现有 Telegraph 进程拓扑（`A-002`）已区分 **main / shared / daemon / pagelet / renderer**。若要接入 multi-agent，粗略有三种挂载点：

1. **daemon utility-process 作为 Agent 宿主**  
   长时间运行、已有服务端倾向；适合托管 Pi RPC、会话目录、异步任务轮询，减少对 UI 线程的阻塞。

2. **fork utility-process 作为单次任务沙箱**  
   与 pi-subagents 的子 Pi 进程哲学相近：一任务一隔离；需解决与 renderer 的端口 RPC 与日志回流。

3. **纯外部 Multica**  
   Telegraph 仅做视图壳与本地 daemon 安装引导；业务状态在 Multica 后端。最快获得「完整 Multica 能力」，定制化受限于上游。

具体选型已拆分为架构映射 [**A-004**](../architecture/20260504-multica-implementation-map-and-telegraph-adaptation.md) 与执行清单 [**P-001**](../roadmap/20260504-multi-agent-telegraph-roadmap.md)（本文 `status: draft` 仍可作为范式讨论基底）。

---

## 5. 能力差距小结（若目标是「像 Multica」）

| Multica 已有 | 仅用 Pi + pi-subagents 时 Telegraph 需补足 |
|--------------|--------------------------------------------|
| 多用户 Workspace 与权限 | 账户体系与 workspace（若需要） |
| Issue / 看板 / 统一活动流 | 自建数据模型或使用外部 PM API |
| 中心化任务队列与 claim | 自建队列或使用 Multica |
| Runtime 仪表盘（在线、用量） | 进程健康、子进程指标、模型用量采集 |
| 团队级 Skills 复利与市场 | 统一 SKILL 包分发与版本策略 |

反之，若目标是「**强编排、本地优先、Pi 技能复利**」，Pi + pi-subagents 更贴切，Multica 可作为 **产品参照** 而非运行时依赖。

---

## 6. 建议的后续动作（工程化）

1. **定标**：Telegraph 的 multi-agent 是「协作平台」还是「单用户编排器」——决定 Multica 模型 vs Pi 模型的权重。
2. **Spike**：在 **daemon** 进程内验证 Pi **RPC/SDK** 最小闭环（一次 `subagent` 调用 + 事件回传 renderer）。
3. **对照读码**：本地 `/Users/ryuyutyo/Documents/code/modules/ai/multica` 中 `server/` 任务状态机与 WebSocket 事件；`pi-subagents` 的 `src/runs/foreground/subagent-executor.ts` 与 async 通知路径。
4. **里程碑归档**：执行 checklist 见 **P-001**；Multica 源码级对照见 **A-004**。

---

## 7. 结论（草案）

- **Multica** 提供的是 **管理平台 + daemon 执行网格**，最适合「人类团队 + 多 Agent」在同一 Issue 体系内协作的产品叙事。
- **Pi + pi-subagents** 提供的是 **可嵌入的委派编排引擎**，最适合 **深度定制、本地优先、与 Pi Skills/扩展共生** 的路线。
- Telegraph 作为 Electron 应用，**进程层面已有挂载点**（`A-002`）；multi-agent 的成功关键在于：**协调状态放哪里**（自建 / Multica / 混合）以及 **执行器是否为 Pi 独占**。
- **实现路径与 Multica 源码对照**已单独展开为 **A-004**，**分阶段开发路径**见 **P-001**。

本文状态为 **draft**；与实现的交叉引用见 frontmatter `references`。
