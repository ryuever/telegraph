---
id: R-002
title: pi-subagents 实现解剖与 Telegraph Native Harness 借鉴清单
description: >
  基于 tintinweb/pi-subagents 源码，拆解其 subagents 能力的真实实现路径：
  Agent tool 入口、AgentManager 状态机、独立 AgentSession、后台结果回流、
  steering/resume/event bus/scheduler 等模块，并映射为 Telegraph Native Harness
  后续实现清单。
category: reference
created: 2026-05-21
updated: 2026-05-21
tags:
  - pi-subagents
  - subagents
  - native-harness
  - agent-runtime
  - implementation-study
status: draft
sources:
  - title: "tintinweb/pi-subagents"
    url: "https://github.com/tintinweb/pi-subagents"
  - title: "custom-agents.ts"
    url: "https://github.com/tintinweb/pi-subagents/blob/master/src/custom-agents.ts"
  - title: "agent-manager.ts"
    url: "https://github.com/tintinweb/pi-subagents/blob/master/src/agent-manager.ts"
  - title: "agent-runner.ts"
    url: "https://github.com/tintinweb/pi-subagents/blob/master/src/agent-runner.ts"
  - title: "index.ts"
    url: "https://github.com/tintinweb/pi-subagents/blob/master/src/index.ts"
references:
  - id: A-012
    rel: related-to
    file: ../architecture/20260520-telegraph-harness-extension-architecture.md
  - id: D-015
    rel: related-to
    file: ../discussion/20260520-agent-runtime-product-layer-alignment.md
  - id: I-004
    rel: related-to
    file: ../issue/20260519-pi-subagents-structured-plan-parsing.md
---

# pi-subagents 实现解剖与 Telegraph Native Harness 借鉴清单

> `pi-subagents` 的核心不是“解析用户自然语言里的 subagent 计划”，也不只是
> `.pi/agents` discovery。它是在 Pi extension host 内注册一组 LLM-callable tools，
> 让父 agent 通过 `Agent` tool 显式 spawn 独立 child session；然后由 AgentManager
> 管理前台/后台、队列、结果回流、steering、resume 与 UI/event 投影。

## 来源

- [tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents)
- [custom-agents.ts](https://github.com/tintinweb/pi-subagents/blob/master/src/custom-agents.ts)
- [agent-manager.ts](https://github.com/tintinweb/pi-subagents/blob/master/src/agent-manager.ts)
- [agent-runner.ts](https://github.com/tintinweb/pi-subagents/blob/master/src/agent-runner.ts)
- [index.ts](https://github.com/tintinweb/pi-subagents/blob/master/src/index.ts)

## 1. 一句话结构

```text
Pi extension activate
  -> register Agent / get_subagent_result / steer_subagent tools
  -> parent model calls Agent(...)
  -> AgentManager creates AgentRecord + child AgentSession
  -> agent-runner streams session events, tools, usage, text
  -> foreground returns inline result; background returns id and later followUp
```

这说明 subagents 的产品关键点不是“内置一个 chain/parallel 函数”，而是：

- 父模型能看到可用 agent catalog，并通过 tool call 选择 child agent。
- 每个 child 是一个可跟踪、可取消、可恢复的独立运行实体。
- 后台 child 完成后能把结果重新送回父会话，让父 agent 继续 reasoning。
- UI 与 event bus 消费同一个 AgentRecord / lifecycle，而不是另写一套状态。

## 2. 模块拆解

### 2.1 Extension activation：注册工具与状态投影

`src/index.ts` 是 extension 的总装配层。它做了几件事：

- 注册 `subagent-notification` 自定义 renderer，用于展示后台 agent 完成结果。
- 初始化并反复 reload agent registry。
- 创建 `AgentManager`、`GroupJoinManager`、`AgentWidget`、`SubagentScheduler`。
- 注册 `Agent`、`get_subagent_result`、`steer_subagent` 三个 LLM-callable tools。
- 通过 `pi.events` 发出 `subagents:created/started/completed/failed/steered/...`。
- 在 `session_start/session_shutdown/session_before_switch` 中绑定/清理 session-scoped 状态。

这是一种典型 extension-host 形态：tool、event、UI renderer、scheduler 都围绕同一个 manager。

### 2.2 Agent registry：默认 agent + 用户 agent overlay

`custom-agents.ts` 从 global 与 project 两层读取 markdown agent：

```text
global:  $PI_CODING_AGENT_DIR/agents/<name>.md
project: <cwd>/.pi/agents/<name>.md
```

低优先级先加载，高优先级后覆盖。文件名就是 agent type；frontmatter 只补充
description、tools、model、thinking、prompt_mode、inherit_context、enabled 等元数据。

Telegraph 已借鉴这点，但落在 native 路径：

```text
user:    ~/.telegraph/agents/<name>.md
project: <workspace>/.telegraph/agents/<name>.md
```

`.pi` 目录仍应只属于 Pi CLI 兼容或 importer，不进入 Telegraph native runtime discovery。

### 2.3 Agent tool：父模型的唯一 spawn 入口

`Agent` tool 的 schema 不只是 `agent + prompt`。它包含：

- `prompt`、`description`、`subagent_type`
- `model`、`thinking`、`max_turns`
- `run_in_background`
- `resume`
- `isolated`
- `inherit_context`
- `isolation: "worktree"`
- 可选 `schedule`

关键点：工具描述中动态列出可用 agent types，并明确告诉父模型什么时候并行、什么时候后台、
什么时候 resume/steer。也就是说，父模型感知 subagents 主要靠 tool definition 和 system
guidance，而不是 UI setting 的字符串。

### 2.4 AgentManager：child run 状态机

`agent-manager.ts` 是 subagents 的稳定核心。它维护 `AgentRecord`：

```typescript
interface AgentRecord {
  id: string
  type: string
  description: string
  status: "queued" | "running" | "completed" | "steered" | "aborted" | "stopped" | "error"
  result?: string
  error?: string
  toolUses: number
  startedAt: number
  completedAt?: number
  session?: AgentSession
  abortController?: AbortController
  promise?: Promise<string>
}
```

它还负责：

- 后台并发上限与 queue drain。
- 前台 `spawnAndWait` 直接等待。
- parent abort signal 转发到 child abort。
- `onStart/onComplete/onCompact` lifecycle callback。
- worktree cleanup 与结果附加。
- resume、abort、waitForAll、clearCompleted。

这对 Telegraph 的启示很直接：Native Harness 需要 `SubagentManager`，而不是只在一次
orchestrator function 里跑完 child calls。

### 2.5 agent-runner：独立 child AgentSession

`agent-runner.ts` 创建真正的 child execution：

- 调 `createAgentSession()` 创建独立 session。
- 使用 `SessionManager.inMemory()` 避免污染父会话。
- 用 `DefaultResourceLoader` 控制 extension/skills/context files 是否继承。
- 用 `systemPromptOverride` 注入 agent-specific prompt。
- 过滤 tools，禁止 child 再继承 `Agent/get_subagent_result/steer_subagent`，避免无限嵌套。
- `session.bindExtensions()` 后运行 `session.prompt(effectivePrompt)`。
- 订阅 `message_update/tool_execution_start/tool_execution_end/message_end/turn_end/compaction_end`。
- 收集最后一个 assistant text 作为 child result。
- max_turns 先 steer 要求收尾，超过 grace turns 再 abort。

这里最值得 Telegraph 学的是：child run 不是“函数调用模型一次”，而是完整 session，
具有自己的 tools、system prompt、abort、usage、compaction 与 conversation。

### 2.6 foreground/background 两种回流路径

`Agent` tool 有两种返回：

- foreground：父 tool call 等 child 完成，直接返回 child result。
- background：父 tool call 立即返回 agent id；child 完成后通过 followUp message
  触发父会话继续处理结果。

`get_subagent_result` 用于轮询或等待后台结果，并标记 `resultConsumed`，避免后台完成通知重复打扰。
`steer_subagent` 可以向 running child session 注入 steering message。

这对应 Telegraph 后续至少要有三种 Run 关系：

- parent run 的即时 child result。
- background child run 的 later notification / re-entry。
- parent 对 child 的 control command：cancel、steer、resume、get result。

### 2.7 group join：后台并行结果合并

`GroupJoinManager` 解决一个产品细节：父模型同一轮发起多个后台 agent 时，不希望每个 child
完成都单独 nudging。它用 batch debounce 把同一轮多个 background spawns 收成 group：

- 全部完成就发一个 group notification。
- 超时则发 partial notification。
- 剩余 stragglers 进入更短 re-batch window。

Telegraph 可以把这个抽象成 `SubagentJoinPolicy`，先支持 `async` 与 `group`，再扩展
smart debounce。

### 2.8 event bus 与 RPC

`cross-extension-rpc.ts` 通过 `pi.events` 暴露：

- `subagents:rpc:ping`
- `subagents:rpc:spawn`
- `subagents:rpc:stop`

reply 使用 `channel:reply:<requestId>`。这说明 subagents 不只是 parent model 的工具，
也可以成为其他 extension 的能力。Telegraph 对应应走 `CapabilityBroker` / extension host
事件，而不是全局 singleton 或 Pi event name。

### 2.9 scheduler、memory、worktree 是外围能力

这些能力重要，但不应放进 Telegraph Native Harness MVP 的核心：

- scheduler：定时 spawn background agent。
- memory：按 user/project/local scope 给 agent 注入 persistent memory。
- worktree：为写文件 child run 创建临时 git worktree。
- output-file：把 child transcript 流式写到文件。

它们应该作为 subagent extension 的后续 contribution / capability，而不是先污染
SubagentManager 的最小状态机。

## 3. Telegraph 应该借鉴什么

| pi-subagents 做法 | Telegraph 对应设计 |
|---|---|
| `Agent` tool 动态列出 agent types | `subagent` tool schema 从 `HarnessContributionSnapshot` 生成 enum 与 catalog |
| Agent type 来源于 registry | agent profile 来源于 extension contributions + user/workspace profile source |
| `AgentManager` 维护 child lifecycle | 新增 `SubagentManager`，让 child run 成为一等 Run |
| child 是独立 AgentSession | child run 通过 Embedded Execution Kernel 创建独立 model/tool loop |
| foreground/background 双模式 | foreground 直接 yield child result；background 产生 child run id 与 later result event |
| `get_subagent_result` / `steer_subagent` | 作为 Telegraph native control tools 或 UI actions |
| group join | `SubagentJoinPolicy`，避免并行后台结果刷屏 |
| lifecycle event bus | 通过 RuntimeEvent + extension event bus 投影，而不是 Pi-specific event name |
| tool filtering | 通过 CapabilityBroker/PermissionBroker 统一裁剪 child tools |

## 4. Telegraph 不应该照搬什么

- 不照搬 `.pi/agents`、`$PI_CODING_AGENT_DIR` 作为 native discovery。
- 不照搬 `DefaultResourceLoader` / `createAgentSession` 到核心类型；它们是 Pi runtime 细节。
- 不照搬 TUI renderer / widget API；Telegraph UI 应消费 RuntimeEvent 与 pagelet service state。
- 不使用 `globalThis[Symbol.for("pi-subagents:manager")]` 暴露 singleton；Telegraph 应走 pagelet-local harness service 或 CapabilityBroker。
- 不把 scheduler/worktree/memory 一次性塞进 MVP；先稳定 child lifecycle 与 result routing。

## 5. 当前 Telegraph 实现状态

当前 `extensions/telegraph-subagents` 已经做到：

- 父模型通过 `subagent` tool 选择 single/chain/parallel。
- tool schema 从 snapshot 生成 agent enum。
- child run 通过 `orchestrate()` 执行并产生 `child_run_*` RuntimeEvent。
- 默认 profiles 已作为 first-party extension data 存在。
- `SubagentManager` 已经成为 child lifecycle 入口，负责 `SubagentRecord`、并发槽位、abort 与 result consumption 标记。
- `StreamingSubagentRunner` 已经封装 Embedded Execution Kernel child run 创建、tool filtering、prompt assembly 与 result collection。
- single/chain/parallel 已经统一通过 `SubagentManager.spawnAndWait()` 执行 child，不再由各 workflow helper 手搓 child stream。

但它仍不是 pi-subagents 那种完整
subagent platform：

- 缺少 background child run id、later notification、result consumption。
- 缺少 `get_subagent_result`、`steer_subagent`、resume。
- 缺少 join policy 与 background batch/group。
- 缺少 child session transcript 与 usage 的完整状态对象。

## 6. 建议演进顺序

1. ✅ 提取 `SubagentManager`：管理 `SubagentRecord`、并发槽位、abort、result consumption 与 lifecycle callback。
2. ✅ 提取 `SubagentRunner`：封装 Embedded Execution Kernel child run 创建、tool filtering、prompt assembly、result collection。
3. ✅ 重写 orchestrator child execution：single/chain/parallel 都通过 manager spawn child records。
4. 增加 foreground/background 语义：foreground 等待 child；background 返回 id，并通过 RuntimeEvent / pagelet service 投递 completion。
5. 增加 result/steer control：先作为 parent-visible tools，再投影到 UI actions。
6. 加入 join policy：先实现 explicit group，再实现 smart debounce。
7. 最后再考虑 scheduler、memory、worktree、cross-extension RPC。

这条路线保留了 pi-subagents 的产品手感，但落在 Telegraph Native Harness 的边界里：
extension contribution 负责“有什么 agent/capability”，manager/runner 负责“child run 怎么活”，
RuntimeEvent/trace/UI 负责“用户和父 agent 如何看见它”。
