# Chat Agent Runtime 接入迁移文档

**ID**: D-011  
**Date**: 2026-05-17  
**Status**: ✅ 实施完成  
**Depends on**: A-005（Agent Runtime 理论）、A-008 §3.4（Pagelet 为 Runtime 承载体）、`packages/agent`（已有 runtime 实现）  
**Related**: `apps/chat`（目标 pagelet）、`packages/runtime-contracts`（类型骨架）

---

## 1. 目标

将 `apps/chat` 的 **mock agent 能力** 替换为 **真实的 agent runtime 执行**，使 ChatPanel 能通过 pagelet RPC 链路调用 `packages/agent` 中已实现的 `RuntimeExecutor`（PiAiRuntime / PiEmbeddedRuntime / LangGraphRuntime / VercelAiRuntime），获取流式 `RuntimeEvent` 并展示在 UI 上。

### 1.1 现状分析

| 组件 | 状态 | 说明 |
|------|------|------|
| `ChatPageletWorker.handleSend()` | ❌ Mock | 仅 echo token，不调 LLM |
| `ChatPanel` 默认 AgentService | ❌ MockAgentService | `use-chat.ts` 中默认 fallback |
| `PageletAgentService` | ⚠️ 已实现未启用 | 已有完整 RPC 调用逻辑 |
| `packages/agent` RuntimeExecutor | ✅ 已实现 | PiAiRuntime / PiEmbeddedRuntime / LangGraphRuntime / VercelAiRuntime |
| `packages/runtime-contracts` | ✅ 类型骨架 | RuntimeEvent 等类型完整 |
| `vite.chat.config.ts` 构建别名 | ❌ 缺少 agent 别名 | 无法 import `@/packages/agent` |
| `IChatPageletService` RPC 接口 | ⚠️ 需扩展 | 当前不支持 async iterable / 取消 |

### 1.2 架构约束

基于 A-008 §I6 + A-005 §0.2：

1. **Runtime 执行只发生在 Pagelet utility process 内**（`ChatPageletWorker`）
2. **Renderer 不感知具体 runtime 实现**，只消费 `RuntimeEvent`（经过 `ChatStreamEvent` 封装）
3. **所有 IPC 走 ConnectionOrchestrator + RPC**（已满足，chat pagelet 已接入）
4. **`packages/agent` 依赖 `@mariozechner/pi-ai`（Node.js only）**，不能在 renderer 中 import
5. **流式事件通过 `onStreamEvent` callback 推送**（已在 RPC 接口中定义）

---

## 2. 数据流设计

### 2.1 端到端流路

```
┌─────────────────────────────────────────────────────────────────┐
│ Renderer (BrowserWindow)                                         │
│  ChatPanel → useChat() → PageletAgentService                     │
│    ↓ client.send(request)           ← RPC call                  │
│    ↓ client.onStreamEvent(cb)       ← RPC callback subscription │
│    ↑ onChunk / onStatus / onLlmTrace → ChatMessages / TracePanel│
└────────────────────────┬────────────────────────────────────────┘
                         │ ConnectionOrchestrator direct channel
┌────────────────────────▼────────────────────────────────────────┐
│ Chat Pagelet (UtilityProcess)                                    │
│  ChatPageletWorker.handleSend(req)                               │
│    ↓ createRuntime(settings) → executor                          │
│    ↓ executor.run({ runId, message, settings, signal })          │
│    ↓ for await (ev of runtimeEvents)                             │
│    ↓   emitStreamEvent(runtimeEventToChatStream(ev))            │
│  RuntimeExecutor (packages/agent)                                │
│    ↓ pi-ai SDK / LangGraph / Vercel AI SDK                       │
│    ↑ RuntimeEvent { model_request, assistant_delta, ... }        │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 RuntimeEvent → ChatStreamEvent 映射

| RuntimeEvent.type | ChatStreamEvent.type | 说明 |
|-------------------|---------------------|------|
| `run_started` | `run_started` | Run 开始 |
| `model_request` | `llm_trace` (kind: `runtime_event`) | 记录发往模型的原始请求 |
| `assistant_delta` | `text_delta` | 文本增量，驱动 UI 逐字显示 |
| `model_event` | `runtime_event` | 模型原始事件（trace 用） |
| `tool_call` / `tool_result` | `runtime_event` | 工具调用 |
| `step_started` / `step_completed` | `runtime_event` | Workflow 步骤 |
| `run_completed` | `run_completed` | Run 完成 |
| `run_failed` | `run_failed` | Run 失败 |
| `run_cancelled` | `run_failed` (error) | Run 被取消 |
| `runtime_log` | `runtime_event` | Runtime 日志 |

---

## 3. 实施步骤

### Step 1: 构建配置 — 添加 agent 包别名
**文件**: `apps/main/vite.chat.config.ts` — 添加 `@/packages/agent` 别名

### Step 2: ChatPageletWorker — 接入真实 Runtime
**文件**: `apps/chat/src/application/node/ChatPageletWorker.ts`
- 导入 `createRuntime` 从 `@/packages/agent`
- `handleSend()` 改为 async：创建 executor → `executor.run()` → 迭代 RuntimeEvent → 映射为 ChatStreamEvent
- 支持 AbortSignal 取消
- 错误处理：runtime 异常 → `run_failed` 事件

### Step 3: Browser 侧 — 启用 PageletAgentService
**文件**: `apps/chat/src/application/browser/components/ChatPanel.tsx`
- 默认 agentService 从 MockAgentService 切换为 PageletAgentService
- 保留 MockAgentService 作为 fallback

### Step 4: 添加 @telegraph/agent 依赖
**文件**: `apps/chat/package.json`

---

## 4. 风险与注意事项

### 4.1 pi-ai 依赖在 worker bundle 中的处理
`@mariozechner/pi-ai` 是纯 Node.js 包，chat worker 通过 `vite.chat.config.ts` 构建为 CJS bundle。需要确保 `node:` 内置模块在 `external` 列表中（已在 vite.chat.config.ts 中配置）。

### 4.2 API Key 安全
当前 MVP 阶段沿用 localStorage 方案。长期应走 `SecretsService`（A-008 §3.2）。

### 4.3 RPC callback 推流的背压
当前方案不做特殊背压控制，依赖 x-oasis RPC 内部缓冲。如后续出现性能问题需要做事件采样/聚合。

### 4.4 不触碰的红线
- ❌ 不在 renderer 中 import `packages/agent`
- ❌ 不在 main process 中执行 `runtime.run()`
- ❌ 不使用裸 IPC（ipcMain/ipcRenderer）

---

## 5. 后续演进

1. **P1**: PiEmbeddedRuntime（嵌入式 tool loop）
2. **P1**: ExtensionRegistry 接入
3. **P2**: PiSubagentsRuntime（多 agent 编排）
4. **P2**: LangGraph / Vercel AI SDK runtime 切换
5. **P3**: TracePanel 完整重建

---

## 6. 变更清单

| # | 文件 | 变更类型 | 说明 |
|---|------|---------|------|
| 1 | `apps/main/vite.chat.config.ts` | 修改 | 添加 `@/packages/agent` 别名 |
| 2 | `apps/chat/src/application/node/ChatPageletWorker.ts` | 重写 | Mock → 真实 runtime 执行 |
| 3 | `apps/chat/src/application/browser/components/ChatPanel.tsx` | 修改 | MockAgentService → PageletAgentService |
| 4 | `apps/chat/package.json` | 修改 | 添加 `@telegraph/agent` 依赖 |