---
id: I-005
title: Design Page Preview 与 Sandpacker 稳定化问题串复盘
description: >
  归档 2026-05-21 Design Page 从一句话出码到 iframe preview 可运行过程中连续暴露的问题：
  页面状态跳转、会话消息 pending、DesignBuild JSON 输出、Sandpacker 依赖预构建、service worker
  scope、entry 请求、JSX tagger、CDN 绕行以及 UI stub 缺失等。
category: issue
created: 2026-05-21
updated: 2026-05-24
tags:
  - design-page
  - preview
  - sandpacker
  - service-worker
  - iframe
  - design-build
  - vite
status: wip
references:
  - id: P-009
    rel: derived-from
    file: ../roadmap/20260521-design-page-preview-editor-handoff.md
  - id: I-006
    rel: related-to
    file: ./20260522-design-build-child-structured-output-contract.md
  - id: A-014
    rel: related-to
    file: ../architecture/20260524-design-build-standalone-project-output-contract.md
---

# Design Page Preview 与 Sandpacker 稳定化问题串复盘

> 本文归档本轮 session 中 Design Page 从“能生成 artifact”推进到“iframe preview 可运行”时遇到的一串问题。
> 这些问题不是单点 bug，而是模型生成代码、Sandpacker bundler、Electron renderer Vite dev server、service worker 和本地 UI stub 之间的边界连续暴露。

## 背景

Design Page 当前目标是让用户输入自然语言后，模型产出页面代码 artifact，右侧 workbench 通过 Sandpacker iframe preview 渲染，同时保留 source / style editor / 后续组件选中编辑能力。

本轮故障集中发生在以下链路：

```text
DesignWorkspace prompt
  -> telegraph-design-build runtime
  -> patch artifact / generated TSX
  -> DesignArtifactWorkbench
  -> DesignSandpackerPreview
  -> Sandpacker service worker + iframe preview
```

相关路线图见 [P-009 Design Page Preview 与组件编辑器接入 Handoff](../roadmap/20260521-design-page-preview-editor-handoff.md)。

## Issue 总表

| 序号 | 用户可见现象 | 根因类型 | 已落地修复 |
|---|---|---|---|
| 1 | 生成结束后经常跳回 `design page` 页面 | active page 状态未跨 reload / run 完成保持 | `04d463a fix: preserve active page across reloads` |
| 2 | 会话消息一直 pending | assistant message settle 逻辑未完整收敛 | `e36966c fix: settle design assistant message status` |
| 3 | `Model child output did not contain a JSON object.` | DesignBuild child output 对非 JSON 文本过于脆弱 | `dd6d56e fix: recover from non-json design child output` |
| 4 | 生成的登录页 HTML 在会话框返回，但 preview 仍显示“等待第一个 artifact” | artifact 投影与 preview artifact 识别链路未稳定 | 已在 DesignBuild artifact / workbench 链路中继续加固 |
| 5 | `@jridgewell/resolve-uri` / `picomatch` / `acorn-class-fields` default export 报错 | Sandpacker 运行态直接吃到 CJS / UMD 依赖，ESM export 形态不匹配 | `4c36f4a`、`21f2b45`、`4b5b072` |
| 6 | `esbuild-wasm/lib/browser.js` 不提供 `initialize` export | esbuild wasm browser entry 未按 Sandpacker 期望预构建 | `9aab288 fix: prebundle esbuild wasm browser entry` |
| 7 | `http://localhost:5173/src/index.tsx?entry` 404 | iframe preview entry 请求逃逸到 Telegraph renderer dev server 根路径 | `8f08451 fix: keep sandpacker entry requests scoped` |
| 8 | scoped Vite 文件请求返回 `502 BAD GATEWAY (from service worker)` | Sandpacker service worker 对本地 scoped 请求代理边界不清 | `7465403`、`8f08451`、后续 scope 修正 |
| 9 | `Expected ">" but found "data"` | Sandpacker JSX tagger 用 regex 扫 `<...>`，把 TypeScript generic / type syntax 误判为 JSX tag | 已在 sandpacker 源码中升级为 plugin-level TSX AST transform |
| 10 | `Failed to fetch`，`https://esm.sh/scheduler... net::ERR_FAILED` | service worker 拦截了 CDN 请求，导致外部 ESM 拉取失败 | `fe61f93 fix: let sandpacker cdn requests bypass service worker` |
| 11 | `Textarea is not defined` | 生成页使用 shadcn `Textarea`，sandbox UI stub 未导出且 generated source 未显式 import | `9a3cfb9 fix: stub textarea in sandpacker preview`；后续策略改为只 normalize 明确 import，不再猜测裸 JSX |
| 12 | 首次启动出现 `Module "util"/"buffer" has been externalized` warning | Sandpacker renderer graph 中 Node builtin 被 Vite 当作 browser external，依赖访问 `util.inspect/debuglog` 或 `Buffer` 时触发 warning | `8c47362 fix: quiet sandpacker preview startup warnings`：`util` 走本地 browser stub，`buffer` 走 browser polyfill |
| 13 | DevTools 出现 `cdn.tailwindcss.com should not be used in production` | preview HTML 注入旧 Tailwind CDN runtime | `8c47362`：改用打包进 renderer 的 `@tailwindcss/browser?url` |
| 14 | 去掉 `allow-same-origin` 后 Vite HMR / entry script 被 CORS 拦截，origin 变 `null` | Sandboxed iframe 没有 same-origin 权限时变为 opaque origin，无法加载同源 Vite dev assets | 已回滚该方向；当前 Sandpacker preview 不设置 `sandbox`，纯 HTML preview 仍保留 `sandbox=""` |
| 15 | shell 出现 `.vite/deps/chunk-*.js` missing，提示 optimize deps changed | dev server 运行中二次 optimize 重写 `.vite/deps`，旧 iframe 仍请求旧 hash | `8c47362` 后续加固：把 Sandpacker browser polyfill 依赖链放入 `optimizeDeps.include` 预热列表 |

## 根因分层

### 1. Preview 不是普通 React render，而是隔离 bundler 运行态

Sandpacker preview 在 iframe + service worker + bundler backend 里运行。它看到的模块图不是 Telegraph renderer bundle 的模块图，因此不能默认复用宿主侧的 alias、依赖预构建、UI 组件导出和 Vite dev server 路径。

本轮多个问题都来自这个误差：

- 宿主里可用的 `@/packages/ui/...`，preview 里需要转成 `/src/telegraph-ui.tsx` stub。
- 宿主 Vite dev server 端口是 `5173`，preview 的 entry 请求必须留在 artifact scoped path 下，不能落到根 `/src/index.tsx?entry`。
- 宿主依赖解析能兼容的 CJS / UMD 包，preview ESM bundler 不一定能默认兼容。

### 2. Service worker scope 必须非常窄

Sandpacker worker 需要接管 preview 内部请求，但不能接管所有 `localhost:5173` 请求，更不能拦截 `https://esm.sh/...` 这类 CDN 请求。否则会出现两类症状：

- 本地 scoped 文件请求被错误代理，返回 502。
- 外部 CDN 请求被 worker 接住后 fetch 失败。

当前修复方向是：Telegraph 自己的 scoped preview 请求留给 Sandpacker，CDN 请求直接 bypass service worker。

### 3. 生成代码需要一个“安全的 UI stub 层”

模型生成页面时会自然使用 shadcn 风格组件，例如 `Button`、`Input`、`Textarea`、`Card`、`Tabs`。preview 不能直接依赖真实 `packages/ui`，否则会把 Tailwind、Radix、alias 与 monorepo 边界全部拉进 sandbox。

因此当前需要维护一个小而稳定的 `/src/telegraph-ui.tsx`：

- 只包含 preview 必需的轻量组件。
- 允许正常 TypeScript / TSX 类型语法；不能通过删除 generic、type alias、`ComponentProps<'button'>` 等语法来规避问题。
- Sandpacker selection tagger 必须在 Vite plugin transform 阶段支持 TypeScript/TSX AST，只处理真实 `JSXOpeningElement`，不能把 `Record<string>`、`ComponentProps<'button'>`、`Box<T>` 这类 TypeScript 语法当成 JSX。
- 对已知 UI 组件只 normalize 明确 import，不再猜测裸 JSX。这样可以避免把真实项目依赖关系静默改写；模型漏 import 应由 codegen / validation 阶段暴露。

`Textarea is not defined` 就属于这个层的问题：生成代码运行起来了，但缺少运行时组件绑定。

## 已落地变更清单

### 状态与消息层

- `04d463a fix: preserve active page across reloads`
  - 保持生成结束后仍停留在当前 design workspace，而不是跳回初始 design page。
- `e36966c fix: settle design assistant message status`
  - 修复会话消息长期 pending。
- `dd6d56e fix: recover from non-json design child output`
  - 处理 child model 输出不是严格 JSON object 时的降级恢复。
- `fd8df93 fix: keep design runs on build runtime`
  - 确保 Design Page 使用 `telegraph-design-build` runtime。

### 视觉与会话渲染

- `11c4981 style: refresh application design language`
  - 切到更干净、轻量、带一点可爱气息的应用设计语言。
- `3e68477 style: improve markdown message rendering`
  - 重新调整会话 message 与 markdown 渲染。

### Sandpacker 依赖与入口

- `4c36f4a fix: force resolve-uri esm in renderer`
- `21f2b45 fix: shim picomatch for renderer vite`
- `4b5b072 fix: prebundle sandpacker cjs dependencies`
- `9aab288 fix: prebundle esbuild wasm browser entry`

这些提交统一处理 Sandpacker bundler 运行时遇到的 CJS / UMD / browser entry export 不匹配。

### iframe / service worker / scoped path

- `7465403 fix: align sandpacker preview service worker setup`
- `8f08451 fix: keep sandpacker entry requests scoped`
- `fe61f93 fix: let sandpacker cdn requests bypass service worker`

这些提交把 preview 拉回 iframe + scoped Sandpacker path 模型，并避免请求逃逸到 Telegraph renderer 根路径或被 service worker 误拦截。

### UI stub 与 JSX tagger

- `00b207b fix: avoid sandpacker ui stub tagger corruption`
- `406b93e fix: make sandpacker ui stub tagger-safe`
- `9a3cfb9 fix: stub textarea in sandpacker preview`
- 当前未提交变更：直接修改 `/Users/ryuyutyo/Documents/code/modules/ai/sandpacker` 中的 `@sandpacker/worker` selection tagger 源码，改为 `@babel/parser` 驱动的 plugin-level TSX AST transform；发布构建会把 parser bundle 进 worker tagger 产物，避免消费方再遇到 CJS export 形态问题。

前三个提交是止血：让 preview 先避开 tagger 对 TS 语法的误伤，并补上 `Textarea` 等 UI stub。后续策略已收敛为只改写明确的 Telegraph UI import，不对裸 JSX 名称自动注入 import。
后续修复已把方向改正：preview 应直接支持 TypeScript，tagger 负责避开 TypeScript generic/type syntax，只给真实 JSX tag 插入 selection metadata。

## 验证记录

最近一次针对 plugin-level TSX AST tagger 与 `Textarea is not defined` 的修复已通过：

```bash
pnpm --filter @telegraph/design test -- src/application/browser/__tests__/DesignSandpackerPreview.test.ts
pnpm --filter @telegraph/design typecheck
pnpm --filter @telegraph/design lint
```

新增回归测试覆盖：

- TS generic：`BoxProps<T extends Record<string, Array<string>>>` 不会被插入 `data-sandpacker-id`。
- JSX element：真实 `<button>` 会被插入 selection metadata。
- typed `telegraph-ui.tsx` stub 中的 `ElementProps<T extends keyof React.JSX.IntrinsicElements>` 不会被 tagger 破坏。

## 复发排查 Runbook

### 1. Preview 空白或卡在“等待 artifact”

检查顺序：

1. Design run 是否返回 `run_completed.output.artifact`。
2. `design-agent-projector` 是否把 assistant / tool / completed event 投影为 artifact。
3. `DesignArtifactWorkbench` 是否进入 patch preview mode。
4. `DesignSandpackerPreview` 收到的 operations 是否包含可渲染 TSX entry。

### 2. Preview iframe 404

如果看到类似：

```text
GET http://localhost:5173/src/index.tsx?entry 404
```

优先判断 entry 请求是否逃逸到 host Vite root。正确请求应带 artifact scoped prefix，例如：

```text
/telegraph-design-<artifact-id>/vite/<artifact-id>/...
```

### 3. Service worker 502 或 CDN fetch failed

如果看到：

```text
502 BAD GATEWAY (from service worker)
Failed to fetch
https://esm.sh/... net::ERR_FAILED
```

优先看 `sandpacker-worker.js` 的 request 分流：

- 本地 scoped artifact 文件请求应进入 Sandpacker 处理。
- `https://esm.sh/...`、CDN 与非 scoped 请求应 bypass worker。

### 4. `does not provide an export named ...`

先判断报错模块属于哪类：

- CJS / UMD 依赖：需要 Vite optimizeDeps / alias / shim。
- browser-specific entry：需要确认 Sandpacker 期望的 export 形态。
- 真实 workspace 包：不要直接暴露给 sandbox，优先转成 preview stub。

### 5. `ReferenceError: X is not defined`

如果 `X` 是 UI 组件，例如 `Textarea`、`Button`、`Card`：

1. 检查 `/src/telegraph-ui.tsx` stub 是否导出 `X`。
2. 检查 `normalizeTelegraphImports` 是否识别真实 package import。
3. 如果源码里只有裸 JSX `<X />` 且没有 import，优先修 generated source 或 codegen contract；preview 不再静默自动注入 import。

### 6. Node builtin externalized warning

如果看到：

```text
Module "util" has been externalized for browser compatibility.
Module "buffer" has been externalized for browser compatibility.
```

优先检查 `apps/main/vite.renderer.config.ts`：

- `util` / `node:util` 应解析到 `apps/main/src/application/browser/sandpacker-node-stubs/util.ts`。
- `buffer` / `node:buffer` 应解析到 `node_modules/buffer/index.js`，不要改成空 stub；`etag`、`crypto-browserify`、`memfs` 等依赖会实际调用 `Buffer.byteLength/from/isBuffer`。
- 修改 alias 或 polyfill 后，重启 dev server 并重新 optimize deps。

### 7. optimize deps missing chunk

如果 shell 出现：

```text
The file does not exist at ".../node_modules/.vite/deps/chunk-*.js"
```

通常是 Vite dev server 运行中发现新依赖并重写 `.vite/deps`，旧 iframe 仍请求旧 hash。处理顺序：

1. 停掉 dev / Electron 进程。
2. 跑 `pnpm --filter @telegraph/main exec vite --config vite.renderer.config.ts optimize --force`。
3. 确认新依赖已加入 `optimizeDeps.include`，尤其是 Sandpacker worker graph 的 browser polyfill 依赖。
4. 重启 `pnpm start`。

### 8. iframe sandbox warning

如果看到：

```text
An iframe which has both allow-scripts and allow-same-origin for its sandbox attribute can escape its sandboxing.
```

不要通过只删除 `allow-same-origin` 来止血；这会让 iframe origin 变成 `null`，从而打断 Vite HMR 与同源 service worker asset 加载。当前策略：

- Sandpacker preview iframe 不设置 `sandbox`。
- 纯 HTML preview iframe 仍使用 `sandbox=""`。
- 如果后续需要强隔离，应迁到独立 origin / BrowserView / isolated browser target，而不是恢复 `allow-scripts + allow-same-origin`。

## 后续观察项

- 当前 UI stub 组件清单仍是白名单。后续模型如果生成 `Select`、`Dialog`、`Label`、`Switch` 等组件，可能再次出现缺 binding，需要按同样方式补 stub 或让 codegen 阶段约束可用组件集合。
- service worker、Tailwind browser runtime asset 与 iframe scope 在 packaged Electron 环境还需要单独验收；dev server 通过不代表 packaged file protocol 一定通过。
- preview 运行错误需要继续升级成用户可读的错误面板，避免只靠 DevTools console。
- P-009 中的真实 iframe DOM element selection、style editor 回写、artifact revision dirty state 仍未完全闭环；edited operations summary 已能进入下一轮 revision context。
