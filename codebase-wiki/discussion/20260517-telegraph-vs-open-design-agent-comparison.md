# Telegraph vs Open Design Agent 接入方式对比分析

**ID**: D-012  
**Date**: 2026-05-17  
**Status**: ✅ 分析完成  
**Related**: D-011（Chat Agent Runtime 接入实施）、[open-design](https://github.com/nexu-io/open-design)

---

## 0. 架构范式对比

### 0.1 Open Design：CLI-Adapter 模式（spawn 子进程）

Open Design 的核心思路是：**不做任何 SDK 集成，所有 agent 都是外部 CLI 进程**。

```
┌───────────────────────────────────────────────────────────────┐
│ daemon (Node.js)                                               │
│                                                                │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │ RuntimeAgentDef (声明式定义)                                │ │
│  │   id / name / bin / fallbackBins / versionArgs            │ │
│  │   buildArgs(prompt, images, dirs, options) → string[]     │ │
│  │   streamFormat: 'claude-stream-json' | 'pi-rpc' | ...     │ │
│  │   promptViaStdin / promptInputFormat                       │ │
│  │   listModels / fetchModels                                 │ │
│  └──────────────────┬───────────────────────────────────────┘ │
│                     │                                          │
│         resolveAgentLaunch(def, env)                           │
│         → resolve binary path on local system                 │
│                     │                                          │
│         def.buildArgs(composed, ...)                           │
│         → construct CLI arguments                              │
│                     │                                          │
│         spawn(launchPath, args, { stdio: [pipe,pipe,pipe] })  │
│                     │                                          │
│         ┌──────────┴──────────┐                               │
│         │  Stream Parser       │ (per streamFormat)            │
│         │  claude-stream.ts    │ claude-stream-json            │
│         │  json-event-stream.ts│ codex/gemini/opencode/...     │
│         │  copilot-stream.ts   │ copilot-stream-json           │
│         │  qoder-stream.ts     │ qoder-stream-json            │
│         │  attachPiRpcSession  │ pi-rpc                       │
│         │  attachAcpSession    │ acp-json-rpc                  │
│         │  (plain fallback)    │ deepseek/cursor/...           │
│         └──────────┬──────────┘                               │
│                    ↓                                           │
│         DaemonAgentPayload (归一化事件)                         │
│           text_delta / thinking_delta / tool_use /             │
│           tool_result / usage / status / raw                   │
│                    ↓                                           │
│         SSE → Web UI                                           │
└───────────────────────────────────────────────────────────────┘
```

关键设计：
1. **声明式 agent 定义** (`RuntimeAgentDef`)：每个 CLI agent 只需一个 `defs/<agent>.ts` 文件，声明 bin 名称、参数构建逻辑、流格式、模型列表
2. **进程 spawn**：`child_process.spawn(bin, buildArgs(...), { stdio: [stdin-pipe, pipe, pipe] })`
3. **Per-format 流解析器**：根据 `streamFormat` 选择不同的 stdout 解析器，将不同 CLI 的 JSON/text 输出归一化为 `DaemonAgentPayload`
4. **Prompt 传递**：通过 stdin pipe（`promptViaStdin`）避免 argv 长度限制
5. **Agent Detection**：启动时扫描所有 `AGENT_DEFS`，`probe()` 检测本地是否安装了该 CLI，返回可用/不可用

### 0.2 Telegraph：SDK-Embedded 模式（进程内 RuntimeExecutor）

Telegraph 的当前方案是：**将 agent runtime SDK 打包进 pagelet utility process，进程内调用**。

```
┌───────────────────────────────────────────────────────────────┐
│ Chat Pagelet (UtilityProcess)                                  │
│                                                                │
│  createRuntime(settings) → RuntimeExecutor                     │
│    ├── PiAiRuntime     → @mariozechner/pi-ai stream()         │
│    ├── PiEmbeddedRuntime → pi-ai + embedded tool loop          │
│    ├── LangGraphRuntime → @langchain/langgraph                 │
│    └── VercelAiRuntime → ai-sdk                                │
│                                                                │
│  executor.run({ runId, message, settings, signal })            │
│    → AsyncIterable<RuntimeEvent>                               │
│                                                                │
│  RuntimeEvent (框架无关事件)                                     │
│    run_started / model_request / model_event /                 │
│    assistant_delta / tool_call / tool_result /                 │
│    run_completed / run_failed                                  │
│         ↓                                                      │
│  ChatStreamEvent → RPC callback → Renderer                     │
└───────────────────────────────────────────────────────────────┘
```

关键设计：
1. **进程内 SDK 调用**：直接 `import { stream } from '@mariozechner/pi-ai'`
2. **RuntimeExecutor 接口**：统一 `run(input): AsyncIterable<RuntimeEvent>` 抽象
3. **RuntimeEvent 协议**：框架无关的事件协议（`raw` + `origin` 封装框架差异）
4. **createRuntime 工厂**：根据 `backend` 配置选择不同的 executor

---

## 1. Open Design 架构概览

Open Design 的 agent 接入采用 **CLI-Adapter 模式**：不集成任何 SDK，所有 agent 都是外部 CLI 进程。

### 1.1 核心代码位置

```
apps/daemon/src/runtimes/
├── types.ts              # RuntimeAgentDef 类型定义
├── registry.ts           # AGENT_DEFS[] 注册表（16 个 agent）
├── detection.ts          # detectAgents() — 扫描本地 PATH 探测可用 agent
├── launch.ts             # resolveAgentLaunch() — 解析二进制路径
├── invocation.ts         # execAgentFile() — child_process.execFile 封装
├── executables.ts        # resolveAgentExecutable() — PATH/fallbackBins 查找
├── capabilities.ts       # agentCapabilities — per-agent 功能探测缓存
├── models.ts             # model 缓存、校验、sanitizer
├── env.ts                # spawnEnvForAgent() — 构建子进程环境变量
├── auth.ts               # probeAgentAuthStatus() — 认证状态探测
├── metadata.ts           # installMetaForAgent() — 安装指引 URL
├── prompt-budget.ts      # checkPromptArgvBudget() — argv 长度限制检查
├── paths.ts              # 路径解析辅助
├── mcp.ts                # MCP 发现
├── resolution.ts         # resolveAgentBin() — chat handler 用
├── defs/                 # 每个 CLI agent 一个声明文件
│   ├── claude.ts         # Claude Code (stream-json + stdin pipe)
│   ├── codex.ts          # Codex CLI (json-event-stream + stdin pipe)
│   ├── gemini.ts         # Gemini CLI (json-event-stream + stdin pipe)
│   ├── pi.ts             # Pi CLI (pi-rpc JSON-RPC over stdio)
│   ├── opencode.ts       # OpenCode (json-event-stream)
│   ├── hermes.ts         # Hermes (acp-json-rpc)
│   ├── kimi.ts           # Kimi (acp-json-rpc)
│   ├── cursor-agent.ts   # Cursor Agent (json-event-stream)
│   ├── qwen.ts           # Qwen (plain text stdout)
│   ├── qoder.ts          # Qoder (qoder-stream-json)
│   ├── copilot.ts        # GitHub Copilot (copilot-stream-json)
│   ├── kiro.ts           # Kiro (acp-json-rpc)
│   ├── kilo.ts           # Kilo (acp-json-rpc)
│   ├── vibe.ts           # Vibe (acp-json-rpc)
│   ├── deepseek.ts       # DeepSeek TUI (plain text stdout, prompt via argv)
│   ├── devin.ts          # Devin (cloud, acp-json-rpc)
│   └── shared.ts         # 共享 helper (parsePiModels, execAgentFile, etc.)
```

流解析器位于 daemon 根目录：

```
apps/daemon/src/
├── claude-stream.ts      # claude-stream-json parser (~300 行)
├── json-event-stream.ts  # 通用 JSONL parser (codex/gemini/opencode/cursor 等, ~400 行)
├── copilot-stream.ts     # copilot-stream-json parser
├── qoder-stream.ts       # qoder-stream-json parser
├── runs.ts               # Run 生命周期管理 (create/start/emit/stream/finish)
├── chat-routes.ts        # Express 路由 (POST /api/runs → startChatRun)
└── server.ts             # startChatRun() 主逻辑 (~1500 行)
```

归一化事件契约位于 contracts 包：

```
packages/contracts/src/sse/chat.ts  # DaemonAgentPayload 类型 (7 种事件)
```

### 1.2 核心类型：RuntimeAgentDef

```typescript
// apps/daemon/src/runtimes/types.ts

type RuntimeAgentDef = {
  id: string;                  // 'claude' | 'codex' | 'gemini' | 'pi' | ...
  name: string;                // 'Claude Code' | 'Codex CLI' | ...
  bin: string;                 // CLI 二进制名 (PATH 查找)
  fallbackBins?: string[];     // 备选二进制 (如 openclaude)
  versionArgs: string[];       // ['--version']
  buildArgs: (                 // 构建 CLI 参数
    prompt: string,
    imagePaths: string[],
    extraAllowedDirs?: string[],
    options?: RuntimeBuildOptions,
    runtimeContext?: RuntimeContext,
  ) => string[];
  streamFormat: string;        // 输出格式标识
  promptViaStdin?: boolean;    // 是否通过 stdin 投递 prompt
  promptInputFormat?: 'text' | 'stream-json';
  fallbackModels: RuntimeModelOption[];
  listModels?: { args: string[]; parse: (stdout: string) => RuntimeModelOption[] | null };
  fetchModels?: (resolvedBin: string, env: RuntimeEnv) => Promise<RuntimeModelOption[] | null>;
  capabilityFlags?: Record<string, string>;
  eventParser?: string;
  env?: Record<string, string>;
  installUrl?: string;
  docsUrl?: string;
  supportsImagePaths?: boolean;
  maxPromptArgBytes?: number;
  mcpDiscovery?: string;
  reasoningOptions?: RuntimeReasoningOption[];
};
```

### 1.3 核心类型：DaemonAgentPayload（归一化事件）

```typescript
// packages/contracts/src/sse/chat.ts

type DaemonAgentPayload =
  | { type: 'status'; label: string; model?: string; ttftMs?: number; detail?: string }
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'thinking_start' }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }
  | { type: 'usage'; usage?: { input_tokens?: number; output_tokens?: number }; costUsd?: number }
  | { type: 'raw'; line: string };
```

### 1.4 streamFormat 分布

| streamFormat | Agent | 解析器 |
|-------------|-------|--------|
| `claude-stream-json` | Claude Code | `claude-stream.ts` — JSONL, 处理 stream_event/content_block/assistant wrapper |
| `json-event-stream` | Codex, Gemini, OpenCode, Cursor, Qwen | `json-event-stream.ts` — 通用 JSONL, 内含 per-agent 子 parser |
| `pi-rpc` | Pi | `attachPiRpcSession()` — JSON-RPC over stdio |
| `acp-json-rpc` | Hermes, Kimi, Kiro, Kilo, Vibe, Devin | `attachAcpSession()` — ACP 协议 |
| `copilot-stream-json` | GitHub Copilot | `copilot-stream.ts` |
| `qoder-stream-json` | Qoder | `qoder-stream.ts` |
| `plain` (fallback) | DeepSeek | 直接 pipe stdout |

### 1.5 端到端数据流

```
用户在 Web UI 发消息
    ↓
POST /api/runs { agentId, message, model, ... }
    ↓
startChatRun(body, run)
    ↓
getAgentDef(agentId) → def: RuntimeAgentDef
resolveAgentLaunch(def, env) → launchPath
def.buildArgs(composed, images, dirs, options) → args[]
    ↓
spawn(launchPath, args, { stdio: [stdin-pipe, pipe, pipe], cwd })
    ↓
if promptViaStdin → child.stdin.write(composed)
    ↓
根据 def.streamFormat 选择 parser:
  claude-stream-json → createClaudeStreamHandler(feed/flush)
  json-event-stream  → createJsonEventStreamHandler(eventParser, sink)
  pi-rpc             → attachPiRpcSession(child, prompt, ...)
  acp-json-rpc       → attachAcpSession(child, prompt, ...)
  ...                → child.stdout.pipe(...)
    ↓
parser 输出 DaemonAgentPayload (text_delta, tool_use, ...)
    ↓
design.runs.emit(run, 'agent', payload)
    ↓
SSE → Web UI 渲染
```

---

## 2. Telegraph 当前架构（SDK-Embedded 模式）

Telegraph 的 agent 接入采用 **SDK-Embedded 模式**：将 runtime SDK 打包进 pagelet utility process，进程内调用。

### 2.1 核心代码位置

```
packages/agent/src/
├── index.ts                    # barrel exports
├── types.ts                    # AgentRuntimeSettings, AgentBackendKind, etc.
├── runtime/
│   ├── AgentRuntime.ts         # RuntimeExecutor 接口 + BaseAgentRuntime 基类
│   ├── PiAiRuntime.ts          # pi-ai 进程内执行器
│   ├── PiEmbeddedRuntime.ts    # pi-ai + embedded tool loop
│   ├── streamPiAiRuntime.ts    # pi-ai stream() → RuntimeEvent 适配
│   ├── LangGraphRuntime.ts     # LangGraph 执行器
│   ├── VercelAiRuntime.ts      # Vercel AI SDK 执行器
│   ├── createRuntime.ts        # 工厂函数 (backend → executor)
│   └── piSubagents/            # 多 agent 编排
├── providers/
│   ├── index.ts                # resolveModel(), DEFAULT_MODEL_CATALOG
│   └── minimax.ts              # MiniMax OpenAI-compat model builder
├── extensions/                 # Extension 加载框架
├── persistence/                # Session/Fact 存储
└── ...

packages/runtime-contracts/src/
├── events.ts                   # RuntimeEvent 联合类型 (15+ 种事件)
├── runtime.ts                  # RuntimeSettings, RunInput, AgentRuntime 接口
├── version.ts                  # RUNTIME_CONTRACT_SCHEMA_VERSION = 1
└── ...

apps/chat/src/application/
├── common/index.ts             # ChatSendRequest, ChatStreamEvent, IChatPageletService
├── node/
│   ├── ChatPageletWorker.ts    # 核心执行：createRuntime → executor.run → emitStreamEvent
│   └── main.ts                 # pagelet worker 入口
└── browser/
    ├── pagelet-agent-service.ts # RPC 客户端，调用 pagelet 的 send/onStreamEvent
    ├── mock-agent-service.ts    # mock fallback
    ├── components/ChatPanel.tsx # UI 主面板
    └── use-chat.ts              # React hook
```

### 2.2 核心类型：RuntimeEvent（框架无关事件协议）

```typescript
// packages/runtime-contracts/src/events.ts

type RuntimeEvent =
  // 生命周期
  | { type: 'run_started'; runId: string; pattern?: WorkflowPattern; ts: number; ... }
  | { type: 'run_completed'; runId: string; output: unknown; ts: number; ... }
  | { type: 'run_failed'; runId: string; error: RuntimeError; ts: number; ... }
  | { type: 'run_cancelled'; runId: string; reason?: string; ts: number; ... }
  // 模型
  | { type: 'model_request'; requestId: string; payload: unknown; ... }
  | { type: 'model_event'; requestId: string; raw: unknown; ... }
  | { type: 'assistant_delta'; requestId: string; text: string; ... }
  | { type: 'assistant_message'; requestId: string; message: RuntimeMessage; ... }
  // 工具
  | { type: 'tool_call'; callId: string; toolName: string; input: unknown; ... }
  | { type: 'tool_result'; callId: string; toolName: string; output: unknown; ... }
  | { type: 'tool_error'; callId: string; toolName: string; error: RuntimeError; ... }
  // Workflow
  | { type: 'step_started'; stepId: string; label: string; ... }
  | { type: 'step_completed'; stepId: string; ... }
  | { type: 'edge_taken'; from: string; to: string; ... }
  | { type: 'child_run_started'; parentRunId: string; childRunId: string; ... }
  | { type: 'child_run_completed'; parentRunId: string; childRunId: string; ... }
  // Extension
  | { type: 'extension_activated'; extensionId: string; ... }
  | { type: 'extension_deactivated'; extensionId: string; ... }
  // 权限
  | { type: 'permission_requested'; ... }
  | { type: 'permission_resolved'; ... }
  // 日志
  | { type: 'runtime_log'; level: string; message: string; ... }
```

### 2.3 端到端数据流

```
用户在 ChatPanel 输入消息
    ↓
useChat().sendMessage(text)
    ↓
PageletAgentService.send({ conversation, onChunk, ... })
    ↓
getChatPageletClient() → RPC proxy
    ↓
client.send({ message, settings, runId, sessionId })   ← RPC call
client.onStreamEvent(callback)                          ← RPC callback 订阅
    ↓
ChatPageletWorker.handleSend(req)   (utility process 内)
    ↓
createRuntime(settings) → executor: RuntimeExecutor
  ├── PiAiRuntime      (pi-ai SDK, 进程内)
  ├── PiEmbeddedRuntime (pi-ai + tool loop)
  ├── LangGraphRuntime  (@langchain/langgraph)
  ├── VercelAiRuntime   (ai-sdk)
  └── PiSubagentsRuntime (多 agent 编排)
    ↓
executor.run({ runId, message, settings, signal }) → AsyncIterable<RuntimeEvent>
    ↓
for await (const ev of runtimeEvents) {
  runtimeEventToChatStream(ev) → ChatStreamEvent
  emitStreamEvent(chatEvent) → RPC callback push
}
    ↓
PageletAgentService.onChunk(delta) / onStatus(status) / onLlmTrace(trace)
    ↓
ChatMessages 组件渲染
```

---

## 3. 核心差异对比

| 维度 | Open Design | Telegraph |
|------|-------------|-----------|
| **执行方式** | `spawn` 外部 CLI 二进制 | 进程内 SDK 调用 |
| **Agent 添加成本** | 1 个 `defs/<agent>.ts`（~30-80 行声明式）+ 1 个 stream parser（~100-300 行，可复用） | 1 个 `RuntimeExecutor` 实现 + SDK 依赖引入 |
| **Agent 发现** | 自动探测本地 PATH（`detectAgents()`） | 用户在 Settings 选择 backend |
| **流协议** | 每个 CLI 有自己的 stdout 格式 → per-format parser 归一化 | SDK 直接返回 structured RuntimeEvent |
| **Prompt 传递** | stdin pipe / argv（有 OS 长度限制） | 内存中直接传参 |
| **MCP 支持** | 写 .mcp.json / ACP 协议转发 | 暂无 |
| **取消机制** | kill child process / abort ACP session | AbortSignal |
| **支持 agent 数** | 16 个（claude, codex, gemini, pi, opencode, hermes, kimi, cursor, qwen, qoder, copilot, kiro, kilo, vibe, deepseek, devin） | 5 个 backend（pi-ai, pi-embedded, pi-subagents, langgraph, vercel-ai） |
| **归一化事件** | `DaemonAgentPayload`（7 种事件，偏展示层） | `RuntimeEvent`（15+ 种事件，含 workflow/extension/permission） |
| **依赖管理** | 不需要打包 SDK 到应用中 | 需要将 pi-ai 等打包进 pagelet bundle |
| **跨平台** | 需要处理 Windows .cmd shim、PATH 解析、native binary discovery | 不需要（进程内调用） |
| **生命周期管理** | 复杂：inactivity watchdog、zombie process、EPIPE、Windows cmd.exe wrap | 简单：AbortSignal + try/catch |
| **版本耦合** | 松耦合——CLI 升级可能 break stdout 格式，但 parser 可独立更新 | 紧耦合——SDK 升级需要重新打包 |

---

## 4. 如果要做 Open Design 式 CLI Adapter，需要的工作

### Phase 0：抽象层设计（~1-2 天）

定义 `CliAgentDef` 类型（对标 `RuntimeAgentDef`）和 `CliAgentEvent` 类型（对标 `DaemonAgentPayload`）。

### Phase 1：核心基础设施（~3-5 天）

| 组件 | 说明 |
|------|------|
| `CliSpawner` | resolveBin + spawn + stdio 管理 + kill |
| Stream Parser 基础设施 | `createStreamParser(format)` 工厂 |
| `json-event-stream` parser | 通用 JSONL parser（覆盖 codex/gemini/opencode/cursor/qwen） |
| `claude-stream-json` parser | Claude Code 专用（content_block/stream_event/assistant wrapper） |
| `pi-rpc` session handler | Pi CLI JSON-RPC over stdio |
| Agent Detection（可选） | `detectCliAgents()` 扫描本地 PATH |

### Phase 2：Agent 定义文件（每个 ~0.5-1 天）

按 Open Design 模式，每个 CLI agent 一个声明文件。`json-event-stream` parser 已覆盖 5+ 个 agent，新增 agent 几乎零成本。

### Phase 3：与现有 RuntimeExecutor 体系集成（~2-3 天）

新增 `CliRuntimeExecutor`，实现 `RuntimeExecutor` 接口，内部调 `CliSpawner`，在 `createRuntime` 中注册。

### Phase 4：UI / Settings 集成（~2-3 天）

Agent 选择器 UI、Model picker 动态化、Agent 安装指引。

### 工作量汇总

| 项目 | 工作量 | 优先级 |
|------|--------|--------|
| `CliAgentDef` 类型定义 | 0.5 天 | P0 |
| `CliSpawner` 核心服务 | 2 天 | P0 |
| 通用 `json-event-stream` parser | 1 天 | P0 |
| `claude-stream-json` parser | 1.5 天 | P0 |
| `pi-rpc` session handler | 2 天 | P1 |
| Agent detection 系统 | 1.5 天 | P1 |
| 3-5 个 agent 定义文件 | 2 天 | P0 |
| `CliRuntimeExecutor` 适配器 | 1.5 天 | P0 |
| `RuntimeEvent` 映射 | 1 天 | P0 |
| Settings / Agent Picker UI | 2 天 | P1 |
| **总计** | **~15 天** | — |

---

## 5. 推荐路径：混合模式

两种模式不是非此即彼。Telegraph 的 `RuntimeEvent` 协议已经足够表达力，可以在同一个 `RuntimeExecutor` 接口下同时支持两种执行方式：

```
ChatPageletWorker.handleSend(req)
    ↓
createRuntime(settings)
    │
    ├── backend in ['pi-ai', 'pi-embedded', 'langgraph', 'vercel-ai', 'pi-subagents']:
    │     → 现有 SDK RuntimeExecutor（进程内执行，高效）
    │
    └── backend is a CLI agent id (e.g. 'claude-code', 'codex', 'gemini'):
          → CliRuntimeExecutor（spawn 子进程，覆盖 CLI 生态）
               ↓
            CliSpawner.spawn(def, args)
               ↓
            StreamParser → CliAgentEvent
               ↓
            映射为 RuntimeEvent（保持统一事件协议）

所有路径最终统一为 AsyncIterable<RuntimeEvent>
```

优势：
- **RuntimeEvent 协议不变**——UI / trace panel / LlmTracePanel 无需改动
- **SDK backend 保持进程内高效**——pi-ai 等不走 spawn
- **CLI backend 通过 CliRuntimeExecutor 接入**——复用 Open Design 的声明式 adapter 模式
- **渐进式实施**：先做 1-2 个 CLI adapter（Claude Code + Codex），验证后再扩展

风险与注意事项：
- spawn 子进程有生命周期管理复杂度（僵尸进程、inactivity 超时）
- stdout 解析是脆弱的——CLI 版本升级可能 break parser
- argv 长度限制 / Windows .cmd shim 兼容性等平台问题需要处理
- A-005 曾明确说"不要长期依赖 spawn CLI"——需要团队对齐是否接受这条路径

---

## 6. 关键决策：Telegraph 是否应该走 CLI Adapter 路线？

### 6.1 支持 CLI Adapter 的理由

- 支持 16+ agent CLI 生态，覆盖面远大于当前 5 个 SDK backend
- 不需要将每个 SDK 打包进应用（减小 bundle 体积）
- 跟上社区趋势：Claude Code / Codex CLI / Gemini CLI / Cursor Agent 等都在快速发展
- Open Design 已经验证了这套模式的可行性（16 个 agent adapter，生产级质量）
- 新增 agent 几乎零成本：`json-event-stream` parser 已覆盖 5+ 个 agent，新增 agent 只需一个 ~40 行声明文件

### 6.2 反对 CLI Adapter 的理由

- spawn 子进程有生命周期管理复杂度（kill、超时、僵尸进程）
- stdout 解析是脆弱的——CLI 升级可能 break parser
- argv 长度限制 / Windows .cmd shim 兼容性等平台问题
- Telegraph 当前定位是"本地 agent 工作台"，不是"CLI 聚合器"
- A-005 明确说了"不要长期依赖 spawn CLI"

### 6.3 推荐：混合模式

两种模式不是非此即彼。Telegraph 的 `RuntimeEvent` 协议已经足够有表达力，可以在同一个 `RuntimeExecutor` 接口下同时支持两种执行方式：

- **SDK backend（进程内）**：pi-ai / pi-embedded / langgraph / vercel-ai / pi-subagents — 高效、无需本地 CLI 安装
- **CLI backend（spawn 子进程）**：claude-code / codex / gemini / pi / opencode / ... — 覆盖 CLI 生态

统一入口是 `createRuntime(settings)`，根据 `backend` 字段路由到不同的 `RuntimeExecutor` 实现。所有路径最终输出 `AsyncIterable<RuntimeEvent>`，下游 UI 完全无感。