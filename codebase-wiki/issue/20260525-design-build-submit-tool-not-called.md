---
id: I-007
title: DesignBuild Worker 未调用 submit_design_child_output 导致 run failed
description: >
  记录 DesignBuild 移除 repair subagent 后仍可能在 Code Artifact 阶段失败的协议问题：
  Design Worker 模型没有调用 submit_design_child_output 工具提交结构化 artifact，导致
  child runner 无法得到正式输出并直接 run failed。该问题属于模型/adapter 的协议遵循失败，
  不是 preview 编译错误。
category: issue
created: 2026-05-25
updated: 2026-05-25
tags:
  - design-build
  - submit-tool
  - tool-calling
  - structured-output
  - preview-handoff
status: draft
references:
  - id: I-006
    rel: related-to
    file: ./20260522-design-build-child-structured-output-contract.md
---

# DesignBuild Worker 未调用 submit_design_child_output 导致 run failed

> `Design build child "Design Worker" did not call submit_design_child_output.` 不是页面代码运行错误。
> 它发生在 DesignBuild child runner 的结构化提交协议层：模型完成了 run，但没有调用最终提交工具，宿主因此拿不到正式 artifact。

## 现象

用户在 Design Page 出码时看到 run failed：

```text
Design build child "Design Worker" did not call submit_design_child_output.
```

触发链路：

```text
DesignBuildRuntime
  -> DesignBuildWorkflow.runArtifactStage
  -> DesignBuildSubagentGateway.runChild(label: Design Worker)
  -> ModelBackedDesignBuildChildRunner.runChild
  -> streamPiAiRuntimeEvents
  -> 模型未调用 submit_design_child_output
  -> ModelChildOutputContractError
```

当前 workflow 在 `apps/design/src/application/node/design-build/DesignBuildWorkflow.ts:293-299` 调用 Design Worker，并期待 child output 能被解析成 artifact。真正抛错的位置在 `apps/design/src/application/node/design-build/DesignBuildChildRunner.ts:180-182`。

## 根因

### 直接触发因

`submit_design_child_output` 被设计成每个 child stage 的“交卷工具”。child runner 在系统提示词里要求模型必须调用一次：

```text
You must call the submit_design_child_output tool exactly once. Do not answer with text.
```

对应代码在 `apps/design/src/application/node/design-build/DesignBuildChildRunner.ts:270-280`。

runner 只在收到 `submit_design_child_output` 的 `tool_result` 后，才会把 `output` 视为 stage 的正式输出：

- 收集提交工具输入：`DesignBuildChildRunner.ts:129-131`
- 校验并 finalize：`DesignBuildChildRunner.ts:159-172`
- 没有提交则抛错：`DesignBuildChildRunner.ts:180-182`

所以这次失败更准确地说是 **模型/adapter 没有遵守 tool calling 提交流程**，不是 generated artifact 自身已经进入 preview 后报错。

### 放大因

Design Worker 阶段同时携带多类工具约束：

- `get_shadcn_component_usage`
- `create_shadcn_project`
- `add_shadcn_component`
- `validate_shadcn_component_usage`
- `submit_design_child_output`

当模型花掉较多 tool iteration 做组件安装或校验后，可能在最后一步没有再发起提交工具调用；或者模型普通文本回答了结果，但宿主不会把普通文本当作正式 artifact。

### 与 repair 移除的关系

移除 repair subagent 后，review / visual review 不再提前阻断 artifact 进入 preview。但 `submit_design_child_output` 失败发生在更早的 Code Artifact 阶段：此时 workflow 还没拿到 worker artifact，因此没有东西可以交给 preview。

## 判断标准

遇到 DesignBuild 失败时先区分三类问题：

| 类型 | 表现 | 归因 |
|---|---|---|
| 未调用 `submit_design_child_output` | `did not call submit_design_child_output` | 模型/adapter 协议遵循失败 |
| 调用了提交工具但 schema 不对 | `output contains an invalid artifact` 或 stage schema 错误 | 结构化输出失败 |
| artifact 已提交但 preview 报错 | Sandpacker/iframe/console 报编译或运行错误 | generated artifact 代码问题 |

## 处理方向

短期建议：

- 保留 `submit_design_child_output` 作为正式协议，避免退回自然语言 JSON 解析。
- 在 child run trace 中突出显示“是否调用 submit tool”和“最后一次 tool call 名称”，便于定位。
- 检查 `maxToolIterations` 是否被组件工具链耗尽，必要时对 Code Artifact 阶段加余量。

中期建议：

- 若 worker 已经通过 `create_shadcn_project` / `add_shadcn_component` / `validate_shadcn_component_usage` 产生了 `toolArtifact`，但最终没有 submit，可考虑把 `toolArtifact` 作为 degraded artifact 交给 preview，并在 metadata 中标记 `submitMissing: true`。
- 对没有任何 artifact 的情况仍应失败，因为 preview 没有可运行项目。
- 后续 preview 报错再进入用户驱动的模型迭代，而不是重新启用 reviewer/repair subagent。

## 回归点

后续修复该问题时至少覆盖：

- 模型正常调用 `submit_design_child_output`：行为不变，走 schema 校验。
- 模型调用 shadcn project tools 但未 submit：如果有 `toolArtifact`，run completed 并进入 preview，同时记录 degraded metadata。
- 模型既未 submit 也未产生 artifact：仍然 run failed，错误说明应明确是协议提交缺失。
- 不恢复 `repair` / `review-repair` child stage。
