---
id: P-001
title: Telegraph 多智能体（类 Multica）分阶段路线图
description: >
  在 A-004 的源码映射基础上，将 Telegraph 适配拆为可交付阶段：从 Run 抽象与事件模型，
  到 daemon 托管执行、目录隔离、会话恢复与可选 Pi CLI/pi-subagents，再到协调平面扩展或 Multica 集成。
category: roadmap
created: 2026-05-04
updated: 2026-05-04
tags:
  - telegraph
  - multi-agent
  - multica
  - roadmap
status: draft
references:
  - id: A-004
    rel: derived-from
    file: ../architecture/20260504-multica-implementation-map-and-telegraph-adaptation.md
  - id: D-001
    rel: related-to
    file: ../discussion/20260504-multica-vs-pi-multi-agent-for-telegraph.md
---

# Telegraph 多智能体（类 Multica）分阶段路线图

本文是执行清单；设计推理与 Multica 源码对照见 [**A-004：Multica 源码实现映射与 Telegraph 适配路径**](../architecture/20260504-multica-implementation-map-and-telegraph-adaptation.md)。范式取舍见 **D-001**。

---

## 阶段 0：定标（1–2 次技术评审）

- [ ] 选定主路径：**嵌入 Multica** / **自建协调平面** / **单机 AgentRuntime（路径 C）**（见 A-004 §5）。  
- [ ] 明确 Pi 形态：**仅 pi-ai（现状）** vs **增加 Pi CLI（对齐 Multica `piBackend` + pi-subagents）**。  
- [ ] 定义「多 Agent」最小演示：**并行两次 run** 或 **链式两次 run**，验收 UI 与时间线。

---

## 阶段 1：Run 模型与事件契约（不挪进程也可做）

- [ ] 引入 **`AgentRun`（或 `Task`）** 实体：`id`、状态、`createdAt`、会话指针、`workDir`、错误原因（对齐 Multica `PinTaskSession` 语义）。  
- [ ] 持久化：**SQLite / electron-store / 文件**，任选其一；重启后能列出历史 run。  
- [ ] 定义 **`AgentRunEvent`枚举**：至少包含 `queued | dispatch | progress | message | completed | failed | cancelled`（命名可对齐 `pkg/protocol/events.go` 的 `task:*`）。  
- [ ] 将 `AgentHandler` 中 **`AGENT_STREAM_DATA_CHANNEL` 的 payload** 逐步映射为上述事件（保持向后兼容或版本字段）。

**验收**：单次对话可在面板看到结构化时间线，刷新应用后 run 仍在。

---

## 阶段 2：执行环境与 Backend 分叉

- [ ] 实现 **per-run 工作目录**（A-004 §2.3 / §4 `execenv` 等价）：`<userData>/runs/<runId>/workdir` + `meta.json`。  
- [ ] 在 `packages/agent` 抽象 **`AgentBackend` 接口**（`execute(prompt, opts) → AsyncIterable<Event>` 或 Multica 式 `Session`）。  
- [ ] **实现 1**：迁移现有逻辑为 `PiAiBackend`。  
- [ ] **实现 2（可选）**：`PiCliBackend`（`pi -p --mode json --session <path>`），参数与 Multica `pkg/agent/pi.go` 行为对齐，便于接 pi-subagents。

**验收**：同一 UI 可切换 backend；CLI 模式下会话文件路径可复用（恢复一次中断 run）。

---

## 阶段 3：daemon utility-process 托管执行器

- [ ] 将 **长时间运行**的 `execute` 从 **main** 迁到 **daemon**（见 **A-002**），main 仅转发 IPC / 权限 / 窗口焦点。  
- [ ] **claim 循环**：首版可用 **内存队列**（应用内调度），预留接口兼容将来 Multica API / 本地 SQLite 队列。  
- [ ] **孤儿 run**：应用启动时扫描 `running`，标记 `failed` 或 `retry`（对齐 `RecoverOrphanedTasks` 意图）。  
- [ ] **并发**：限制全局并发数；并行 run 时可选 **git worktree** 或 **目录级隔离**（避免 pi-subagents 式并行写冲突）。

**验收**：main 崩溃或窗口关闭不应单独吞掉 run 状态（run 状态以持久层为准）；daemon 重启策略与现有 `DaemonProcessMain.handleResumeConnection` 一致且无死锁。

---

## 阶段 4：多角色与编排

- [ ] **应用内编排**：调度多次 `Backend.Execute`（scout → planner → worker），步骤间传递 artifact 路径（类似 `.chain.md` 的 `{previous}`）。  
- [ ] **或**：Pi CLI + **`pi install npm:pi-subagents`**，由扩展承担链式/并行（Telegraph 仅托管 cwd 与事件转发）。  
- [ ] **可选**：**pi-intercom** 类督导回调 → 映射为 `AgentRunEvent` 的 `need_decision` 与用户 inbox。

**验收**：固定演示脚本（例如「检索 → 方案 → 实现 → 审查」）可一键跑通并可在 UI 区分各角色 run。

---

## 阶段 5：协调平面（可选）或与 Multica 集成

- [ ] **集成 Multica**：打包或引导安装 CLI + daemon；Telegraph OAuth / WebView；事件桥接。  
- [ ] **或自建**：Issue/Workspace 最小集 + HTTP API + WS hub（Multica `realtime/hub` 语义参考）。  

**验收**：多设备或多用户场景下的权限模型与订阅 scope 有明确结论（可 deferred）。

---

## 依赖与风险（滚动记录）

| 风险 | 缓解 |
|------|------|
| pi-ai 与 Pi CLI 会话不互通 | 产品文案与设置中标明；长期是否统一 CLI 由阶段 0 决策 |
| daemon 与现有端口/RPC 生命周期耦合 | 执行器模块与 `AcquirePortMain` 解耦，失败独立降级 |
| 并行写仓库 | worktree 或队列串行化 |

---

## 维护

完成某一阶段后：更新本文 checkbox、将陷阱记入 `issue/`（若适用）、并把 **A-004** `status` 向 `final` 收敛。
