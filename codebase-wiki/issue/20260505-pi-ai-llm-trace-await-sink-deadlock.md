---
id: I-002
title: pi-ai 流式首包后卡住与助手长期 pending（llm_trace await sink 死锁）
description: >
  记录 minimax-cn + pi-ai 路径下仅出现 pi-ai stream 的 start 事件、无 text_delta、
  UI 助手消息长期 pending 的现象；根因为 daemon 内 await llm_trace 的 sink.push
  与主进程 ipc.invoke(runStream) 形成 RPC 互等；修复为对 llm_trace 使用 safePush。
category: issue
created: 2026-05-05
updated: 2026-05-05
tags: [agent, pi-ai, ipc, deadlock, streaming, minimax-cn, llm_trace, AgentStreamService]
status: final
references:
  - id: A-002
    rel: related-to
    file: ../architecture/20260504-multi-process-topology.md
  - id: A-004
    rel: related-to
    file: ../architecture/20260504-multica-implementation-map-and-telegraph-adaptation.md
  - id: A-005
    rel: related-to
    file: ../architecture/20260505-telegraph-agent-runtime-extension-host-theory.md
---

# pi-ai 流式首包后卡住与助手长期 pending（llm_trace await sink 死锁）

> 本文归档一次 **Agent 流式路径** 的故障：配置为 `execution-backend=pi-ai`、`orchestration=none`、provider `minimax-cn` 时，控制台仅打印一条 `stream event`（`type: 'start'`），聊天区助手气泡长期 **pending / streaming**，无正文回流。

## 现象（Symptoms）

- 用户消息已入列；调试日志中 `context` 与首条 `stream event` 可见，形态类似：

  ```text
  stream event { type: 'start', partial: { role: 'assistant', content: [], api: 'anthropic-messages', ... } }
  ```

- 之后 **不再出现** `text_delta` 等后续事件；渲染进程侧 **等不到** `run_completed` / `done`（或等到超时）。
- UI：助手占位消息一直处于 **pending**（或等价“未完成”状态），用户误以为 minimax-cn 或 orchestration 配置有误。

## 影响范围（Impact）

- 影响 **pi-ai 进程内后端**（`packages/agent` 的 `PiAiBackend`）经 **daemon** 内 `AgentStreamService` 转发到主进程 sink 的整条链路。
- **与模型无关**：`start` 在 HTTP 响应建立后即由 `@mariozechner/pi-ai` 发出（见 `node_modules/@mariozechner/pi-ai/dist/providers/anthropic.js` 中 `stream.push({ type: "start", partial: output })`）；若随后逻辑卡住，任何 provider 均可复现同类死锁（只要走同一代码路径且启用 `onPiAiStreamEvent` 的阻塞 push）。

## 根因（Root Cause）

### 1) 直接触发因：`await` 与 `sink.push` 形成互等

1. `PiAiBackend.send` 对每个流事件执行 **`await input.onPiAiStreamEvent?.(event)`**（`packages/agent/src/backends/PiAiBackend.ts:54`）。
2. `AgentStreamService` 中 `onPiAiStreamEvent` 曾调用 **`pushLlmTrace(...)`**，其内部为 **`await` 主进程 `IAgentStreamSink.push`**（RPC）。
3. 主进程 **`ipcMain.handle(AGENT_STREAM_CHANNEL, …)`** 正在 **`await daemonAgent.runStream(...)`**，直到整次 run 结束才返回（`apps/telegraph/src/services/agent/electron-main/AgentHandler.ts:31-40`）。
4. 首条流事件几乎总是 **`start`**：daemon 在处理完 `start` 后阻塞在 **llm_trace 的 push** 上，无法继续消费 SSE、无法触发 `text_delta` / `done`；主进程则一直等 `runStream` 完成 → **典型 RPC / MessagePort 死锁**。

同一文件内已对 `run_queued` / `run_started` 使用 **`safePush`**（不阻塞）以避免类似问题，注释中已说明原因（`AgentStreamService.ts:93-95`）；**`llm_trace` 路径遗漏**，导致首事件后仍可能卡死。

### 2) 放大因：表象像“模型只回一条 / provider 坏了”

- `start` 的 `partial.content` 为空数组、`usage` 全零属 **正常**（尚未进入 `content_block_*`）。
- 若未意识到死锁，容易误判为 minimax-cn SSE 或 orchestration 行为异常。

### 3) 辅助因：`onDone` 侧亦为 fire-and-forget 的 `void push`（非本次主因）

- `run_completed` / `done` 依赖流循环跑完并触发 `done` 事件；死锁时循环无法前进，故终端事件也不会到达。

## 时间线（简记）

| 阶段 | 事件 |
|------|------|
| 复现 | 仅见 `start` 一条 stream 日志 + UI pending |
| 定位 | 对照 `PiAiBackend` 的 `await onPiAiStreamEvent` 与 `AgentStreamService` 的 `push` / `safePush` 分工 |
| 修复 | `onPiAiStreamEvent` 改为 **`safePushLlmTrace`**，与 `runPiCliStream` 的 `onLlmTrace: safePushLlmTrace` 一致 |
| 结论 | 首事件后流可继续；`text_delta` 与结束事件按模型正常行为到达 |

## 变更清单（Changes Applied）

| 文件 | 改动要点 |
|------|----------|
| `apps/telegraph/src/services/agent/node/AgentStreamService.ts` | `onPiAiStreamEvent`：由 `pushLlmTrace` 改为 **`safePushLlmTrace`**，避免在 `runStream` 未完成时 **await** sink |

可选加固（未强制）：在 `PiAiBackend` 中对 `onPiAiStreamEvent` **不 await**（或 `void` + rejection 处理），以免其他调用方再次传入阻塞型回调。

## 验证与回归（Verification）

1. 设置：`backend=pi-ai`，`orchestration=none`，任选已配置 API Key 的 provider（含 `minimax-cn`）。
2. 发送普通用户消息；预期：控制台除 `start` 外陆续出现 **`text_delta`**（或模型无输出时仍应收到 **`done`** / 结束语义），助手气泡结束 **pending**。
3. 打开 LLM trace：应能持续收到 `pi_ai_stream_event`，且不与主业务 chunk 互锁。

复发时 **Runbook**：先查 daemon 日志是否停在首条 `stream event` 之后；再查 `onPiAiStreamEvent` / `pushLlmTrace` 是否被改回 **await push**。

## 源码锚点（便于跳转）

- `packages/agent/src/backends/PiAiBackend.ts:50-74` — `for await` 与 `await input.onPiAiStreamEvent`
- `apps/telegraph/src/services/agent/node/AgentStreamService.ts` — `safePush` / `safePushLlmTrace`、`onPiAiStreamEvent` 绑定
- `apps/telegraph/src/services/agent/electron-main/AgentHandler.ts:31-40` — `ipc.invoke` 与 `daemonAgent.runStream` 的等待关系
