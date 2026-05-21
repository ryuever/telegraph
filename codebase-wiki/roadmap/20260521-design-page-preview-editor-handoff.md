---
id: P-009
title: Design Page Preview 与组件编辑器接入 Handoff
description: >
  基于 Design Page 已新增 Sandpacker preview、editor service 与 style editor 依赖后的当前工程状态，
  梳理下一阶段要完成的接线、数据契约、测试与验收清单，确保 preview、组件选中、属性编辑和 DesignBuild agent 迭代闭环可追踪落地。
category: roadmap
created: 2026-05-21
updated: 2026-05-21
tags:
  - design-page
  - preview
  - component-editor
  - sandpacker
  - handoff
status: wip
references:
  - id: P-008
    rel: extends
    file: ./20260521-design-page-agent-generation-implementation-plan.md
  - id: D-016
    rel: derived-from
    file: ../discussion/20260521-design-page-agent-generation-product-architecture.md
  - id: I-005
    rel: derives
    file: ../issue/20260521-design-page-preview-sandpacker-stabilization.md
---

# Design Page Preview 与组件编辑器接入 Handoff

> 本文交接 Design Page 在“真实模型出码”之后的下一段工程工作：
> preview 与组件编辑器依赖已经接入，下一步要把它们从可渲染组件推进为可选中、可编辑、可追踪、可回写 agent context 的闭环。

## 当前状态

- `apps/design/package.json` 已接入 `@sandpacker/core`、`@sandpacker/worker`、`@sandpacker/shared`、`@sandpacker/editor-service`、`@sandpacker/style-editor`。
- `packages/ui/src/styles/globals.css` 已为 `@sandpacker/style-editor/dist` 增加 Tailwind source。
- `apps/design/src/application/browser/DesignSandpackerPreview.tsx` 已具备 Sandpacker service worker 注册、worker backend、iframe preview、file tree、`StyleEditorPanel`、Telegraph UI import stub、file-to-operation 回写能力。
- `apps/design/src/application/browser/DesignArtifactWorkbench.tsx` 已在 patch artifact preview mode 中嵌入 `DesignSandpackerPreview`，并通过 `onPatchOperationsChange` 向外传递更新后的 patch operations。
- 当前 `ComponentInspector` 仍主要基于 patch operation target 展示结构化选择；真实 iframe DOM element selection 尚未完整映射成 `DesignSelectedComponentSnapshot`。

## 下一阶段目标

将 preview/editor 从“组件已接入”推进到“DesignBuild 闭环可用”：

1. Sandpacker preview 能稳定渲染模型生成的 patch source。
2. 用户点击 iframe 中的元素后，能得到稳定的 component selection snapshot。
3. Style editor 或属性面板的修改能转成 patch operations，并在 workbench 中形成 dirty state。
4. 用户可确认应用修改，也可把选中组件和局部 diff 带入下一轮 agent run。
5. 所有状态都能在 run history / artifact revision / trace 中被解释。

## 需要优先补齐的工程任务

### 1. Preview 运行态加固

- [ ] 明确 Sandpacker service worker 在 Electron renderer dev / packaged 两种环境下的 scope 与加载路径。
- [ ] 给 `DesignSandpackerPreview` 增加非 service-worker fallback 或清晰失败态，避免 preview 整体空白。
- [ ] 收敛 iframe sandbox 策略：允许 preview 必需能力，但不要给不必要的 host 权限。
- [ ] 增加 preview reload / compile error / runtime error 的用户可见状态。
- [ ] 限制单个 artifact 注入到 Sandpacker 的文件数量与 source size，避免大 payload 卡住 renderer。

验收：

- [ ] dashboard / login / pricing / settings / landing 五类模板都能预览。
- [ ] 语法错误时 preview 显示错误文件、行列、frame。
- [ ] 切换 artifact 不残留上一个 artifact 的 iframe、files、selected element。

### 2. 组件选中事件打通

- [ ] 从 `useSandpacker({ workspaceId })` 暴露的 `selectedElement` 中提取稳定字段，映射为 `DesignSelectedComponentSnapshot`。
- [ ] 设计 `source: 'preview-dom'` 的 snapshot shape：至少包含 `artifactId`、`label`、`path`、`elementTag`、`className`、可选 source location。
- [ ] 在 `DesignSandpackerPreview` 中新增 `onSelectComponent` callback，而不是只把 selection 投给 `editorService.receiveElementSelection`。
- [ ] 让 Workbench 的 `selectedComponent` 同时支持 `patch-operation` 与 `preview-dom` 两种来源。
- [ ] 选中元素后自动进入或刷新 Inspect 面板，但不要打断 preview 操作。

验收：

- [ ] iframe 中点击按钮、卡片、输入框都能更新右侧 Inspector。
- [ ] selected component 会进入下一轮 `DesignWorkspace.runAgent` 的 `designContext.selectedComponent`。
- [ ] 切换 artifact 后不误用旧 artifact 的 selected component。

### 3. 组件属性编辑数据契约

- [ ] 定义组件编辑器的最小字段模型：text、className、style token、spacing、color、visibility、variant。
- [ ] 明确哪些修改由 `StyleEditorPanel` 直接修改 source，哪些由 Telegraph 自己的 Inspector form 修改 source。
- [ ] 建立 `ComponentEditPatch` 内部类型，把属性变化转换为 `DesignPatchFileOperation[]`。
- [ ] 给 edited operations 增加 dirty tracking：未确认应用、已预览、已应用、失败。
- [ ] 处理冲突：当 source 已被用户手改或 agent 新 revision 覆盖时，编辑器需要重新绑定 selection。

验收：

- [ ] 修改选中组件文字或 className 后，source code 和 preview 同步变化。
- [ ] 修改结果能出现在 `onPatchOperationsChange` 回写后的 artifact operations 中。
- [ ] 用户确认应用时走现有 `previewArtifactPatch` / `applyArtifactPatch`，不直接写文件。

### 4. Agent 迭代闭环

- [ ] 下一轮 prompt 需要携带 active artifact、selected component、edited operations summary、dirty state。
- [ ] `DesignBuildRuntime` 的 revision context 应区分“用户自然语言修改”和“组件编辑器产生的局部修改”。
- [ ] worker child 的 `modelInput` 中加入 selected component DOM/source context，避免模型只看到文件级 patch。
- [ ] reviewer 增加 component-edit 检查：修改是否仍指向同一 artifact、是否破坏 alias、是否产生空 patch。
- [ ] run completed 后生成新的 revision artifact，而不是覆盖原 artifact。

验收：

- [ ] 用户先点中一个按钮，再说“改成绿色并放大”，模型只修改相关组件。
- [ ] 已通过组件编辑器改过的 source 能作为下一轮 agent 的 base。
- [ ] trace 中能看出这次 run 是基于 selected component / edited operations 触发的。

### 5. 测试与验证

- [ ] 为 `DesignSandpackerPreview` 增加文件转换单测：Telegraph UI import normalize / restore、operation update、artifact switch。
- [ ] 为 `DesignArtifactWorkbench` 增加 preview-dom selection mock 测试。
- [ ] 为 `DesignWorkspace` 增加 edited operations 进入下一轮 run context 的测试。
- [ ] 增加一个失败路径测试：Sandpacker compile error 不影响 code/inspect tab。
- [ ] 用浏览器自动化或手动 checklist 验证 iframe 非空、点击可选中、style editor 可更新。

建议回归命令：

```bash
pnpm --filter @telegraph/design test
pnpm --filter @telegraph/design typecheck
pnpm --filter @telegraph/design lint
pnpm -r typecheck
```

## 建议实施顺序

1. **Preview hardening**：先把 service worker、artifact switch、错误态和 source size guard 做稳。
2. **Selection bridge**：把 iframe `selectedElement` 转成 `DesignSelectedComponentSnapshot`，打通 Workbench / Workspace context。
3. **Edit-to-patch**：把 StyleEditorPanel 或 Inspector form 产生的变更稳定回写到 operations。
4. **Agent revision loop**：让 selected component 与 edited operations 进入真实模型 child runner 的 `modelInput`。
5. **Browser verification**：最后用真实 dev server + browser 走一遍生成、预览、选中、编辑、追问、应用。

## 当前风险点

| 风险 | 影响 | 建议控制 |
|------|------|----------|
| Sandpacker service worker 在 Electron packaged 路径下不可用 | preview 空白或无法启动 worker | 尽早做 packaged smoke test，必要时做 fallback |
| preview-dom selection 缺少 source location | 编辑器不知道改哪个文件/哪段代码 | selection snapshot 先存 DOM 信息，再逐步接 source map / AST 定位 |
| Style editor 直接改 file tree 但 artifact 未同步 | 用户看到变更但 apply 仍用旧 patch | 以 `onPatchOperationsChange` 为唯一 source-of-truth 回写口 |
| 模型下一轮只看到 artifact summary | 组件级修改不精准 | worker `modelInput` 必须包含 selected component 与 edited operation context |
| iframe 权限过宽 | Electron renderer 安全面扩大 | 默认最小 sandbox，按 Sandpacker 必要能力逐项开放 |

## Handoff 判定

下一位接手者可以从以下文件开始：

- `apps/design/src/application/browser/DesignSandpackerPreview.tsx`
- `apps/design/src/application/browser/DesignArtifactWorkbench.tsx`
- `apps/design/src/application/browser/DesignWorkspace.tsx`
- `apps/design/src/application/common/index.ts`
- `apps/design/src/application/node/design-build/DesignBuildRuntime.ts`
- `apps/design/src/application/node/design-build/DesignBuildChildRunner.ts`

第一天建议只完成两件事：preview runtime hardening，以及 `selectedElement -> DesignSelectedComponentSnapshot` 的桥接。完成这两件事后，组件属性编辑和 agent 迭代才有稳定锚点。
