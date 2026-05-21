---
id: D-015
title: Agent Runtime 产品分层与 Telegraph Native Harness 对齐
description: >
  归档 2026-05-20 关于 External Agent Runtime、Telegraph Native Harness
  与 Embedded Execution Kernel 三者边界的讨论结论，明确 pi-subagents 不再作为
  runtime adapter，而应沉淀为 Telegraph native subagent harness。
category: discussion
created: 2026-05-20
updated: 2026-05-21
tags:
  - agent-runtime
  - native-harness
  - external-agent-runtime
  - embedded-kernel
  - subagents
  - pi
status: draft
references:
  - id: A-005
    rel: extends
    file: ../architecture/20260505-telegraph-agent-runtime-extension-host-theory.md
  - id: A-004
    rel: related-to
    file: ../architecture/20260504-multica-implementation-map-and-telegraph-adaptation.md
  - id: D-003
    rel: extends
    file: ./20260506-spawn-cli-vs-embed-orchestra-agent-invocation.md
  - id: R-002
    rel: related-to
    file: ../reference/20260521-pi-subagents-implementation-study.md
  - id: D-001
    rel: extends
    file: ./20260504-multica-vs-pi-multi-agent-for-telegraph.md
  - id: D-014
    rel: extends
    file: ./20260519-chat-agent-team-multica-strategy.md
  - id: P-001
    rel: extends
    file: ../roadmap/20260504-multi-agent-telegraph-roadmap.md
  - id: P-002
    rel: extends
    file: ../roadmap/20260505-agent-runtime-extension-host-phase-gates.md
  - id: P-004
    rel: extends
    file: ../roadmap/20260518-agent-protocol-pagelet-harness-plan.md
  - id: I-004
    rel: related-to
    file: ../issue/20260519-pi-subagents-structured-plan-parsing.md
  - id: A-012
    rel: extended-by
    file: ../architecture/20260520-telegraph-harness-extension-architecture.md
  - id: D-016
    rel: extended-by
    file: ./20260521-design-page-agent-generation-product-architecture.md
---

# Agent Runtime 产品分层与 Telegraph Native Harness 对齐

> 本文记录一次关键架构收敛：Telegraph 的产品层应分为 **External Agent Runtime** 与
> **Telegraph Native Harness** 两条路径；Embedded Execution Kernel 不是第三个产品层，
> 而是 Native Harness 的底层执行内核。

## 1. 背景问题

在验证 `pi-subagents` 接入当前 session 时，一个核心问题暴露出来：开源 agent 生态里的
extension 往往带有自己的运行环境假设，例如读取 `~/.pi/agent/agents`、项目 `.pi/agents`
或其他私有目录。Telegraph 如果把这些 extension 当作可嵌入 adapter 去“兼容”，就会被
上游目录约定、loader 行为、权限模型和版本细节拖住。

因此，旧的 Pi-branded subagent runtime 命名和定位会误导架构：

- 如果目标是兼容 Pi 生态，应该运行 **Pi CLI**，让 Pi 自己加载 `pi-subagents`。
- 如果目标是 Telegraph 自己的多 agent 能力，应该建设 **Telegraph native subagent harness**。
- `pi-subagents` 可以作为设计参考、导入格式或外部兼容来源，但不应成为 Telegraph 核心 runtime adapter。

## 2. 最终分层

### 2.1 产品层只有两条路径

```text
Product surface
├─ External Agent Runtime
│  └─ 运行别人已经成型的 agent 产品：Codex CLI / Claude Code / Pi CLI / ...
│
└─ Telegraph Native Harness
   ├─ Telegraph 自己的 agent profile / subagent / orchestration / context policy
   └─ Embedded Execution Kernel
      ├─ model loop
      ├─ tool loop
      ├─ permission
      ├─ trace
      └─ provider SDK: pi-ai / OpenAI SDK / Vercel AI SDK / ...
```

### 2.2 External Agent Runtime

适用对象：已经有完整 CLI 或产品运行时的 agent，例如 Pi CLI、Claude Code、Codex CLI、
Gemini CLI、OpenCode 等。

Telegraph 的职责是：

- 解析本地可用 CLI、版本与能力。
- 设定 cwd/env/stdin/argv/session path。
- 管理 spawn、取消、超时、退出码、stderr 与日志。
- 将 stdout / JSON-RPC / ACP / plain text 等流归一化为 `RuntimeEvent` / `AgentEvent`。
- 在 Trace 中标明这是 external runtime，并保留 raw 输出。

Telegraph 不负责：

- 复刻该 CLI 的 extension loader。
- 改写该 CLI 的私有目录约定。
- 把 `~/.pi`、`.claude`、`.codex` 等目录升级为 Telegraph 通用标准。

### 2.3 Telegraph Native Harness

适用对象：Telegraph 自己定义的 agent / subagent / team / tool workflow。

它拥有以下一等概念：

- `AgentProfile`：Telegraph 自己的 agent 定义，来源可以是内置、用户级、项目级或导入。
- `SubagentHarness`：负责选择 child agent、chain/parallel 调度、context policy、结果汇总。
- `ToolRegistry` / `PermissionBroker`：Telegraph 自己的工具与权限边界。
- `RunRepository` / `RunConsole`：按 run / child run / step / tool call 投影和回放。
- `CapabilityProfile`：按 pagelet、任务与用户授权启用工具能力，而不是全局打开所有 extension。

### 2.4 Embedded Execution Kernel

Embedded Execution Kernel 是 Native Harness 的底层，不是独立产品入口。它负责把一个
Telegraph-owned child run 真正执行起来：

- 构建 provider message / context。
- 调用 `pi-ai`、OpenAI SDK、Vercel AI SDK 或其他模型 SDK。
- 执行 Telegraph ToolRegistry 中的 tool call。
- 产出可观测、可取消、可校验的 `RuntimeEvent`。

因此，用户不应该在产品心智里选择“Embedded Runtime Host”。用户选择的是 Telegraph
native harness；embedded kernel 只是这个 harness 的 engine。

## 3. 与 pi-mono 的类比

这个分层类似 `pi-mono` 中的三层关系：

```text
pi-coding-agent
  -> pi-agent-core
    -> pi-ai

Telegraph
Telegraph Native Harness
  -> Embedded Execution Kernel
    -> provider/model SDKs
```

关键差异是 Telegraph 还会有 External Agent Runtime 路线。运行 Pi CLI、Codex CLI 或
Claude Code 时，Telegraph 不拆开它们内部的 `coding-agent -> agent-core -> ai` 结构，
而是把整个 CLI 当成外部 agent product 来托管和观察。

## 4. pi-subagents 的新定位

`pi-subagents` 不再作为 Telegraph 的 embedded adapter 目标。新的定位是三选一：

| 场景 | 正确落点 |
|------|----------|
| 兼容 Pi 官方 extension 行为 | External Agent Runtime：spawn Pi CLI |
| 借鉴 chain / parallel / role delegation 思路 | Telegraph Native Subagent Harness |
| 读取既有 `.pi/agents` 或 pi-subagents markdown | Importer / migration tool，导入为 Telegraph `AgentProfile` |

当前代码已收敛为 Telegraph native 命名：

```text
extensions/telegraph-subagents/
  telegraph.extension.json
  agents/
    scout.md
    planner.md
    worker.md
    reviewer.md
  src/
    TelegraphSubagentHarness.ts
    agentDiscovery.ts
    agentParser.ts
    orchestrator.ts
    tools.ts
    types.ts

packages/agent/src/extensions/harness/
  HarnessExtensionManifest.ts
  ContributionRegistry.ts
  HarnessContributionSnapshot.ts
  ActivationHost.ts
  CapabilityBroker.ts
```

目录约定也应分开：

- Telegraph native agent：`~/.telegraph/agents`、项目 `.telegraph/agents`。
- Pi 兼容：由 Pi CLI 继续读取 `~/.pi/...` 与 `.pi/...`。
- import/sync 可以存在，但它是迁移工具，不是 runtime 默认 discovery。

## 5. 决策规则

一句话判断：

> 要运行的是 Telegraph 自己定义的 agent/subagent，就走 Native Harness；
> 要运行的是别人已经定义好的 agent 产品，就走 External Agent Runtime。

| 问题 | 选择 |
|------|------|
| 是否需要兼容上游 CLI 的 agents/extensions/config？ | External Agent Runtime |
| 是否需要 Telegraph 一等 Trace / Permission / ToolRegistry？ | Telegraph Native Harness |
| 是否要大量轻量 child run、chain/parallel、context policy？ | Native Harness + Embedded Kernel |
| 是否只是想快速支持 Claude Code / Codex / Pi 现有生态？ | External Agent Runtime |
| 是否要把外部 agent 文件格式变成 Telegraph agent？ | Importer，不是 runtime adapter |

## 6. 对已有文档的修正方向

本结论会覆盖旧文中的几个旧表述：

- `PiEmbeddedRuntime` 不再是独立产品主线，应改称 **Embedded Execution Kernel**，
  并限定为 Telegraph Native Harness 的底层。
- `pi-subagents Embedded Adapter` 不再成立，应改为 **Telegraph Native Subagent Harness**。
- `PiCliRuntime` 不只是 embedded 不支持时的 fallback；当用户选择 Pi CLI 生态时，它是
  External Agent Runtime 的一等路径。
- `~/.telegraph/agents` 是 Telegraph native profile registry，不用于冒充 Pi 的 `.pi` 目录。
- UI / registry / trace 仍只看 `RuntimeEvent`、`ToolDefinition`、`AgentProfile`
  与 `CapabilityProfile`，不把 Pi-specific 概念泄漏到核心协议。

## 7. 后续落地建议

1. 继续将 `extensions/telegraph-subagents` 的 profile snapshot 能力提升为完整 `AgentProfileRegistry`，默认读取 Telegraph 自己的 agent 目录。
2. 如果未来需要读取 `.pi/agents`，新增 importer / migration tool；不要放回 runtime discovery。
3. 定义 `SubagentRunner` 接口，使 child run 可以选择 embedded kernel 或 external CLI runner。
4. 恢复 / 保留 External Agent Runtime 路线，用于 Pi CLI、Codex CLI、Claude Code 等成熟 CLI。
5. 在 settings 中把产品入口表达为“External Agents”和“Telegraph Native Agents”，而不是
   “SDK backend / CLI backend / pi-subagents backend”。
