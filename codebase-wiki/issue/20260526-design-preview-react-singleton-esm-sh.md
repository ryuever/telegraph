---
id: I-008
title: Design Preview 中 React singleton 被 esm.sh 依赖解析打散
description: >
  记录 Design Page preview 在 Radix / Recharts / lucide-react 依赖下触发
  Cannot read properties of null (reading 'useContext') 的排查过程、根因分层、
  本地修复方案，以及应沉淀到 Sandpacker 源码的上游修复建议。
category: issue
created: 2026-05-26
updated: 2026-05-26
tags:
  - design-page
  - preview
  - sandpacker
  - esm-sh
  - react
  - radix-ui
  - recharts
status: wip
references:
  - id: I-005
    rel: extends
    file: ./20260521-design-page-preview-sandpacker-stabilization.md
---

# Design Preview 中 React singleton 被 esm.sh 依赖解析打散

> 本文记录 Design Page preview 在 Sandpacker + esm.sh 依赖解析路径下触发 React hook dispatcher 为 null 的问题。
> 最终结论不是 generated file tree 本身应被 preview adapter 修改，而是 Sandpacker dependency CDN resolver 需要保证 React / ReactDOM 作为 singleton peer dependency 被同一 URL 解析。

## 现象

生成的 SaaS / dashboard 类页面进入 Design preview 后，iframe runtime 报错：

```text
Cannot read properties of null (reading 'useContext')
https://esm.sh/react@19.2.6/es2022/react.development.mjs:934:27
```

第一轮修复后，报错变为：

```text
Cannot read properties of null (reading 'useContext')
https://esm.sh/react@19.1.0/es2022/react.development.mjs:900:27
```

触发页面的 generated `package.json` 包含 React 19.1.0，同时依赖 `@radix-ui/react-checkbox`、`@radix-ui/react-progress`、`@radix-ui/react-tabs`、`lucide-react`、`recharts` 等包。另一个依赖更轻的页面没有复现，不代表链路安全，只是没有踩到同样的 hook / context 路径。

## 根因

### 1. Preview adapter 不应修改 file tree

早期 `DesignSandpackerPreview` 曾在投影文件树时修改 `/package.json`：

- 将 `react` / `react-dom` 改成 `latest`。
- 将 `@radix-ui/react-*` 改成 `latest`。
- 通过 `previewOnlyContent` 避免这些 preview-only 内容回写 artifact。

这会把 generated artifact 中已经 pin 到 `19.1.0` 的 React 重新漂到 npm latest。2026-05-26 当时 npm latest 为 `19.2.6`，所以 esm.sh wrapper 中出现 `react@19.2.6`。

修复后，`createSandpackerFileTree` 只做路径投影，内容原样进入 Sandpacker：

- `apps/design/src/application/browser/DesignSandpackerPreview.tsx:284-306`
- 对应测试断言 `package.json` 必须 verbatim 保留：
  `apps/design/src/application/browser/__tests__/DesignSandpackerPreview.test.ts`

### 2. 只 pin 版本不够，还要 pin peer dependency 解析

去掉 file tree 改写后，React 版本仍可能被间接依赖带偏。esm.sh 对 Radix / Recharts 的 wrapper 会根据包自身 peer dependency 范围生成 React import，例如：

```text
@radix-ui/react-tabs@latest?bundle&dev
  -> /react@^19.3.0-canary-...?... 

recharts@2.15.4?bundle&dev
  -> /react@^16.0.0 || ^17.0.0 || ^18.0.0 || ^19.0.0?...
```

给 wrapper URL 增加 `deps=react@19.1.0,react-dom@19.1.0` 后，esm.sh 会把依赖包内部的 React / ReactDOM peer 解析到同一版本。

### 3. 同版本不同 URL 仍然会打散 React singleton

第一版 CDN resolver patch 只做了 peer pin，仍留下第二个问题：

```text
bare react import:
  https://esm.sh/react@19.1.0?bundle&dev
  -> /react@19.1.0/es2022/react.development.bundle.mjs

Radix / Recharts internal React import:
  /react@19.1.0/es2022/react.development.mjs
```

React 版本相同，但 module URL 不同，浏览器按 URL 建 module instance。ReactDOM 设置 dispatcher 的 React 实例与组件调用 hooks 的 React 实例不同，就会表现为 `ReactSharedInternals.H === null`，最终在 `useContext` 上炸。

因此修复必须同时满足：

- React / ReactDOM 版本固定。
- React exact import 使用 non-bundle dev wrapper。
- `react/jsx-runtime` / `react/jsx-dev-runtime` / `react-dom/client` 有 exact import map。
- Radix / Recharts / lucide-react 等依赖包的 esm.sh URL 带 React peer deps。

## 修复方案

### Telegraph 侧临时补丁

当前通过 pnpm patch 修 `@sandpacker/worker@0.4.0` 的 `dependency-cdn` resolver：

- `package.json` 增加 `pnpm.patchedDependencies`。
- `patches/@sandpacker__worker@0.4.0.patch` 修改 `dist/compiler/plugins/dependency-cdn.js`。
- `pnpm-lock.yaml` 记录 patch hash。

关键行为：

```text
react
  -> https://esm.sh/react@19.1.0?dev

react/jsx-runtime
  -> https://esm.sh/react@19.1.0/jsx-runtime?dev

react/jsx-dev-runtime
  -> https://esm.sh/react@19.1.0/jsx-dev-runtime?dev

react-dom/client
  -> https://esm.sh/react-dom@19.1.0/client?dev&external=react

@radix-ui/react-tabs
  -> https://esm.sh/@radix-ui/react-tabs@latest?bundle&dev&deps=react@19.1.0,react-dom@19.1.0

recharts
  -> https://esm.sh/recharts@2.15.4?bundle&dev&deps=react@19.1.0,react-dom@19.1.0
```

为避免旧 web worker 继续使用旧 resolver，preview worker URL 增加 cache-bust：

- `apps/design/src/application/browser/DesignSandpackerPreview.tsx:21-23`

### 为什么不写进 generated `vite.config.ts`

这次不建议把修复沉到 generated `vite.config.ts`：

1. Sandpacker browser runtime 当前只从 generated config 中读取 `resolve.alias`，不会完整执行或继承 `resolve.dedupe` / `optimizeDeps`。
2. 即使用 alias 指到 esm.sh URL，也会把 preview CDN 细节泄漏进用户 artifact，破坏“给什么渲染什么”的边界。
3. 老 artifact 无法受益；resolver 层修复可以统一覆盖所有 Sandpacker preview。

generated `package.json` 仍应负责声明依赖版本；Sandpacker resolver 负责按这个 manifest 生成一致的 CDN module graph。

## 是否应该沉淀到 Sandpacker 源码

结论：适合，而且比保留 Telegraph 本地 patch 更合适。

理由：

- 这是 Sandpacker browser CDN resolver 的通用问题，不是 Telegraph 业务代码特有问题。
- React、ReactDOM、Vue 等 runtime singleton / renderer peer 依赖都不能被 CDN wrapper 自由解析成多个 URL。
- resolver 已经读取 project `package.json`，天然有足够信息把 declared dependency version 传给 esm.sh `deps` 参数。
- 上游修复可以避免每个消费方用 `vite.config.ts` alias 或 preview adapter 改 file tree 兜底。

建议上游改法：

1. 在 `dependency-cdn` resolver 中引入 singleton peer deps 概念，第一批至少覆盖 `react` / `react-dom`。
2. 对非 React 包的 esm.sh URL 自动追加 `deps=react@<declared>,react-dom@<declared>`，仅在 project manifest 有明确版本且不是 `latest` 时追加。
3. React 自身不要走 bundle wrapper，使用 `?dev`，让 bare `react` 与 peer dependency wrapper 落到同一 non-bundle module。
4. 为 `react/jsx-runtime`、`react/jsx-dev-runtime`、`react-dom/client` 生成 exact import map，避免前缀 import map 落到不同 query / prod-dev URL。
5. 增加 resolver 单测，断言同一 project manifest 下所有 React 入口 URL 统一。

上游实现应写在 Sandpacker 源码层，而不是只 patch `dist/`。Telegraph 当前的 pnpm patch 是临时消费方止血。

## 验证

本轮本地验证：

```bash
pnpm --filter @telegraph/design test -- DesignSandpackerPreview.test.ts
pnpm --filter @telegraph/design typecheck
pnpm --filter @telegraph/main typecheck
```

resolver 输出 smoke test：

```text
https://esm.sh/react@19.1.0?dev
https://esm.sh/react@19.1.0/jsx-runtime?dev
https://esm.sh/react-dom@19.1.0/client?dev&external=react
https://esm.sh/recharts@2.15.4?bundle&dev&deps=react@19.1.0,react-dom@19.1.0
https://esm.sh/@radix-ui/react-tabs@latest?bundle&dev&deps=react@19.1.0,react-dom@19.1.0
https://esm.sh/lucide-react@latest?bundle&dev&deps=react@19.1.0,react-dom@19.1.0
```

## 复发 Runbook

1. 打开 preview iframe 的 HTML，检查 import map 中 `react` 是否为 `https://esm.sh/react@<version>?dev`。
2. 检查 `react/jsx-runtime`、`react/jsx-dev-runtime`、`react-dom/client` 是否有 exact import map。
3. 检查 Radix / Recharts / lucide-react wrapper URL 是否带 `deps=react@<version>,react-dom@<version>`。
4. 如果改动已落地但浏览器仍报旧 URL，清理 worker 和 cache：

   ```js
   await Promise.all((await navigator.serviceWorker.getRegistrations()).map(r => r.unregister()))
   await Promise.all((await caches.keys()).map(k => caches.delete(k)))
   location.reload()
   ```

5. 如果栈仍指向 `react.development.mjs` 的 `useContext`，继续排查 generated source 是否在组件函数外直接调用 hook；否则优先怀疑 React module identity 仍未统一。
