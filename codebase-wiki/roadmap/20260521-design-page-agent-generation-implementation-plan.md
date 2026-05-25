---
id: P-008
title: Design Page 一句话生成页面可执行实施计划
description: >
  将 Design Page 从泛用 agent chat 升级为可追踪的 design-build 工作流：
  先落 pagelet-local DesignBuildRuntime 与 artifact 协议，再接组件资产召回、
  首轮 patch 出码、review/repair、subagents 协作与后续聊天修改。
category: roadmap
created: 2026-05-21
updated: 2026-05-26
tags:
  - design-page
  - design-build
  - implementation-plan
  - artifact
  - component-retrieval
  - subagents
status: wip
references:
  - id: D-016
    rel: derived-from
    file: ../discussion/20260521-design-page-agent-generation-product-architecture.md
  - id: P-009
    rel: extended-by
    file: ./20260521-design-page-preview-editor-handoff.md
  - id: A-014
    rel: related-to
    file: ../architecture/20260524-design-build-standalone-project-output-contract.md
  - id: P-011
    rel: extended-by
    file: ./20260524-design-page-shadcn-design-system-roadmap.md
  - id: D-018
    rel: related-to
    file: ../discussion/20260526-clauge-product-ui-research.md
---

# Design Page 一句话生成页面可执行实施计划

> 目标：把 Design Page 的下一阶段从“泛用模型聊天 + artifact workbench”
> 收敛为 pagelet-local 的 DesignBuild Run。每个阶段都有明确产物、验收证据与回归命令，
> 便于后续按 checklist 推进。

## 0. 总体执行原则

- Runtime 只在 design pagelet utility process 内执行。
- 不新增 `RuntimeEvent.type`；DesignBuild 内部状态通过 `step_*`、`tool_*`、`assistant_message`、`run_completed.output` 表达。
- 首轮生成默认产出 artifact / patch，不直接写源码。
- 写源码必须走 `previewArtifactPatch` -> 用户确认 -> `applyArtifactPatch`。
- 每个 Phase 结束都要有可运行测试或可手动验证路径。

## 1. 追踪总表

| Phase | 状态 | 目标 | 主要产物 | 验收证据 |
|-------|------|------|----------|----------|
| A | completed | DesignBuild Runtime MVP | `telegraph-design-build` runtime | `sendAgent` 可返回 mock artifact |
| B | completed | Artifact 与内部模型定型 | `DesignBuildArtifacts` / projector tests | patch artifact 可被 workbench 识别 |
| C | completed | 组件资产注册与召回 | `ComponentAssetRegistry` | 可召回 `packages/ui` 组件 |
| D | completed-mvp | 首轮真实出码 | brief/context/retrieval/plan/codegen/review | 一句话生成 design patch |
| E | completed | Patch 预览与应用闭环 | apply UX / failure states | 用户确认后可写 workspace |
| F | completed-mvp | Subagents 受控协作 | planner/scout/worker/reviewer | child run 输出可在 parent trace 中看到 |
| G | completed-mvp | 聊天迭代与选中上下文 | artifact revision context | 修改请求能基于已有 artifact |
| H | completed-mvp | 质量门禁与可观测性 | tests / trace / run persistence | 回归命令与 trace 可用 |

## Phase A：DesignBuild Runtime MVP

目标：在 design pagelet 内注册 `telegraph-design-build`，先用确定性 mock artifact 验证链路。

任务：

- [x] 新增 `apps/design/src/application/node/design-build/DesignBuildRuntime.ts`。
- [x] 新增 `DesignBuildOrchestrator.ts`，先返回固定 `design-preview` 或 `design-patch` artifact。
- [x] 在 `DesignPageletWorker` 的 `createAgentHarness` runtimes 中注册 `telegraph-design-build`。
- [x] 将 Design Page 默认 backend 切到 `telegraph-design-build`，保留 settings 覆盖能力。
- [x] 确保 run 事件序列包含 `run_started`、若干 `step_started/step_completed`、`run_completed`。

验收：

- [x] 从空白入口输入任意一句话后，右侧 workbench 出现 mock artifact。
- [x] `run_completed.output.artifact` 可被 `design-agent-projector` 投影。
- [x] 取消按钮能终止 run，并产生 `run_cancelled` 或 failed/cancel 状态。
- [x] patch artifact 的 source 视图按文件分段展示，不再只显示 raw JSON。

建议验证命令：

```bash
pnpm --filter design test
pnpm -r typecheck
```

实际验证（2026-05-21）：

- [x] `pnpm --filter @telegraph/design test`：9 files / 29 tests passed。
- [x] `pnpm --filter @telegraph/design typecheck`：passed。
- [x] `pnpm -r typecheck`：16 workspace projects passed。
- [x] `pnpm --filter @telegraph/extension-telegraph-subagents test`：5 files / 20 tests passed。
- [x] `pnpm --filter @telegraph/extension-telegraph-subagents typecheck`：passed。
- [x] `pnpm --filter @telegraph/agent exec vitest run src/harness/__tests__/AgentHarness.test.ts src/runtime/__tests__/RuntimeConformance.test.ts`：2 files / 9 tests passed。

## Phase B：Artifact 与内部模型定型

目标：明确 DesignBuild 的内部类型和 artifact 输出格式，但不污染 `agent-protocol`。

任务：

- [x] 新增 `DesignBuildArtifacts.ts` / `ComponentAssetRegistry.ts` / `DesignBuildOrchestrator.ts`，定义 `DesignBrief`、`ComponentAsset`、`DesignBuildPlan`、`DesignPatchArtifact`。
- [x] 给 artifact 添加 type guard：`isDesignPatchArtifact`、`isDesignPreviewArtifact`。
- [x] 扩展 `design-artifact-view` 测试，覆盖 `design-patch`、`design-preview`、非法 artifact。
- [x] 保持 artifact 字段 structured-cloneable，避免超大 raw payload。

验收：

- [x] patch artifact 的 `operations` 能被 `extractDesignPatchOperations` 正常读取。
- [x] artifact 无效时 UI 不崩溃，只回退为 JSON/code 视图。

## Phase C：组件资产注册与召回

目标：让 DesignBuild 可以知道当前 repo 有哪些可用组件，而不是纯模型自由发挥。

任务：

- [x] 新增 `ComponentAssetRegistry.ts`。
- [x] 第一版静态注册 `packages/ui` 中常用组件和 import path。
- [x] 增加 workspace 扫描能力：读取 `packages/ui/src/components/ui` 组件文件名。
- [x] 输出 `ComponentAsset[]`：包含 `name`、`importPath`、`category`、`usageHint`、`sourcePath`。
- [x] 新增 `searchComponents(query, constraints)` 方法，返回 top N 组件及选择理由。

验收：

- [x] 输入“做一个登录页”时能召回 button/input/card/form 相关组件。
- [x] 输入“带 tab 的设置页”时能召回 tabs/switch/button 等组件。
- [x] 召回结果进入 trace 的 `step_completed.output` 或 tool result。

## Phase D：首轮真实出码

目标：把一句话生成页面的核心流程跑通。

任务：

- [x] 实现 `Intent Brief` 阶段：生成内部 PRD 与验收标准。
- [x] 实现 `Context Assembly` 阶段：注入 alias、UI 库、artifact policy、当前 project context。
- [x] 实现 `Component Retrieval` 阶段：调用 `ComponentAssetRegistry`。
- [x] 实现 `Page Plan` 阶段：生成 section/component tree/state/mock data/source target。
- [x] 实现 `Code Artifact` 阶段：生成 `design-patch` operations。
- [x] Code Artifact 支持 prompt-aware 模板：dashboard / login / pricing / settings / landing。
- [x] 实现 `Review & Repair` 阶段：MVP 已实现 review pass verdict；repair 分支留到模型驱动 reviewer 产生失败 verdict 时接入。

验收：

- [x] 输入“一句话生成 SaaS dashboard 首页”后，产出至少一个可预览 patch artifact。
- [x] patch 中 import path 使用 `@/` root alias。
- [x] 生成结果不直接写文件。
- [x] trace 中能看到 brief、retrieval、plan、review 阶段。

## Phase E：Patch 预览与应用闭环

目标：把当前 workbench 的 patch preview/apply 能力固化为 design-build 的默认发布路径。

任务：

- [x] 统一 `design-patch` artifact 的按钮文案与状态：预览、确认应用、应用中、已应用、失败。
- [x] apply 前展示 normalized operation 列表和 summary。
- [x] apply 失败时保留 preview 状态，并显示失败原因。
- [x] apply 成功后在 chat 中追加简短结果，不让模型再次“解释”已完成动作。

验收：

- [x] preview 不写文件。
- [x] 用户确认后才调用 `applyArtifactPatch`。
- [x] `expectedOriginal` 不匹配时失败且不覆盖用户改动。

## Phase F：Subagents 受控协作

目标：将 subagents 作为 DesignBuild 的 worker，而不是让它们接管主编排。

任务：

- [x] 增加 DesignBuild 专用 agent profile：`design-product-planner`、`design-component-scout`、`design-worker`、`design-reviewer`。
- [x] 在 parent run 中以 `child_run_started/child_run_completed` 投影 child run。
- [x] 让 `component-scout` 输出 `ComponentAsset[]` 或 retrieval summary。
- [x] 让 `reviewer` 输出 review verdict：`pass` / `repair_required` / `blocked`。
- [x] parent run 汇总 child 输出，并在 `run_completed.output.orchestration.childRuns` 中保留可追踪结果。
- [x] 抽出 `DesignBuildChildRunner`，支持 deterministic fallback 与 model-backed child output 接入。
- [x] `ModelBackedDesignBuildChildRunner` 已接入 `streamPiAiRuntimeEvents`：当 run settings 提供 `provider/modelId/apiKey` 时执行真实模型调用，解析 JSON child output。

验收：

- [x] child run 不直接写 UI 状态。
- [x] child run 结果能在 parent trace 中看到。
- [x] reviewer 要求 repair 时最多触发一轮修复。
- [x] child runner 带模型配置时会调用真实 pi-ai runtime stream，并消费 assistant JSON 输出。

MVP 边界：

- [x] 当前 child run 是 DesignBuild runtime 内的受控 profile 生命周期投影，尚不是模型驱动的外部子运行。
- [x] 已实现受控 reviewer repair 分支：`repair_required` 后最多触发一次 design-worker repair 与一次 reviewer 复核。
- [x] 已抽出 `DesignBuildChildContracts`，child run raw payload 携带 contract version / profile / stage / attempt。
- [x] 后续接真实模型 worker 的工程接口已落地：`ModelBackedDesignBuildChildRunner` 可消费 profile/stage 输出并覆盖 worker artifact。
- [x] 将当前 metadata-driven model output 扩展为真实 LLM 调用；metadata override 仅保留为测试/回放钩子。

## Phase G：聊天迭代与选中上下文

目标：支持用户在首轮 artifact 之后继续修改页面。

任务：

- [x] 在 `DesignWorkspace.runAgent` 的 context 中传入 active artifact 摘要。
- [x] 对修改请求加入 `artifactId`、上一版 operations、用户自然语言 diff。
- [x] 增加 `selectedComponent` context 占位，先不接真实 preview DOM。
- [x] 输出新的 revision artifact：`parentArtifactId`、`revision`、`changeSummary`。
- [x] 增加 workbench Inspector 框架：patch operation 可选中为 component target，并进入下一轮 run context。
- [x] 将 `DesignSelectedComponentSnapshot` 提升到 design common contract，便于外部 preview/组件编辑接入。
- [x] DesignBuild runtime 消费 `selectedComponent`，将组件级目标写入 brief 与 revision `changeSummary`。

验收：

- [x] 用户说“把主按钮改成绿色并增加 pricing 区块”时，生成基于上一版的 patch。
- [x] 多轮修改不会丢失当前 artifact id。
- [x] 右侧 workbench 能切换不同 artifact / revision。
- [x] 选中 patch target 后，用户追问会携带 `selectedComponent` 上下文。

MVP 边界：

- [x] revision 信息已在 artifact 列表与头部展示，选中后会进入后续 run context。
- [x] 组件编辑接入框架已完成：当前以 patch operation target 作为可追踪选择源。
- [ ] 真实 preview DOM 选中与组件属性编辑仍按 D-016 边界留给后续外部项目接入。

## Phase H：质量门禁与可观测性

目标：让 DesignBuild 可以作为长期能力维护。

任务：

- [x] 给 DesignBuild runtime 加单元测试：事件序列、取消、失败、artifact 投影。
- [x] 给 ComponentAssetRegistry 加单元测试：静态注册、扫描、召回。
- [x] 给 DesignWorkspace 加集成测试：首轮 run -> artifact -> preview/apply。
- [x] 增加 trace raw payload 大小保护，避免把完整大文件放进单事件 raw。
- [x] 增加 failure taxonomy：`brief_failed`、`retrieval_failed`、`codegen_failed`、`review_failed`、`patch_invalid`。
- [x] 在 DesignWorkspace 中投影 step / child run trace timeline，便于追踪 parent run 编排。
- [x] 增加 `DesignBuildValidation`，对 artifact/review 做结构校验，并在可修复 alias 错误时自动 repair。
- [x] 增加 pagelet-local `DesignRunStore`，持久化 run、事件摘要、状态、错误，并通过 design service 暴露 list/get。

验收：

- [x] `pnpm --filter design test` 通过。
- [x] `pnpm -r typecheck` 通过。
- [x] 一次失败 run 能从 trace 定位失败阶段。
- [x] parent step 与 child run 结果能在工作区 trace timeline 中看到。
- [x] run history 可通过 `listAgentRuns` / `getAgentRun` 查询。

实际验证（2026-05-21，Phase F/G/H 收敛）：

- [x] `pnpm --filter @telegraph/design test`：9 files / 29 tests passed。
- [x] `pnpm --filter @telegraph/design typecheck`：passed。
- [x] `pnpm --filter @telegraph/extension-telegraph-subagents test`：5 files / 20 tests passed。
- [x] `pnpm --filter @telegraph/extension-telegraph-subagents typecheck`：passed。
- [x] `pnpm -r typecheck`：16 workspace projects passed。
- [x] `git diff --check -- apps/design extensions/telegraph-subagents packages/agent codebase-wiki/roadmap/20260521-design-page-agent-generation-implementation-plan.md`：passed。

实际验证（2026-05-21，repair 分支）：

- [x] `pnpm --filter @telegraph/design test`：9 files / 30 tests passed。
- [x] `pnpm --filter @telegraph/design typecheck`：passed。

实际验证（2026-05-21，trace timeline）：

- [x] `pnpm --filter @telegraph/design test`：9 files / 30 tests passed。
- [x] `pnpm --filter @telegraph/design typecheck`：passed。
- [x] `pnpm --filter @telegraph/main dev` + `curl -I http://127.0.0.1:5173/`：renderer dev server HTTP 200。
- [x] 当前会话未暴露 Browser 插件所需的 Node 浏览器控制工具，未做交互式浏览器截图验证。

最终回归（2026-05-21）：

- [x] `pnpm -r typecheck`：16 workspace projects passed。
- [x] `pnpm --filter @telegraph/extension-telegraph-subagents test`：5 files / 20 tests passed。
- [x] `pnpm --filter @telegraph/agent exec vitest run src/harness/__tests__/AgentHarness.test.ts src/runtime/__tests__/RuntimeConformance.test.ts`：2 files / 9 tests passed。
- [x] `git diff --check -- apps/design extensions/telegraph-subagents packages/agent codebase-wiki/roadmap/20260521-design-page-agent-generation-implementation-plan.md`：passed。

实际验证（2026-05-21，component inspector framework）：

- [x] `pnpm --filter @telegraph/design test`：9 files / 30 tests passed。
- [x] `pnpm --filter @telegraph/design typecheck`：passed。

实际验证（2026-05-21，prompt-aware artifact templates + selected component contract）：

- [x] `pnpm --filter @telegraph/design test`：9 files / 31 tests passed。
- [x] `pnpm --filter @telegraph/design typecheck`：passed。
- [x] `pnpm --filter @telegraph/design lint`：passed。
- [x] `pnpm -r typecheck`：16 workspace projects passed。
- [x] `pnpm --filter @telegraph/extension-telegraph-subagents test`：5 files / 20 tests passed。
- [x] `pnpm --filter @telegraph/agent exec vitest run src/harness/__tests__/AgentHarness.test.ts src/runtime/__tests__/RuntimeConformance.test.ts`：2 files / 9 tests passed。
- [x] `git diff --check -- apps/design extensions/telegraph-subagents packages/agent codebase-wiki/roadmap/20260521-design-page-agent-generation-implementation-plan.md`：passed。

实际验证（2026-05-21，patch source view）：

- [x] `pnpm --filter @telegraph/design test`：9 files / 31 tests passed。
- [x] `pnpm --filter @telegraph/design typecheck`：passed。
- [x] `pnpm --filter @telegraph/design lint`：passed。

实际验证（2026-05-21，child-run contract）：

- [x] `pnpm --filter @telegraph/design test`：9 files / 31 tests passed。
- [x] `pnpm --filter @telegraph/design typecheck`：passed。
- [x] `pnpm --filter @telegraph/design lint`：passed。

实际验证（2026-05-21，model child runner + schema validation + run persistence）：

- [x] `pnpm --filter @telegraph/design test`：12 files / 38 tests passed。
- [x] `pnpm --filter @telegraph/design typecheck`：passed。
- [x] `pnpm --filter @telegraph/design lint`：passed。
- [x] `pnpm -r typecheck`：16 workspace projects passed。
- [x] `pnpm --filter @telegraph/extension-telegraph-subagents test`：5 files / 20 tests passed。
- [x] `pnpm --filter @telegraph/agent exec vitest run src/harness/__tests__/AgentHarness.test.ts src/runtime/__tests__/RuntimeConformance.test.ts`：2 files / 9 tests passed。
- [x] `git diff --check -- apps/design extensions/telegraph-subagents packages/agent codebase-wiki/roadmap/20260521-design-page-agent-generation-implementation-plan.md`：passed。

实际验证（2026-05-21，real model-backed child runner）：

- [x] `pnpm --filter @telegraph/design exec vitest run src/application/node/design-build/__tests__/DesignBuildChildRunner.test.ts src/application/node/design-build/__tests__/DesignBuildChildRunner.model.test.ts`：2 files / 3 tests passed。
- [x] `pnpm --filter @telegraph/design typecheck`：passed。
- [x] `pnpm --filter @telegraph/design lint`：passed。
- [x] `pnpm --filter @telegraph/design test`：13 files / 39 tests passed。

## 第一批 PR 建议

建议先拆成三步，避免一次性实现过大：

1. **PR-1：Runtime MVP + mock artifact**
   - 只新增 `telegraph-design-build` runtime 与 mock artifact。
   - 验证 UI、RPC、投影、取消链路。

2. **PR-2：Artifact model + ComponentAssetRegistry**
   - 固定 artifact shape。
   - 建立组件资产召回最小实现。
   - 加测试。

3. **PR-3：真实首轮出码**
   - 接入 brief/context/retrieval/plan/codegen/review。
   - 先产出 patch artifact，不直接写文件。

## 风险与控制

| 风险 | 控制策略 |
|------|----------|
| 过早做通用 workflow DSL | DesignBuild 内部阶段固定，不上升到 agent-protocol |
| 模型自由生成不可用组件 | ComponentAssetRegistry 约束 import 和 usage |
| 首轮直接写坏源码 | 默认只产出 patch artifact，用户确认后应用 |
| subagents 编排失控 | parent run 固定阶段，child run 只输出受控结果 |
| trace payload 过大 | raw 只放摘要，大内容走 artifact / file path |
| UI 与 runtime 耦合 | UI 只识别 artifact，不识别内部 orchestration state |

## 当前下一步

- [x] 开始 Phase A：实现 `telegraph-design-build` runtime MVP。
- [x] Phase A 完成后更新本文状态表。
- [x] 每个 Phase 完成后在本文勾选任务，并补充验证命令结果。
