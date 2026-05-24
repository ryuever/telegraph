---
id: P-009
title: Design Page Preview 与组件编辑器接入 Handoff
description: >
  基于 Design Page 已新增 Sandpacker preview、editor service 与 style editor 依赖后的当前工程状态，
  梳理下一阶段要完成的接线、数据契约、测试与验收清单，确保 preview、组件选中、属性编辑和 DesignBuild agent 迭代闭环可追踪落地。
category: roadmap
created: 2026-05-21
updated: 2026-05-24
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
  - id: P-011
    rel: extended-by
    file: ./20260524-design-page-shadcn-design-system-roadmap.md
---

# Design Page Preview 与组件编辑器接入 Handoff

> 本文交接 Design Page 在“真实模型出码”之后的下一段工程工作：
> preview 与组件编辑器依赖已经接入，下一步要把它们从可渲染组件推进为可选中、可编辑、可追踪、可回写 agent context 的闭环。

## 当前状态

- `apps/design/package.json` 已接入 `@sandpacker/core`、`@sandpacker/worker`、`@sandpacker/shared`、`@sandpacker/editor-service`、`@sandpacker/style-editor`。
- `apps/design/package.json` 已接入 `@tailwindcss/browser`，preview HTML 不再依赖 `https://cdn.tailwindcss.com`，避免生产 CDN warning。
- `packages/ui/src/styles/globals.css` 已为 `@sandpacker/style-editor/dist` 增加 Tailwind source。
- `apps/design/src/application/browser/DesignSandpackerPreview.tsx` 已具备 Sandpacker service worker 注册、worker backend、iframe preview、file tree、`StyleEditorPanel`、Telegraph UI import stub、standalone generated project root remap、file-to-operation 回写能力。
- `apps/design/src/application/browser/DesignArtifactWorkbench.tsx` 已在 patch artifact preview mode 中嵌入 `DesignSandpackerPreview`，并通过 `onPatchOperationsChange` 向外传递更新后的 patch operations。
- `DesignSandpackerPreview` 已将 Sandpacker `selectedElement` 映射为 `source: 'preview-dom'` 的 `DesignSelectedComponentSnapshot` 并回调 Workbench；真实浏览器点击链路仍需要 smoke test 覆盖。
- `apps/main/vite.renderer.config.ts` 已为 Sandpacker renderer graph 增加 `util` browser stub、`buffer` browser polyfill alias 以及常用 Node/browser polyfill 预优化，避免 dev 运行中触发 Vite optimize-deps missing chunk。

## 下一阶段目标

将 preview/editor 从“组件已接入”推进到“DesignBuild 闭环可用”：

1. Sandpacker preview 能稳定渲染模型生成的 patch source。
2. 用户点击 iframe 中的元素后，能得到稳定的 component selection snapshot。
3. Style editor 或属性面板的修改能转成 patch operations，并在 workbench 中形成 dirty state。
4. 用户可确认应用修改，也可把选中组件和局部 diff 带入下一轮 agent run。
5. 所有状态都能在 run history / artifact revision / trace 中被解释。

## 需要优先补齐的工程任务

### 1. Preview 运行态加固

- [x] 明确 Sandpacker service worker 在 Electron renderer dev 下的 scope 与加载路径：dev 走 `/sandpacker-worker.js`，scope 为 `/`，请求按 `/<busId>/vite/<workspaceId>/...` 分流。
- [ ] 验证 Sandpacker service worker 在 packaged Electron 环境下的加载路径与 scope。
- [x] 给 `DesignSandpackerPreview` 增加清晰失败态：service worker 不可用或注册失败时显示错误面板，code / inspect tab 仍可用。
- [x] 收敛 iframe sandbox 策略：Sandpacker preview 不再设置 `sandbox`，避免 `allow-scripts + allow-same-origin` 的无效安全组合；纯 HTML preview 仍保留 `sandbox=""`。
- [x] 增加 preview reload / compile error / runtime error 的用户可见状态。
- [x] 限制单个 artifact 注入到 Sandpacker 的文件数量与 source size，避免大 payload 卡住 renderer。
- [x] 将 generated standalone project folder remap 到 Sandpacker root，避免 `/src/index.tsx?entry` 逃逸或 nested project 无法启动。

验收：

- [ ] dashboard / login / pricing / settings / landing 五类模板真实 dev server smoke test。
- [x] 语法错误时 preview 显示错误文件、行列、frame。
- [ ] 切换 artifact 不残留上一个 artifact 的 iframe、files、selected element。

### 2. 组件选中事件打通

- [x] 从 `useSandpacker({ workspaceId })` 暴露的 `selectedElement` 中提取稳定字段，映射为 `DesignSelectedComponentSnapshot`。
- [x] 设计 `source: 'preview-dom'` 的 snapshot shape：至少包含 `artifactId`、`label`、`path`、`elementTag`、`className`、可选 source location。
- [x] 在 `DesignSandpackerPreview` 中新增 `onSelectComponent` callback，而不是只把 selection 投给 `editorService.receiveElementSelection`。
- [x] 让 Workbench 的 `selectedComponent` 同时支持 `patch-operation` 与 `preview-dom` 两种来源。
- [ ] 选中元素后自动进入或刷新 Inspect 面板，但不要打断 preview 操作。

验收：

- [ ] iframe 中点击按钮、卡片、输入框都能更新右侧 Inspector（需真实浏览器 smoke test）。
- [x] selected component 会进入下一轮 `DesignWorkspace.runAgent` 的 `designContext.selectedComponent`。
- [x] 切换 artifact 后不误用旧 artifact 的 selected component：`DesignSandpackerPreview` 在 artifact 切换时 reset editor service 与 last emitted selection。

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

- [ ] 下一轮 prompt 需要携带 active artifact、selected component、edited operations summary、dirty state。（active artifact、selected component、edited operations summary 已完成；dirty state 待补。）
- [ ] `DesignBuildRuntime` 的 revision context 应区分“用户自然语言修改”和“组件编辑器产生的局部修改”。
- [ ] worker child 的 `modelInput` 中加入 selected component DOM/source context，避免模型只看到文件级 patch。
- [ ] reviewer 增加 component-edit 检查：修改是否仍指向同一 artifact、是否破坏 alias、是否产生空 patch。
- [ ] run completed 后生成新的 revision artifact，而不是覆盖原 artifact。

验收：

- [ ] 用户先点中一个按钮，再说“改成绿色并放大”，模型只修改相关组件。
- [x] 已通过组件编辑器改过的 source 能作为下一轮 agent 的 base metadata：`activeArtifact.operationSummaries` 会进入 `DesignBuildRuntime` revision context。
- [ ] trace 中能看出这次 run 是基于 selected component / edited operations 触发的。

### 5. 测试与验证

- [x] 为 `DesignSandpackerPreview` 增加文件转换单测：entry path、standalone project root remap、Tailwind browser runtime、Telegraph UI import normalize / restore。
- [x] 为 `DesignArtifactWorkbench` 增加 preview-dom selection mock 测试。
- [x] 为 `DesignWorkspace` 增加 edited operations 进入下一轮 run context 的测试。
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

1. **Browser verification**：先用真实 dev server + Electron/Chrome 走一遍生成、预览、选中、编辑、追问、应用，确认 no missing optimize chunk / no sandbox warning / iframe 非空。
2. **Packaged preview smoke**：验证 packaged Electron 下 service worker URL、scope、worker entry 与 Tailwind browser runtime asset 都可加载。
3. **Edit-to-patch**：把 StyleEditorPanel 或 Inspector form 产生的变更稳定回写到 operations，并明确 dirty state。
4. **Agent revision loop**：补 dirty state、component-edit 区分字段，以及 reviewer 对局部编辑的检查。
5. **Failure-path tests**：补 compile error、artifact switch 的回归测试。

## 当前风险点

| 风险 | 影响 | 建议控制 |
|------|------|----------|
| Sandpacker service worker 在 Electron packaged 路径下不可用 | preview 空白或无法启动 worker | 尽早做 packaged smoke test，必要时做 fallback |
| Sandpacker preview iframe 不再 sandbox | 生成代码与宿主同源，安全边界依赖 artifact source trust 与 Electron renderer 策略 | 后续若需要强隔离，应迁到独立 origin / BrowserView / isolated session，而不是恢复 `allow-scripts + allow-same-origin` |
| preview-dom selection source location 仍依赖 Sandpacker selection payload | 编辑器可能不知道精确 AST edit range | selection snapshot 先存 DOM 信息，再逐步接 source map / AST 定位 |
| Style editor 直接改 file tree 但 artifact 未同步 | 用户看到变更但 apply 仍用旧 patch | 以 `onPatchOperationsChange` 为唯一 source-of-truth 回写口 |
| 模型下一轮只看到 artifact summary | 组件级修改不精准 | 已加入 selected component 与 edited operation summary；下一步补 dirty state 与 component-edit 来源标记 |
| Vite optimize-deps 运行中重写 `.vite/deps` | 旧 iframe 请求旧 chunk hash，shell 出现 missing chunk | 维护 `optimizeDeps.include` 预热列表；变更 alias/polyfill 后重启 dev server |

## Handoff 判定

下一位接手者可以从以下文件开始：

- `apps/design/src/application/browser/DesignSandpackerPreview.tsx`
- `apps/design/src/application/browser/DesignArtifactWorkbench.tsx`
- `apps/design/src/application/browser/DesignWorkspace.tsx`
- `apps/design/src/application/common/index.ts`
- `apps/design/src/application/node/design-build/DesignBuildRuntime.ts`
- `apps/design/src/application/node/design-build/DesignBuildChildRunner.ts`

下一步建议只完成两件事：真实 dev / packaged preview smoke test，以及 dirty state / component-edit 来源标记。完成这两件事后，再推进组件属性编辑和 reviewer 检查。
