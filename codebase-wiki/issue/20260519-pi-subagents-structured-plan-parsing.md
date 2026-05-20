---
id: I-004
title: pi-subagents 触发不应由自然语言 parser 决定
description: >
  记录 Chat Subagents 卡片可见后，第一次修复误把用户自然语言解析成 subagent plan。
  正确模型应与 pi-subagents 源码一致：把 subagent 暴露为 LLM tool，由 parent model
  判断是否调用以及如何拆分，而不是要求用户输入 JSON 或靠 runtime 正则解析自然语言。
category: issue
created: 2026-05-19
updated: 2026-05-19
tags: [agent-runtime, pi-subagents, chat, tool-call, runtime-event]
status: final
---

# pi-subagents 触发不应由自然语言 parser 决定

## 现象

Chat UI 已能把 `child_run_started` / `child_run_completed` 投影为 Subagents 卡片，但用户用自然语言要求“启动 2 个子代理”时，第一次修复走偏了：

- 增加 fenced JSON plan 解析；
- 增加 `parseNaturalLanguageOrchestratorInput()`，从编号小节里猜 agent/label/task；
- 把“用户怎么说”变成 runtime deterministic parser 的输入。

这破坏了使用性：普通用户不该在会话框里写 JSON，也不该被 runtime 正则模板限制表达方式。

## 正确参考

`/Users/ryuyutyo/Documents/code/modules/ai/pi-subagents` 的实现不是自然语言 parser：

- `src/extension/index.ts` 注册名为 `subagent` 的 tool；
- `src/extension/schemas.ts` 定义 tool 参数：`agent/task`、`tasks[]`、`chain[]`、`concurrency`、`context` 等；
- `README.md` 与 `skills/pi-subagents/SKILL.md` 的产品入口仍是自然语言；
- parent agent 的 LLM 根据自然语言、tool schema 与上下文决定是否调用 `subagent`；
- extension/executor 只负责执行已经结构化的 tool call 参数。

正确链路应是：

```text
用户自然语言
  -> parent model 判断是否需要 delegation
  -> parent model 调用 subagent tool，给出结构化参数
  -> PiSubagentsRuntime 执行 tool call 对应的 single / parallel / chain
  -> RuntimeEvent child_run_* 进入 Chat UI
```

## 根因

Telegraph 的 `PiSubagentsRuntime` 曾经直接根据 `orchestrationPattern` 生成默认 chain / parallel 计划；第一次补丁为了让 prompt 可控，又在 runtime 内解析 JSON 和编号式自然语言。

这两个方向都混淆了职责：

- runtime 不应该替模型做意图识别；
- Chat 输入框不应该成为 workflow DSL 编辑器；
- JSON 可以作为内部 tool-call 参数形态，但不能成为用户交互契约；
- 自然语言拆分的自由度属于模型，不属于正则 parser。

## 修复

本次修复移除了自然语言 plan parser，并改成模型驱动选择：

- `streamPiAiRuntimeEvents()` 增加可选 `systemPrompt`，让调用方能给 parent selector 注入明确职责；
- `PiSubagentsRuntime` 在真正执行 child run 前，先运行 parent model；
- parent model 可见一个 `subagent` tool；
- 如果模型调用 `subagent`，runtime 把 tool arguments 映射成 `SubagentOrchestratorInput` 后执行 orchestrator；
- 如果模型不调用 tool，runtime 直接完成本轮，不启动 child run；
- `parseNaturalLanguageOrchestratorInput()` 与 fenced JSON 用户消息解析被移除；
- 结构化参数只存在于模型 tool call 内部，不要求用户手写。

关键代码位置：

- `packages/agent/src/runtime/piSubagents/PiSubagentsRuntime.ts`
- `packages/agent/src/runtime/streamPiAiRuntime.ts`
- `packages/agent/src/runtime/piSubagents/__tests__/PiSubagentsRuntime.test.ts`

## 当前限制

这仍是嵌入式 MVP，不是完整 pi-subagents extension host：

- parent selector 的 `subagent` tool 只覆盖执行型参数，不覆盖 create/update/status/interrupt/resume 等管理动作；
- child run 在 parent selector 完成后启动，后续可以优化成 tool execution 期间实时转发 child events；
- 默认 chain / parallel 仅作为模型调用 `subagent` 但未给出明确结构时的兜底，不再由用户自然语言直接触发。

## 验证

新增/更新回归测试：

- 模型调用 `subagent({})` 时，才启动默认 chain；
- 模型用 `tasks[]` 调用 `subagent` 时，只启动 tool call 指定的子代理；
- 自然语言编号 prompt 在 runtime 内不会被解析，若模型不调用 tool，则不会启动 child run；
- child failure 仍会汇总成 parent `run_failed`。

执行结果：

```bash
pnpm --filter @telegraph/agent exec vitest run src/runtime/piSubagents/__tests__/PiSubagentsRuntime.test.ts
# 1 file passed, 6 tests passed

pnpm --filter @telegraph/agent exec vitest run src/runtime/__tests__/streamPiAiRuntime.test.ts
# 1 file passed, 1 test passed

pnpm exec tsc -p packages/agent/tsconfig.json --noEmit
# passed
```

## 回归 Runbook

如果未来再次出现“用户自然语言要求两个子代理，但实际启动了错误子代理”：

1. 先看 parent run 是否出现 `tool_call`，且 `toolName === "subagent"`；
2. 如果没有 tool call，问题在 parent model 决策或 selector system prompt，不在 UI；
3. 如果 tool call 参数正确但 child run 错误，排查 `readToolOrchestratorInput()` 与 `orchestrate()`；
4. 如果 child run 正确但 UI 不显示，排查 Chat 的 `child_run_*` 投影；
5. 不要重新引入自然语言 parser 作为修复。
