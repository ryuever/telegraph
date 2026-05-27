---
id: I-009
title: Chat session 追问 turn 丢失历史上下文
description: >
  记录 Chat session 中追问会创建新 turn 但部分 runtime 只看到当前 prompt、
  没有消费前文 transcript 的问题；归档 renderer transcript、pagelet session store、
  pi-embedded 与 telegraph-subagents 三条路径的修复和回归验证。
category: issue
created: 2026-05-28
updated: 2026-05-28
tags:
  - chat
  - agent-runtime
  - runtime-message
  - session
  - subagents
status: final
---

# Chat session 追问 turn 丢失历史上下文

> Chat UI 中同一 session 的追问会产生新 turn，但模型侧实际收到的上下文可能只有当前这句话。
> 这类问题不能只看 UI message list 是否存在历史，而要检查 pagelet 组装的 `RuntimeMessage[]` 以及各 runtime 的真实 `model_request.raw.context.messages`。

## 现象

用户在 Chat session 里继续追问时，界面上能看到前文消息，但新 turn 的回答表现得像一个全新会话：

- 追问无法引用上一轮 assistant 的回答。
- 右侧 trace / run console 中，部分路径的真实模型请求只包含当前 prompt。
- 问题反复出现，因为先前修复只覆盖了 renderer → pagelet 的 transcript 传递，没有覆盖所有 runtime adapter 的消费路径。

典型触发路径：

1. 打开 Chat，发送第一条消息并等待 assistant 完成。
2. 在同一个 session 里发送追问。
3. 选择 `pi-embedded` 或 `telegraph-subagents` 相关路径时，模型请求可能缺少第一轮 user / assistant 历史。

## 根因

### 1. renderer transcript 已传到 pagelet，但不是所有 runtime 都消费

`PageletAgentService` 已经会把 `conversation.messages` 转成 `RuntimeMessage[]` 放入 `ChatSendRequest.messages`。这解决了 renderer 层“是否发送历史”的问题，但 runtime 侧仍可能只读取 `input.message`。

关键边界：

- `apps/chat/src/application/browser/pagelet-agent-service.ts:164-168`
- `apps/chat/src/application/node/chat-session-messages.ts:1-35`
- `apps/chat/src/application/node/ChatPageletWorker.ts:342-349`

### 2. `pi-embedded` 使用单句 prompt，绕开 `input.messages`

修复前 `PiEmbeddedRuntime` 会把 session 里最后一个 user message 转成单个 string 再交给 pi-ai stream。这样即使 harness 准备好了完整 transcript，真实 `model_request` 仍然只看见当前 turn。

修复后，`PiEmbeddedRuntime` 通过统一 helper 生成当前 turn transcript，并把它作为 `messages` 传给 `streamPiAiRuntimeEvents`：

- `packages/agent/src/runtime/runtimeMessages.ts:17-35`
- `packages/agent/src/runtime/PiEmbeddedRuntime.ts:82-110`

### 3. `telegraph-subagents` 有三段模型调用都需要 transcript

Telegraph native subagents 不是单一模型调用。一次父 run 里至少可能出现：

1. Team Router 选择 direct / clarify / single / parallel / review。
2. child run 执行具体 agent task。
3. final synthesis 汇总 child result。

修复前这些调用主要传 `message` / `prompt`，因此 parent router、child agent、final synthesis 都可能失去 chat session 前文。

修复后：

- parent runtime 先用 `runtimeMessagesForCurrentTurn` 规范化 chat transcript。
- Team Router 直接消费该 transcript。
- child run 在 transcript 末尾追加 synthetic child task。
- final synthesis 在 transcript 末尾追加 synthetic synthesis prompt。

对应落点：

- `extensions/telegraph-subagents/src/TelegraphSubagentHarness.ts:61-153`
- `extensions/telegraph-subagents/src/SubagentRunner.ts:55-69`
- `extensions/telegraph-subagents/src/orchestrator.ts:39-45`

### 4. pagelet session store 的权威性判断过宽

pagelet 端有持久化 session history，但当 request 里带 `messages` 时会把 renderer transcript 视为权威，避免把 renderer 已恢复的 assistant 历史和 pagelet 持久化历史重复合并。

问题是：如果 renderer 只带了当前 user message，仍然会屏蔽 pagelet 的 durable history。修复后只有 request transcript 中存在非空 assistant 历史时，才启用 `RendererTranscriptSessionStore` 跳过 durable history；否则继续使用 pagelet 持久化 session store。

对应落点：

- `apps/chat/src/application/node/ChatPageletWorker.ts:346-349`
- `apps/chat/src/application/node/ChatPageletWorker.ts:674-693`

## 修复清单

### 新增统一 transcript helper

新增 `packages/agent/src/runtime/runtimeMessages.ts`：

- `runtimeMessagesForCurrentTurn`：确保当前 turn 在 transcript 中，避免旧 turn 里出现同文本时误判。
- `appendSyntheticUserRuntimeMessage`：在已有 chat transcript 末尾追加 runtime-specific prompt，如 child task 或 final synthesis prompt。

这个 helper 的判断标准是“最后一条消息是否就是当前 user message”，不是“历史里是否出现过相同文本”。否则用户连续追问 `again` / `继续` 这类短句时会再次丢当前 turn。

### 修复 `pi-embedded`

`PiEmbeddedRuntime` 现在：

- 将 harness 已准备好的 `input.messages` 作为真实模型上下文。
- 仍保留 scaffold `SessionStore` / `ToolRegistry` 表面，供后续 embedded kernel 演进。
- 将工具调用交给共享 `streamPiAiRuntimeEvents`，避免再维护一套不完整的本地 tool loop。

### 修复 `telegraph-subagents`

`TelegraphSubagentHarness` 现在：

- parent router model call 继承 chat transcript。
- `orchestrate` 将 `conversationMessages` 传递给 `SubagentManager`。
- child runner 在 transcript 末尾追加 child task。
- final synthesis 在 transcript 末尾追加 synthesis prompt。

### 修复 pagelet durable history 兜底

`ChatPageletWorker.sessionStoreForRun` 从“只要有 renderer messages 就视为权威”改为“只有 renderer messages 中包含非空 assistant 历史时才视为权威”。这样：

- renderer 恢复了完整 UI transcript 时，以 renderer transcript 为准，避免重复合并。
- renderer 只带当前 user message 时，仍可从 pagelet 持久化 session history 合并前文。

## 验证

本轮新增 / 覆盖的测试重点不是 UI list，而是真实 runtime 输入：

```bash
pnpm --filter @telegraph/agent test -- --run src/runtime/__tests__/runtimeMessages.test.ts src/runtime/__tests__/PiEmbeddedRuntime.test.ts src/runtime/__tests__/streamPiAiRuntime.test.ts
pnpm --filter @telegraph/extension-telegraph-subagents test -- --run src/__tests__/TelegraphSubagentHarness.test.ts src/__tests__/TelegraphSubagentHarness.faux.test.ts src/__tests__/SubagentManager.test.ts
pnpm --filter @telegraph/chat test -- --run src/application/node/__tests__/chat-session-messages.test.ts src/application/browser/__tests__/pagelet-agent-service.test.ts
```

结果：

- `@telegraph/agent` 相关测试通过。
- `@telegraph/extension-telegraph-subagents` 相关测试通过。
- `@telegraph/chat` 相关测试通过。
- `pnpm --filter @telegraph/chat typecheck` 通过。
- `pnpm --filter @telegraph/chat lint` 通过。
- `pnpm --filter @telegraph/extension-telegraph-subagents typecheck` 通过。
- `pnpm -r typecheck` 通过。

`pnpm -r lint` 当前仍失败，但失败点在未触及的 `apps/design/src/application/node/design-build/ui-component-library/*` 既有 lint 问题，和本次 chat/runtime 修复无关。

## 回归判定

修复是否有效，不要只看 Chat UI 是否展示历史消息。应看以下信号：

1. `telegraph_turn_context` trace 中包含当前 session 的 user / assistant 历史。
2. `model_request.raw.context.messages` 中包含前一轮 user、前一轮 assistant、当前 user。
3. `pi-embedded` 的第一条 `model_request` 不再只有当前 prompt。
4. `telegraph-subagents` 的 router / child / final synthesis 三类 model request 都能看到 chat transcript。
5. 用户连续发送相同短句时，当前 turn 仍会被追加，不会因历史同文本被去重。

## 复发 runbook

如果再次出现“追问没有上下文”：

1. 先打开 LLM Trace，查看 `telegraph_turn_context.messages` 是否完整。
2. 再查看实际 `model_request.raw.context.messages`，以模型真实输入为准。
3. 如果 trace 完整但 model request 不完整，优先排查 runtime adapter 是否只读取 `input.message`。
4. 如果 model request 完整但回答仍像无上下文，排查 provider / SDK 对 assistant 历史消息格式的转换。
5. 如果 renderer 只带当前 user message，检查 pagelet durable session store 是否被错误屏蔽。

## 后续注意

- 新增 runtime adapter 时必须写测试断言 `model_request.raw.context.messages`，不能只断言 `input.message`。
- 涉及 child run / router / final synthesis 的 runtime，需要分别验证每一次模型调用的上下文。
- `RuntimeMessage` 的权威来源要明确：UI transcript 可以恢复完整前文，但 pagelet durable history 必须作为兜底存在。
