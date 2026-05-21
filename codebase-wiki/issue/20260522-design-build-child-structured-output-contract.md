---
id: I-006
title: DesignBuild Child 输出不应依赖自然语言 JSON 文本解析
description: >
  记录 Design Page 生成过程中 child agent 多次因非严格 JSON、连续 JSON、漏逗号、
  未输出 JSON object 等格式问题导致 run 失败的根因；结论是不能用 prompt + JSON.parse
  作为业务协议，应改为 tool calling 结构化提交与 stage schema 校验。
category: issue
created: 2026-05-22
updated: 2026-05-22
tags:
  - design-build
  - structured-output
  - tool-calling
  - runtime
  - schema-validation
status: wip
references:
  - id: I-005
    rel: related-to
    file: ./20260521-design-page-preview-sandpacker-stabilization.md
  - id: D-016
    rel: derived-from
    file: ../discussion/20260521-design-page-agent-generation-product-architecture.md
---

# DesignBuild Child 输出不应依赖自然语言 JSON 文本解析

> DesignBuild child agent 的输出曾经依赖“提示模型只返回一个 JSON object”再由宿主 `JSON.parse`。
> 实际运行中模型会输出解释文本、连续 JSON、漏逗号或半截对象；这些都说明该路径不是可靠协议。
> 正确方向是让模型通过结构化 tool call 提交结果，并在宿主侧做 stage schema 校验。

## 现象

Design Page 生成页面时，`telegraph-design-build` runtime 的 child stage 经常失败，用户可见错误包括：

- `Model child output JSON was invalid: Unexpected non-whitespace character after JSON ...`
- `Model child output JSON was invalid: Expected ',' or ']' after array element ...`
- `Model child output did not contain a JSON object.`

触发链路：

```text
DesignWorkspace prompt
  -> DesignBuildRuntime
  -> ModelBackedDesignBuildChildRunner
  -> streamPiAiRuntimeEvents
  -> child model natural-language output
  -> JSON.parse / JSON extraction
```

## 根因

### 直接触发因

`apps/design/src/application/node/design-build/DesignBuildChildRunner.ts` 之前将 child model 的最终文本视为业务协议：

```text
prompt 要求“Return only one valid JSON object”
  -> 收集 assistant text / final output
  -> 截取 `{...}`
  -> JSON.parse
```

这不是结构化输出协议，只是自然语言约束。模型一旦输出额外解释、多个对象、未转义源码字符串或损坏数组，宿主就无法可靠解析。

### 放大因

`code-artifact` 与 `repair` 阶段可能把大段 TSX 源码塞进 JSON 字符串。源码天然包含 `{}`、引号、换行、模板字符串和 JSX，因此比普通摘要更容易破坏 JSON 文本。

### 辅助因

早期止血补丁尝试做 brace scanner、missing-comma repair、silent fallback 到 deterministic input。它们能降低报错频率，但会引入两个新问题：

- 宿主开始猜测模型意图，业务协议变得不可证明。
- silent fallback 会掩盖模型 child 未按契约工作的事实，trace 与调试都不清楚。

## 结论

DesignBuild child output 必须从“模型返回一段 JSON 文本”改为“模型调用一个提交工具”：

```text
child model
  -> submit_design_child_output({ output })
  -> host validates output by stage
  -> DesignBuildRuntime consumes structured object
```

该设计符合 A-005 的 runtime 原则：框架细节留在 adapter 内，业务层消费稳定的结构化事实；fallback 或错误都必须可追踪，不能静默吞掉。

## 变更清单

本轮修正应落在以下点：

- `apps/design/src/application/node/design-build/DesignBuildChildRunner.ts`
  - 移除 JSON 文本解析、brace scanner、JSON repair 与 silent fallback。
  - 注入 `submit_design_child_output` tool。
  - 按 child stage 生成 tool JSON Schema，避免 `output` 只是泛型 object。
  - 要求 child model 通过 tool argument 的 `output` 字段提交结果。
  - 对 `intent-brief`、`component-retrieval`、`code-artifact`、`repair`、`review`、`review-repair` 做 stage schema 校验。
  - 对不满足 stage schema 的提交执行一次显式 contract retry，把校验错误反馈给模型重新调用 tool；重试仍失败则 fail-fast。
- `apps/design/src/application/node/design-build/__tests__/DesignBuildChildRunner.model.test.ts`
  - 回归测试从“坏 JSON 可被修复/降级”改为“必须 tool call；坏协议显式失败”。
  - 覆盖 `code-artifact` invalid artifact 后通过 contract feedback 重试修正的路径。

## 验证与回归

最小回归命令：

```bash
pnpm --filter @telegraph/design test -- DesignBuildChildRunner
pnpm --filter @telegraph/design typecheck
```

验收标准：

- child runner 不再包含 `JSON.parse(modelText)`、brace scanner 或 missing-comma repair。
- 模型纯文本回答不会被当作有效输出。
- 每个 stage 的工具输出不满足 schema 时显式失败。
- `code-artifact` 的 invalid artifact 会触发一次带错误原因的 contract retry，而不是 JSON repair 或 silent fallback。
- 正常 tool call 输出仍能被 `DesignBuildRuntime` 消费。

## 复发 Runbook

如果未来再次出现 `Model child output JSON ...` 一类错误：

1. 先检查是否有新路径重新引入自然语言 JSON parser。
2. 检查 child prompt 是否仍要求调用 `submit_design_child_output`。
3. 检查 provider/tool calling adapter 是否正确产生 `tool_call` 事件。
4. 若 provider 不支持 tool calling，应显式标记该 runtime/profile 不支持 design-build，而不是退回文本 JSON parser。
