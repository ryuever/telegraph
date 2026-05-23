---
id: D-016
title: Design Page 一句话生成页面的产品定位与 Agent 编排架构
description: >
  归档 Design Page 对标 v0 / Lovable 的产品形态讨论：从空白入口、聊天迭代、
  右侧 preview/source workbench，到首轮出码所需的 PRD、组件资产注入、组件召回、
  patch artifact 与 subagents 编排边界。
category: discussion
created: 2026-05-21
updated: 2026-05-24
tags:
  - design-page
  - design-build
  - agent-runtime
  - native-harness
  - subagents
  - artifact
status: draft
references:
  - id: D-015
    rel: extends
    file: ./20260520-agent-runtime-product-layer-alignment.md
  - id: A-012
    rel: related-to
    file: ../architecture/20260520-telegraph-harness-extension-architecture.md
  - id: P-008
    rel: derives
    file: ../roadmap/20260521-design-page-agent-generation-implementation-plan.md
  - id: P-009
    rel: derives
    file: ../roadmap/20260521-design-page-preview-editor-handoff.md
  - id: I-006
    rel: derives
    file: ../issue/20260522-design-build-child-structured-output-contract.md
  - id: A-014
    rel: derives
    file: ../architecture/20260524-design-build-standalone-project-output-contract.md
---

# Design Page 一句话生成页面的产品定位与 Agent 编排架构

> Design Page 的下一阶段应被定位为 repo-aware 的本地 design-to-code 工作台：
> 用户用一句话生成页面，通过聊天迭代，通过右侧 workbench 查看 preview/source，
> 而 Telegraph 把 PRD、组件资产、召回依据、代码 patch、验证与 trace 作为一次可观察的 Run 产物。

## 1. 产品定位

Design Page 可以在交互形态上对标 Vercel v0 / Lovable：

- 初始状态是空白页面，中间放一个想法输入框。
- 输入框下方放若干 shortcut / prompt suggestion，帮助用户快速表达页面类型。
- 用户提交后进入工作区：左侧是 chat 会话，右侧是 preview/source 展示区。
- 用户可以继续在 chat 中修改页面，也可以通过 preview 选中组件，进入组件编辑。

但 Telegraph 的差异化不应该是“另一个黑盒网页生成器”，而是：

- **本地 repo-aware**：生成过程知道当前项目技术栈、`packages/ui` 组件、路径 alias、样式约束与 patch 权限。
- **Run-first**：每次生成/修改都是一个可观察、可取消、可复盘的 `Run`。
- **Artifact-first**：首轮出码先产出可预览 artifact / patch，不默认直接改源码。
- **Trace-first**：PRD、组件召回、模型上下文、tool call、patch preview 都能在 trace / run console 中定位。
- **Native Harness-first**：Telegraph 自己定义 design-build 编排，External Runtime 只作为外部产品路径，不进入 Design Page 的默认心智。

## 2. 现有基座判断

当前仓库已经具备 Design Page 的产品骨架：

- 空白入口与工作区切换已由 `DesignEntry` / `DesignWorkspace` 承担。
- 左 chat、右 artifact workbench 已存在：`apps/design/src/application/browser/DesignWorkspace.tsx:19`。
- artifact 可从 `assistant_message`、`tool_result`、`run_completed` 投影：`apps/design/src/application/browser/design-agent-projector.ts:20`。
- pagelet utility process 内已有 harness 执行入口：`apps/design/src/application/node/DesignPageletWorker.ts:95`。
- `AgentHarness` 已按 Run 执行、校验事件、支持 trace/hook：`packages/agent/src/harness/AgentHarness.ts:135`。

所以主要缺口不是 UI 框架，而是 **Design 专用首轮出码编排还没有成为一等 runtime / harness**。
当前默认仍是泛用 `pi-ai` 或泛用 subagents，缺少 design-build 场景的固定阶段、产物格式与验证策略。

## 3. 目标架构

第一阶段建议新增一个 Design Page 专用 runtime：`telegraph-design-build`。
它是 Design pagelet 内部能力，不进入 main / daemon / shared，也不改变 `RuntimeEvent` 协议。

```text
Renderer Design UI
  -> IDesignPageletService.sendAgent
    -> DesignPageletWorker
      -> createAgentHarness
        -> telegraph-design-build runtime
          -> DesignBuildOrchestrator
            -> model/tool loop
            -> component asset registry
            -> artifact/patch generator
            -> optional subagents
```

推荐落点：

```text
apps/design/src/application/node/design-build/
  DesignBuildRuntime.ts
  DesignBuildOrchestrator.ts
  DesignBuildArtifacts.ts
  ComponentAssetRegistry.ts
  prompts.ts
  __tests__/
```

这样可以保持两个边界：

- **进程边界**：agent runtime 仍在 design pagelet utility process 内执行。
- **协议边界**：renderer 只消费 `AgentEvent / RuntimeEvent`，不理解 DesignBuild 内部 DSL。

## 4. 首轮出码编排

首轮生成建议固定为六个阶段。它是 Design Page 的产品流程，不是 Telegraph 通用 workflow DSL。

### 4.1 Intent Brief

把一句话输入整理成内部 PRD：

- 页面类型与目标用户。
- 主要信息架构。
- 必备组件与交互。
- 视觉风格约束。
- 空/加载/错误等状态。
- 验收标准。

默认不打断用户。只有缺少关键目标、无法判断页面类型或存在明显冲突时，才进入 clarify。

### 4.2 Context Assembly

注入项目上下文：

- 当前技术栈与目录约定。
- `@/` alias 规则。
- `packages/ui` 可用组件。
- Tailwind / shadcn 使用方式。
- Design Page workbench 支持的 artifact 形态。
- 当前会话已有 artifact / patch / 用户修改意图。

上下文应结构化提取，不要把全仓库直接塞进 prompt。

### 4.3 Component Retrieval

根据 PRD 召回组件资产：

- 基础 UI 组件：button、input、tabs、dialog、sidebar、card 等。
- 业务组件或页面片段。
- icon / layout pattern / form pattern。
- 组件源码与 import 路径。

召回结果应包含选择理由和不使用某些组件的理由，便于 review 和 trace。

### 4.4 Page Plan

生成页面结构计划：

- section 列表。
- component tree。
- state model。
- mock data。
- responsive strategy。
- source file target。

这个计划不一定直接展示给用户，但应进入 trace。

### 4.5 Code Artifact

生成可预览产物。MVP 有两种产物：

```typescript
type DesignPreviewArtifact = {
  id: string
  kind: 'design-preview'
  title: string
  html?: string
  code?: string
}
```

```typescript
type DesignPatchArtifact = {
  id: string
  kind: 'design-patch'
  title: string
  operations: Array<{
    kind: 'add' | 'update' | 'delete'
    path: string
    content?: string
    expectedOriginal?: string
  }>
}
```

第一版建议优先 `design-patch`，因为当前 workbench 已经支持 patch preview / apply。

### 4.6 Review & Repair

执行一轮自检：

- 是否满足 brief。
- 是否使用了召回组件与正确 import path。
- 是否违反 alias / Electron / pagelet 边界。
- patch 是否只写允许路径。
- 是否存在明显 JSX / Tailwind / 文案问题。

失败时允许自动 repair 一轮。不要无限循环。

## 5. Subagents 的位置

Subagents 不应该替代主编排器。主编排器负责阶段、状态、终止条件和 artifact 格式；
subagents 只做边界清晰的 sidecar / worker 任务。

推荐角色：

| 角色 | 任务 | 何时启用 |
|------|------|----------|
| `product-planner` | 把一句话整理成 brief / acceptance criteria | 首轮生成默认启用 |
| `component-scout` | 搜索并总结可用组件资产 | 项目组件较多时启用 |
| `design-worker` | 生成页面代码或 patch | 首轮生成核心 worker |
| `reviewer` | 检查 PRD 对齐、组件使用、明显代码问题 | patch 输出前启用 |

推荐执行形态：

```text
parent run
  step: brief
  step: context
    parallel:
      - component-scout
      - asset-scout
  step: codegen
  step: review
  optional step: repair
  run_completed with artifact
```

关键原则：

- child run 的输出必须回到 parent run 汇总，不能直接改 UI 状态。
- child run 只通过 `RuntimeEvent` 可观察，不把 subagent 私有类型泄漏到 renderer。
- 写文件动作仍走 patch artifact + 用户确认。

## 6. 产物与 UI 投影

Design UI 不需要知道底层如何编排，只需要识别 artifact。
现有投影逻辑已经足够作为第一版入口：

- `tool_result.output.artifact`
- `assistant_message.metadata.artifact`
- `run_completed.output.artifact`

后续可以扩展 view model，但不需要新增 `RuntimeEvent.type`。

建议约定：

- `kind: 'design-preview'`：用于 iframe / preview。
- `kind: 'design-patch'`：用于 patch preview / apply。
- `kind: 'design-brief'`：可选，用于 trace 或调试，不一定进入右侧 workbench。
- `kind: 'component-retrieval'`：可选，用于 trace 或组件资产面板。

## 7. 非目标

第一阶段不做：

- 通用 Telegraph Workflow DSL。
- preview 内真实 DOM 选中与组件编辑器接入。
- 跨 pagelet 共享 runtime 或让 renderer 直连其他 pagelet。
- 直接写源码的“一步到位”模式。
- 把 v0 / Lovable 的云端 black-box 体验完整复刻。

第一阶段要做的是把“首轮出码”变成可运行、可观察、可回滚的 DesignBuild Run。

## 8. 结论

Design Page 的核心不是多放一个 chat 输入框，而是建立一个 DesignBuild Native Harness：

- 用户输入自然语言。
- 系统内部固定执行 brief / context / retrieval / plan / artifact / review。
- subagents 作为受控 worker 参与，而不是自由编排主流程。
- 输出优先是 artifact / patch。
- 所有过程进入 `RuntimeEvent` trace。

对应实施计划见 [P-008 Design Page 一句话生成页面可执行实施计划](../roadmap/20260521-design-page-agent-generation-implementation-plan.md)。
