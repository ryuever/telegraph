---
id: D-003
title: Spawn CLI 与 Embed Orchestra 两种 Agent 调用模式对比
description: >
  以 open-design（spawn CLI 模式）和 Telegraph（embed orchestra 模式）为实例，
  对比两种宿主应用集成 AI agent 的架构范式，分析各自的优缺点、适用场景与演进方向。
category: discussion
created: 2026-05-06
updated: 2026-05-06
tags:
  - agent-invocation
  - spawn-cli
  - embed-runtime
  - open-design
  - telegraph
  - architecture-comparison
status: draft
references:
  - id: A-005
    rel: extends
    file: ../architecture/20260505-telegraph-agent-runtime-extension-host-theory.md
---

# Spawn CLI 与 Embed Orchestra 两种 Agent 调用模式对比

> 本文以 **open-design**（spawn CLI 模式）和 **Telegraph**（embed orchestra 模式）为两个真实案例，对比宿主应用集成 AI agent 时的两种主流架构范式。

## 1. 两种模式概述

### 1.1 Spawn CLI 模式（open-design）

open-design 的核心设计是：**宿主应用不包含任何 agent 逻辑，而是将各种已有 CLI agent 视为可插拔的外部黑盒**。

```text
Browser (React SPA)
    ↕ HTTP / SSE
Daemon (Express server)
    ↕ spawn child_process (stdin/stdout/stderr pipes)
Agent CLI (claude, codex, gemini, pi, opencode, copilot, devin …)
```

关键实现：

- **`AGENT_DEFS` 声明式注册**（`apps/daemon/src/agents.ts:119-712`）：每个 agent 定义 `bin`（CLI 二进制名）、`buildArgs()`（命令行参数构造）、`streamFormat`（输出协议类型）、`promptViaStdin`（是否通过 stdin 送入 prompt）。
- **`spawn()` 调用**（`apps/daemon/src/server.ts:3679-3688`）：`spawn(invocation.command, invocation.args, { env, stdio, cwd, shell: false })`。
- **协议解析层**：根据 `streamFormat` 分派到不同的 stdout 解析器——`claude-stream.ts`、`copilot-stream.ts`、`json-event-stream.ts`、`acp.ts`、`pi-rpc.ts`，各自将原始输出归一化为 `text_delta`、`tool_use`、`tool_result` 等通用事件。
- **SSE 转发**：解析后的事件通过 HTTP SSE 推送给浏览器。

### 1.2 Embed Orchestra 模式（Telegraph）

Telegraph 的长期目标是：**宿主应用自身成为 agent runtime host，在进程内编排模型调用、工具执行、extension 加载和生命周期管理**。

```text
Renderer (React)
    ↕ IPC (Electron contextBridge)
Main Process
    ↕ RPC (port-based)
Daemon Process
    → AgentRuntime.run(input): AsyncIterable<RuntimeEvent>
      → Model Provider (pi-ai / OpenAI / Anthropic …)
      → Tool Registry (extension tools / MCP / built-in)
      → Extension Host (activate / hooks / permissions)
```

关键设计（参见 A-005）：

- **`AgentRuntime` 接口**：`run(input: RunInput): AsyncIterable<RuntimeEvent>`，统一不同底层框架的调用。
- **`RuntimeEvent` 协议**：`run_started`、`model_request`、`model_event`、`assistant_delta`、`tool_call`、`tool_result`、`run_completed` 等，由 runtime adapter 在进程内产生。
- **Extension Host**：Telegraph 自己管理 extension 的安装、启用、权限和 tool 注册，不依赖外部 CLI 的 extension loader。
- **Tool Loop 内化**：模型返回 tool call 后，由宿主进程内的 runtime 执行工具、追加结果、继续调用模型，不需要外部进程参与。

## 2. 架构对比

### 2.1 总体对照

| 维度 | Spawn CLI（open-design） | Embed Orchestra（Telegraph） |
|------|--------------------------|------------------------------|
| Agent 代码位置 | 外部，独立 CLI 二进制 | 内部，进程内 runtime adapter |
| 通信通道 | stdin/stdout/stderr pipes | 函数调用 / AsyncIterable |
| 协议归一化 | 解析多种 stdout 格式（JSON lines、ACP JSON-RPC、plain text） | Runtime adapter 在产生事件时直接构造 `RuntimeEvent` |
| 生命周期控制 | SIGTERM/SIGKILL + exit code | AbortSignal + 异步迭代取消 |
| Tool 执行 | Agent CLI 内部执行，宿主不参与（或通过 tool token HTTP 回调） | 宿主的 Tool Registry 执行，结果直接回注 runtime |
| Extension 管理 | 不管理——agent 自带能力 | 宿主统一管理：install / enable / permissions |
| 多 Agent 支持 | 天然支持——换一个 `bin` 即可 | 需为每种框架写 RuntimeAdapter |
| Trace 深度 | 受限于 CLI 输出的信息量 | 可拿到完整 model request/response raw 数据 |
| 打包复杂度 | 需要用户系统上存在对应 CLI | 所有依赖随应用分发 |

### 2.2 事件流对比

**Spawn CLI 事件流（open-design）**

```text
Daemon: spawn("claude", args)
Agent stdout: {"type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}} \n
Parser: claude-stream.ts → { type: 'text_delta', text: 'Hello' }
SSE: event: agent, data: { type: 'text_delta', text: 'Hello' }
Browser: render
```

每一步都经过序列化/反序列化边界：agent 内部状态 → JSON 序列化 → stdout pipe → 行缓冲 → JSON 解析 → SSE 序列化 → HTTP → 浏览器解析。

**Embed Orchestra 事件流（Telegraph）**

```text
AgentStreamService: runtime.run(input)
PiAiRuntime: stream(model, context)
  yield { type: 'model_request', payload: context, raw: piAiContext }
  yield { type: 'assistant_delta', text: 'Hello', raw: piAiStreamEvent }
Daemon → Main → Renderer: IPC forward RuntimeEvent
UI: render
```

事件在进程内以类型安全的 TypeScript 对象产生，只在跨进程边界做一次序列化。

## 3. Spawn CLI 模式的优缺点

### 3.1 优点

1. **零集成成本的多 Agent 覆盖**：open-design 支持 15+ 种 agent（Claude Code、Codex、Gemini CLI、OpenCode、Copilot、Pi、Devin、Cursor Agent 等），每个 agent 只需要一个 `AGENT_DEFS` entry。新增 agent 不需要理解其内部实现，只需要知道 CLI 调用方式和输出格式。

2. **能力完整性由上游保证**：每个 agent CLI 自带完整的 tool calling、extension loading、context management、model selection 能力。宿主应用不需要重新实现这些。

3. **隔离性强**：agent 进程崩溃不会拖垮宿主；agent 的内存、CPU 消耗天然隔离；不同 agent 之间也不存在依赖冲突。

4. **跟随上游更新零成本**：用户升级 `claude` CLI 版本，open-design 自动获得新功能（新工具、新模型支持），无需宿主应用发版。

5. **最小化维护负担**：宿主只负责 spawn、parse、forward——核心复杂度在上游 CLI。

### 3.2 缺点

1. **生命周期控制粒度粗**：取消只有 SIGTERM/SIGKILL 两种手段，没有"暂停当前 tool call 等待用户确认"的能力。open-design 对 ACP 协议的 `session/request_permission` 采用自动批准（`acp.ts:37-63`），因为真正的 human-in-the-loop 控制在 spawn 模型下很难实现。

2. **Trace 深度受限**：宿主只能看到 CLI 选择输出的信息。发给模型的完整 prompt、system message、context window 管理策略、内部重试逻辑——这些对宿主是黑盒。

3. **Tool 注册不可控**：宿主无法决定 agent 能使用哪些工具，不能注入自定义工具，也无法审计工具执行。open-design 通过 `tool-tokens.ts` 提供了有限的宿主 tool 暴露机制（artifact CRUD、connector 执行），但这是旁路方案，不是统一的 tool registry。

4. **多协议解析维护成本**：5 种 `streamFormat`、每种都有独立 parser，且各 CLI 的输出格式可能随版本变化而 break。这是一个持续的维护成本。

5. **环境依赖**：要求用户系统上安装对应 CLI（`resolveAgentBin()` 搜索 PATH、homebrew、nvm 等路径，`agents.ts:1161`）。打包和分发无法自包含。

6. **上下文割裂**：agent 进程的 workspace 状态、文件系统操作、git 操作等对宿主来说是旁路发生的，宿主无法实时感知。

## 4. Embed Orchestra 模式的优缺点

### 4.1 优点

1. **完整的运行时可观测性**：Trace 可以展示真实发给模型的 `Context`、模型原始 stream event、tool call input/output——这是 A-005 §4.3 强调的一等能力。

2. **统一的 Tool Registry 和权限控制**：宿主决定哪些工具可用，extension 需要声明 permissions，高风险操作可以 human-in-the-loop。

3. **精细的生命周期控制**：通过 `AbortSignal` 可以在 tool call 粒度取消；暂停/恢复/checkpoint 可以在协议层支持。

4. **事件协议类型安全**：`RuntimeEvent` 是 TypeScript 判别联合，编译期可检查，不存在"JSON 格式意外变化导致运行时 crash"的风险。

5. **自包含分发**：所有依赖随 Electron 应用打包，用户不需要预装任何 CLI。

6. **Extension 生态可控**：Telegraph 自己管理 extension manifest、install、enable/disable、版本、capability declaration，不依赖上游 CLI 的 extension 加载机制。

### 4.2 缺点

1. **集成成本高**：每接入一个新的 agent framework（Pi、LangGraph、AI SDK、Mastra）都需要写一个完整的 RuntimeAdapter，理解其内部 API 并映射到 `RuntimeEvent`。对比 open-design 的"加一条 `AGENT_DEFS`"，成本差一个数量级。

2. **上游依赖耦合**：如果底层框架（如 `pi-ai`）的 API 不稳定或不公开 embeddable API，adapter 层需要频繁适配。A-005 §12.1 明确指出了 Pi extension 格式稳定性风险。

3. **进程内风险不隔离**：有问题的 extension 或 tool 执行可能影响宿主进程稳定性。需要额外投入 sandbox / error isolation / timeout 机制。

4. **需要重新实现 runtime host 能力**：Tool loop、context window management、model fallback、retry policy——这些 CLI agent 已经实现好的能力，在 embed 模式下需要宿主自己实现或从 SDK 层获取。

5. **维护范围更大**：除了 UI，还要维护 runtime、extension host、tool registry、permission service、trace model——产品表面积大幅增加。

## 5. 关键维度深度对比

### 5.1 错误处理与容错

| 场景 | Spawn CLI | Embed Orchestra |
|------|-----------|-----------------|
| Agent 崩溃 | 进程退出，宿主收到 exit code，标记 run failed | 异常在进程内传播，需 try/catch + error isolation |
| 模型限流 / 超时 | 由 agent CLI 内部处理重试，宿主不感知 | 宿主 runtime 需自己实现 retry / fallback |
| Tool 执行失败 | Agent CLI 内部处理，宿主仅看到最终输出 | RuntimeEvent 中可精确暴露 `tool_error`，UI 可展示 |
| IPC 背压 | stdout pipe 有 OS buffer，但可能丢行或阻塞（I-002 类问题） | 进程内 AsyncIterable，背压通过 async/await 自然传导 |

### 5.2 多 Agent 支持

open-design 的优势在此维度极为明显：它的核心价值主张就是"一个界面跑所有 agent"。每个 agent 是独立进程，互不干扰，甚至可以并行跑多个 agent 对同一任务给出不同方案。

Telegraph 如果要支持多框架，需要为每种框架维护 adapter。但 Telegraph 获得的回报是：所有框架的行为在 Trace 中以统一视角呈现，可以做跨框架的 A/B 评测和工具共享。

### 5.3 安全与权限

| 维度 | Spawn CLI | Embed Orchestra |
|------|-----------|-----------------|
| 工具权限 | 不可控——agent 决定用什么工具 | Extension manifest 声明 permissions，宿主审核 |
| 文件系统访问 | Agent 进程可访问 cwd 下所有内容 | 可限定 workspace scope |
| 网络访问 | 不可控 | PermissionRequest 可声明 hosts |
| 宿主 API 访问 | tool-tokens 限定可访问的 endpoint | ExtensionContext 限定可调用的能力 |

### 5.4 适用场景

**Spawn CLI 更适合**：
- 宿主定位为"agent 调度器 / agent 比较器"，不需要深度介入 agent 行为
- 需要快速覆盖大量已有 CLI agent
- 对 trace 深度要求不高，接受 agent 输出的粒度
- 用户群体是开发者，可以自行安装 CLI 工具

**Embed Orchestra 更适合**：
- 宿主定位为"agent 工作台 / agent IDE"，需要深度控制 agent 行为
- 需要统一的 tool registry、extension 生态和权限管理
- 对 trace 和可观测性要求高
- 需要 human-in-the-loop 的细粒度交互（tool 审批、checkpoint、resume）
- 需要自包含分发，不依赖用户环境

## 6. 混合模式与演进路径

两种模式并非互斥。Telegraph 的 A-005 已经明确了混合策略：

- **短期**：保留 `PiCliRuntime` 作为 compatibility runtime（即 spawn CLI 模式）。
- **中长期**：建设 `PiEmbeddedRuntime`（embed orchestra 模式）。
- **Fallback**：当 embedded runtime 不支持某些 extension 或参数时，自动回退到 CLI runtime。

open-design 的 ACP 协议（`acp.ts`）也展示了介于两者之间的中间态：ACP agent 虽然是独立进程，但通过 JSON-RPC 双向通信，daemon 可以向 agent 发送结构化指令（`session/new`、`session/prompt`、`session/set_model`），比纯粹的 stdin/stdout 有更强的交互能力。

### 6.1 演进建议

```text
阶段 1: Spawn CLI（完整能力，快速覆盖）
         ↓
阶段 2: 结构化双向协议（ACP / Pi-RPC）
         ↓
阶段 3: Embed SDK（进程内调用底层 SDK）
         ↓
阶段 4: Native Runtime Host（完整 runtime + extension host）
```

每个阶段都增加了宿主的控制力和可观测性，但也增加了集成与维护成本。选择停在哪个阶段取决于产品定位。

## 7. 结论

- **Spawn CLI 是"广度优先"策略**：最大化 agent 覆盖范围，最小化集成成本，代价是可观测性和控制力。
- **Embed Orchestra 是"深度优先"策略**：最大化可观测性、可控性和用户体验，代价是集成成本和维护范围。
- 两种模式对应不同的产品定位：open-design 是"agent 调度器"，Telegraph 是"agent 工作台"。
- 在实践中，保留 spawn CLI 作为 fallback / compatibility 路径，同时渐进建设 embedded runtime，是 Telegraph A-005 提出的务实演进策略。
