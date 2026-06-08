---
id: R-004
title: Telegraph Extension 作者速查（jiti loader · alias map · ExtensionHost API）
description: >
  面向 extension 作者的写法速查与 host 集成参考。覆盖 extension 文件布局、manifest 形状、可用
  import 写法（含 first-party alias 列表）、ExtensionHost 构造选项语义、生命周期 listener、
  以及新增 alias / 新增宿主 pagelet 时的 checklist。配合 I-010 阅读理解后台机制。
category: reference
created: 2026-06-08
updated: 2026-06-08
tags: [extension, reference, jiti, alias, extension-host, quickref]
status: final
references:
  - id: D-019
    rel: related-to
    file: ../discussion/20260608-extension-host-and-native-subagent-rewrite.md
  - id: I-010
    rel: related-to
    file: ../issue/20260608-extension-loader-jiti-three-stage-fix.md
  - id: A-012
    rel: related-to
    file: ../architecture/20260520-telegraph-harness-extension-architecture.md
  - id: R-002
    rel: related-to
    file: 20260521-pi-subagents-implementation-study.md
---

# R-004: Telegraph Extension 作者速查（jiti loader · alias map · ExtensionHost API）

> 写一个新 telegraph extension 时该怎么布置文件、能用哪些 import 写法、`ExtensionHost`
> 暴露了哪些 option、生命周期事件怎么订阅、新加一个 `@/packages/*` package 时该改哪里。
> 4-pack（`telegraph-todo / -bookmark / -subagents / -completion-notify`）是当前所有 extension
> 的工作样例。

## 1. 文件布局

一个 extension 是一个目录，强制只有两个文件：

```
extensions/<my-ext>/
├── telegraph.extension.json    # manifest（强制）
└── index.ts                    # 入口（manifest.main 指向）
                                # 任意 sibling .ts 文件均可被 index.ts 相对 import
```

### manifest（`telegraph.extension.json`）

```jsonc
{
  "id": "my-ext",          // 必填，全局唯一，等同 deactivate(id) 的 key
  "name": "My Ext",        // 必填，UI 展示用
  "version": "0.1.0",      // 必填，semver
  "main": "index.ts",      // 必填，相对路径，可以是 .ts / .js / .mjs
  "permissions": [],       // 可选，声明式，当前 ExtensionHost 仅记录不强制
  "dependsOn": [],         // 可选，预留字段，当前不强制依赖图
  "metadata": {}           // 可选，pass-through 自定义字段
}
```

schema 见 `packages/agent-extensions/src/manifest.ts` 中的 `parseExtensionManifest`。

### entry（`index.ts`）

```ts
import type { TelegraphExtension } from '@/packages/agent-capabilities'

const ext: TelegraphExtension = (ctx) => {
  ctx.host.registerTool({
    definition: { name: 'my.tool', description: '...', inputSchema: { type: 'object' } },
    execute: async (input, runCtx) => ({ ok: true }),
  })

  ctx.hooks.on('onRuntimeEvent', ({ event }) => {
    if (event.type === 'tool_call') { /* ... */ }
  })

  // 可选：返回 cleanup fn，会在 deactivate 时调用
  return () => {
    // 释放定时器、关闭连接等
  }
}

export default ext
```

要点：

- **`export default` 一个函数**（必须，否则 activation 直接报 `must export a default function`）
- factory 的形参是 `AgentCapabilityContext = { host: TelegraphExtensionHost, hooks: CapabilityHookRegistrar }`
- factory 可以是 sync 也可以是 async（返回 `Promise<void | cleanup>`）
- cleanup fn 可选；返回什么类型 ExtensionHost 都能处理（见 `ExtensionHost.ts:152-159`）

## 2. 能用哪些 import 写法

extension 通过 jiti 加载（见 D-019 / I-010），下面三种写法**全部可用**：

```ts
// 1. 相对 import，无后缀（bundler 风格）
import { TOOL_NAME } from './helper'

// 2. 相对 import，带 .ts 后缀
import type { Foo } from './types.ts'

// 3. first-party alias —— 必须出现在 buildExtensionAliasMap 里
import type { RuntimeEvent } from '@/packages/agent-protocol'
import { someUtil } from '@/packages/agent/runtime/streamPiAiRuntime'
```

### 当前可用的 first-party alias

由 `apps/main/src/application/node/extension-aliases.ts:36-48` 维护，extension 内可直接使用：

| Alias | 解析到 |
|---|---|
| `@/packages/agent-protocol` | `packages/agent-protocol/src/` |
| `@/packages/agent-capabilities` | `packages/agent-capabilities/src/` |
| `@/packages/agent-extensions` | `packages/agent-extensions/src/` |
| `@/packages/agent-resources` | `packages/agent-resources/src/` |
| `@/packages/computer-use-protocol` | `packages/computer-use-protocol/src/` |
| `@/packages/computer-use` | `packages/computer-use/src/` |
| `@/packages/orchestrator-core` | `packages/orchestrator-core/src/` |
| `@/packages/agent` | `packages/agent/src/` |

### alias 解析语义（必读）

jiti 用 pathe 实现 alias，规则是 **prefix + path-segment boundary**：

- `@/packages/agent` 匹配 `@/packages/agent` 与 `@/packages/agent/runtime/X`
- `@/packages/agent` **不匹配** `@/packages/agent-protocol`（要求 alias 后第一个字符是 `/` 或字符串结尾）
- 多个 alias 共享前缀时按 segment 数 longest-match-first

实测代码：`node_modules/jiti/dist/jiti.cjs` 中的 `normalizeAliases` / `resolveAlias`。

### 不能用的写法

- ❌ vite-only 的 alias：`@vue/...` / `~/...` / 自定义 alias 等——jiti 不读 vite config
- ❌ tsconfig `paths` 里没的路径——jiti 也不读 tsconfig
- ❌ npm package 名（除非真的装进了 `package.json` `dependencies`，jiti 会走标准 node resolution）

## 3. ExtensionHost API

`packages/agent-extensions/src/ExtensionHost.ts`，主要给宿主 pagelet 用。

### 构造 options（`ExtensionHostOptions`）

```ts
new ExtensionHost({
  telegraph,            // 必填：TelegraphExtensionHost 实例（喂给 factory.ctx.host）
  hooks,                // 必填：CapabilityHookRegistrar（喂给 factory.ctx.hooks）
  aliases,              // 可选：Record<string, string>，jiti alias map
  importer,             // 可选：覆盖默认 jiti importer（测试用）
  onLifecycleEvent,     // 可选：(event: ExtensionLifecycleEvent) => void
  now,                  // 可选：() => number，时钟注入（测试用）
})
```

**三种 importer 决策**（`ExtensionHost.ts:56-66`）：

1. 传 `importer` → 用它（测试 in-memory factory）
2. 传 `aliases` → 新建 per-host jiti（jiti 在构造时 freeze options，必须独立实例）
3. 都不传 → 复用进程级 `sharedJiti`，省 babel parser 启动成本

### 加载方法

```ts
// 加载单个目录（rootPath 是 extension 根，含 telegraph.extension.json）
const { activated, diagnostics } = await host.activateFromPath(rootPath)

// 加载一个目录下的所有 extension（每个子目录视为一个 extension 根）
const { activated, diagnostics } = await host.activateFromDirectory(dirPath)

// 测试用：跳过 disk discovery 直接加载一个 ExtensionPackage
await host.activatePackage(pkg)
```

### 卸载

```ts
await host.deactivate('my-ext')   // 单个，no-op if 不存在
await host.deactivateAll()        // 全部按 reverse activation order 卸载
```

cleanup fn 抛错会被吞 + 通过 `deactivation_failed` 事件上报（不阻塞其他 extension 卸载，RFC §8.3 Red Flag #4）。

### 自省

```ts
host.listActivated()       // → string[] 当前活跃的 extension id 列表
host.getActivation(id)     // → ActivatedExtension | undefined
```

### 幂等

同一个 id 重复 `activatePackage` 不会重复 activate，返回已有 record（dedup by id，与 CapabilityHost 一致）。

## 4. 生命周期事件

```ts
new ExtensionHost({
  /* ... */
  onLifecycleEvent: (ev) => {
    switch (ev.type) {
      case 'activated':              // factory 成功跑完
      case 'deactivated':            // cleanup 成功跑完
      case 'activation_failed':      // import / factory 任意阶段抛错
      case 'deactivation_failed':    // cleanup 抛错
    }
    // ev.error?: { message, stack? } 在 *_failed 事件上有
  },
})
```

**强烈建议**宿主务必挂这个 listener 把 failure 打到 stderr，参考 `apps/chat/src/application/node/ChatPageletWorker.ts:406-409` 的最小实现：

```ts
onLifecycleEvent: ev => {
  if (ev.type === 'activation_failed' || ev.type === 'deactivation_failed') {
    console.error(`[chat-worker:extension:${ev.type}] ${ev.extensionId}: ${ev.error?.message ?? 'no message'}`)
  }
}
```

成功事件保持安静，避免 noise。

> **注意**：lifecycle 事件**不**是 RuntimeEvent，不会自动进 trace。宿主负责桥接到 `extension_activated` / `extension_deactivated` 这两个已有 RuntimeEvent type（events.ts:58-59），如果当前确实有活跃 Run。

## 5. 在哪里构造 ExtensionHost

```ts
// apps/<pagelet>/src/application/node/<Pagelet>Worker.ts
import { ExtensionHost } from '@/packages/agent-extensions'
import { buildExtensionAliasMap } from '@/apps/main/application/node/extension-aliases'

const hooks: CapabilityHookRegistrar = {
  on: (name, handler) => this.extensionHookBus.on(name, handler),
}
const telegraphHost = new TelegraphExtensionHostImpl(hooks)
const extensionHost = new ExtensionHost({
  telegraph: telegraphHost,
  hooks,
  aliases: buildExtensionAliasMap(),     // <-- 必须
  onLifecycleEvent: ev => { /* stderr bridge */ },
})

await extensionHost.activateFromDirectory(resolve(monorepoRoot, 'extensions'))
```

`buildExtensionAliasMap()` 是无副作用 pure helper，每次构造一个新 `ExtensionHost` 时调一次即可。

## 6. Checklist：新加 first-party package 需要给 extension 用

当一个新 `packages/<new-pkg>` 准备开放给 extension import 时：

1. **`apps/main/src/application/node/extension-aliases.ts`**：在 `buildExtensionAliasMap()` 返回的 record 里加一行 `'@/packages/<new-pkg>': pkgSrc('<new-pkg>')`
2. **`apps/main/vite.chat.config.ts`** 和 **`apps/main/vite.design.config.ts`**：在 `resolve.alias` 中加 `'@/packages/<new-pkg>': resolve(__dirname, '../../packages/<new-pkg>/src')`（让 chat/design worker 本身的 first-party 代码也能 import 这个 package）
3. **chat / design / 其它 pagelet 的 tsconfig**：在 `compilerOptions.paths` 中加 `'@/packages/<new-pkg>': ['../../packages/<new-pkg>/src/index']` 与 `'@/packages/<new-pkg>/*': ['../../packages/<new-pkg>/src/*']`
4. **被新 extension 使用前**重启 pagelet（jiti 的 alias 在 `createJiti` 时 freeze，不会热更新）

## 7. Checklist：新加 host pagelet 需要支持 extension

当一个新的 utility process pagelet（比如未来的 `cli-gateway` / `remote-control`）要开放 extension 加载时：

1. **app 的 tsconfig**：alias 表里加 `'@/apps/main/*'` 与所需 `@/packages/*`（参考 chat tsconfig）
2. **`<Pagelet>Worker.ts` 中**：
   - import `ExtensionHost`、`TelegraphExtensionHostImpl`、`CapabilityHookRegistrar`、`buildExtensionAliasMap`
   - 在 `activateExtensions()` 里按 §5 模板构造
   - 挂 `onLifecycleEvent` 桥到 stderr
3. **对应 vite config**（如果 pagelet 由 forge 走 vite-bundled cjs）：复制 `vite.chat.config.ts` 的 `externalJitiPlugin` 与 `isExternal` 中的 jiti 分支——**两个护栏都要**（见 I-010 §6）
4. **跑一遍**：手写一个 dummy extension `extensions/test-ext/` 验证 activate 链路通

## 8. Checklist：写一个新 extension

1. 在 `extensions/` 下建目录 `<my-ext>/`
2. 写 `telegraph.extension.json`，至少有 `id` / `name` / `version` / `main`
3. 写 `index.ts`，`export default` 一个 `TelegraphExtension`
4. 需要拆文件就直接 `import { X } from './helper'`（无后缀），jiti 会找到 `./helper.ts`
5. 需要用 first-party API 就 `import { X } from '@/packages/agent-protocol'` 等
6. 重启 `pnpm start`，看 chat / design pagelet stderr 是否有 `[<worker>:extension:activation_failed]`
7. 在 chat / design 触发对应交互，验证 tool / hook 表现符合预期

## 9. 反例（不要这么写）

```ts
// ❌ 没有 default export
export const myExt: TelegraphExtension = (ctx) => { /* ... */ }
//   ↑ activation_failed: "must export a default function"

// ❌ alias 不在 buildExtensionAliasMap 里
import { X } from '@/packages/stores'
//   ↑ Cannot find module '@/packages/stores'

// ❌ 依赖 tsconfig 里 paths 但 alias map 没补
import { X } from '@/packages/some-new-pkg'
//   ↑ IDE 不报红但运行时炸；先按 §6 补 alias map

// ❌ factory 内同步抛错没兜底
const ext: TelegraphExtension = () => {
  throw new Error('oops')   // activation_failed，但其他 extension 仍能正常 load
}

// ❌ cleanup 里跑长任务且不 catch
return () => {
  return someLongRunningTeardown()    // 抛错会被吞，但卸载流程会等它 resolve
}
```

## 10. 涉及文件速查

| 角色 | 文件 |
|---|---|
| Factory 类型 | `packages/agent-capabilities/src/types.ts`（`TelegraphExtension` / `AgentCapabilityContext` / `TelegraphExtensionHost`） |
| Hook 类型 | `packages/agent-protocol/src/hooks.ts`（9 个 HookName + payload map） |
| RuntimeEvent 类型 | `packages/agent-protocol/src/events.ts` |
| ExtensionHost loader | `packages/agent-extensions/src/ExtensionHost.ts` |
| ExtensionHost options | `packages/agent-extensions/src/types.ts` |
| Manifest schema | `packages/agent-extensions/src/manifest.ts` |
| Host alias helper | `apps/main/src/application/node/extension-aliases.ts` |
| Chat 接线 | `apps/chat/src/application/node/ChatPageletWorker.ts:383-410` |
| Design 接线 | `apps/design/src/application/node/DesignPageletWorker.ts:183-197` |
| jiti external | `apps/main/vite.chat.config.ts:44-60`, `apps/main/vite.design.config.ts:20-36` |
| 工作样例 | `extensions/telegraph-todo/`, `telegraph-bookmark/`, `telegraph-subagents/`, `telegraph-completion-notify/` |
