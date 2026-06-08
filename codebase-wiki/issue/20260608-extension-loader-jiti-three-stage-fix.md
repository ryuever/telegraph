---
id: I-010
title: 4-pack extension 加载链三连 fix 复盘（type-stripping → babel.cjs → jiti alias）
description: >
  记录 4 个 extension（telegraph-todo / -bookmark / -subagents / -completion-notify）在
  chat / design pagelet utility process 中无法 activate 的三阶段事故：Node 25 type-stripping
  不增强 module resolution、jiti 的 ../dist/babel.cjs 被 vite 内联失踪、jiti 不消费 vite alias。
  覆盖每层根因、诊断手段（forge mergeConfig 行为实测）、最终修复（jiti 默认 importer + 双重护栏
  external + per-host alias map）与回归验证。
category: issue
created: 2026-06-08
updated: 2026-06-08
tags: [extension, jiti, vite, electron-forge, node-25, type-stripping, alias, postmortem]
status: final
references:
  - id: D-019
    rel: related-to
    file: ../discussion/20260608-extension-host-and-native-subagent-rewrite.md
  - id: A-005
    rel: related-to
    file: ../architecture/20260505-telegraph-agent-runtime-extension-host-theory.md
  - id: A-012
    rel: related-to
    file: ../architecture/20260520-telegraph-harness-extension-architecture.md
  - id: R-004
    rel: related-to
    file: ../reference/20260608-extension-author-quickref.md
---

# I-010: 4-pack extension 加载链三连 fix 复盘（type-stripping → babel.cjs → jiti alias）

> 记录 4 个 extension（`telegraph-todo` / `telegraph-bookmark` / `telegraph-subagents` /
> `telegraph-completion-notify`）在 chat / design pagelet utility process 中 activate 失败的
> 三阶段事故；最终通过 ExtensionHost 默认 importer 切换到 jiti、对 jiti 加双重护栏 external、
> 以及给 ExtensionHost 新增 `aliases` option 三处变更修复，全部 extension 已可正常工作。

## 1. 时间线

| 时点 | 现象 | 操作 |
|---|---|---|
| T0 | extension 落盘后用 `runtime.run()` 触发首次 `activateFromDirectory`，pagelet stderr 报 `ERR_MODULE_NOT_FOUND` on `from './helper'` | 定位为 Node 25 type-stripping 不补强 module resolution |
| T1 | 将 `ExtensionHost` 默认 importer 从 `import()` 切到 jiti `sharedJiti.import()` | 写本地 disk-based regression test（`extension.ts` + 无后缀 `from './helper'`），单测全绿 |
| T2 | 重启 `pnpm start`，新错误：`Cannot find module '../dist/babel.cjs'` | 定位为 jiti 被 rollup 内联，相对路径从 bundle 位置错指 |
| T3 | 在 `apps/main/vite.{chat,design}.config.ts` 的 `rollupOptions.external` 函数中加 jiti 分支 | 重启后**错误依旧**，bundle 体积无变化 |
| T4 | 加诊断手段：top-level `console.log` 副作用 + `isExternal` 内部 `console.log` + `chunkFileNames` 改 hash pattern | 实测 top-level 打印且 chunk 命名生效（说明 config 被消费），但 `isExternal` 内部 0 次命中 |
| T5 | 改用 rollup plugin `enforce: 'pre'` + `resolveId` 返回 `{ id, external: true }`，并把 jiti 升为 `apps/main` runtime dep | babel.cjs 错误消失，chat main chunk 从 1238 KB 缩到 567 KB |
| T6 | 重启后第三个错误：`Cannot find module '@/packages/agent-extensions'` | 定位为 jiti 不读 vite `resolve.alias` 也不读 tsconfig `paths` |
| T7 | `ExtensionHost` 新增 `aliases` option（per-host 独立 jiti 实例），新建 `apps/main/src/application/node/extension-aliases.ts` 提供 `buildExtensionAliasMap()`，chat / design worker 在 `activateExtensions()` 中喂入 | extension 全部 activated，4 个面板（todo 卡片 / `/bookmark` 命令 / subagents fan-out / completion notification）功能验证通过 |

## 2. 根因分层

三个错误同源于"extension 源码沿用 first-party 风格（TypeScript + 无后缀相对 import + `@/packages/*` 别名），但加载它的 ExtensionHost 跑在一个被 forge / vite 改造过的环境里"，但每层的具体原因互相独立。

### 2.1 第一层：Node 25 type-stripping 不补强 module resolution

Node 25 原生支持 `--experimental-strip-types`（telegraph 默认开启），可以执行 `.ts` 文件——但**仅去除类型标注**，不修改 ESM resolver。一个 `.ts` 文件里写 `import { X } from './helper'`（无后缀），Node 仍按 ESM 规范查找 `./helper`（精确匹配）→ `./helper.js` / `./helper.mjs`（按 `package.json` `type`）→ 失败。它**不会**探 `./helper.ts` / `./helper/index.ts`。

extension 作者采用 bundler-style 写法（VS Code 项目里 `tsconfig.json` 的 `moduleResolution: "bundler"` 让 IDE 不报红），落到 Node 直接 `ERR_MODULE_NOT_FOUND`。

### 2.2 第二层：jiti 的 `../dist/babel.cjs` 引爆点 + forge mergeConfig 行为

`node_modules/jiti/lib/jiti.cjs:13` 用 `require("../dist/babel.cjs")` **延迟加载** babel transformer——这是 jiti 启动期分摊 transpiler init cost 的标准手法。**但**：

1. rollup 静态分析看不见这个 `require()` 的相对路径目标
2. 即使看见，相对路径 `../` 在 bundle 后从产物位置 `apps/main/.vite/preload/<chunk>.js` 解析，会指向不存在的 `apps/main/.vite/dist/babel.cjs`

正确做法是把 `jiti` 标 external，运行时从 hoisted `node_modules/jiti/`（`dist/` 与之同级）解析。但**`@electron-forge/plugin-vite` 默默丢弃 user 的 `rollupOptions.external` 函数**——它内部装一套自己的 `external` (string[])，vite 的 `mergeConfig` 无法安全把"函数"与"string[]"合并，于是把 user 的函数整体替换掉。

T4 阶段的实测验证：

| 诊断手段 | 预期结果 | 实测结果 | 推论 |
|---|---|---|---|
| `console.log('[vite.chat.config] loaded')` 放文件 top-level | 应打印 | **打印** | forge 确实在 import 这份 config |
| `console.log` 放 `isExternal(id)` 函数内 | id === 'jiti' 应打印 | **0 次命中** | rollup 从未调用此 external 函数 |
| `chunkFileNames` 改为带 hash 的 pattern | 产物文件名应变 | **变了** | rollup 确实消费了 `rollupOptions.output` |

结论：forge 消费了 user config 的 `output`，但丢弃了 `external`。

### 2.3 第三层：jiti alias 必须显式喂

jiti 的设计哲学是"零配置 transpile + 显式 resolve"。它的 `alias` option 不来自 vite、不来自 tsconfig `paths`、不来自 monorepo root 的 `package.json` `imports`——只来自 `createJiti(url, { alias })` 调用时传入的 map。

extension 源码里大量使用 `from '@/packages/agent-protocol'` 等 first-party alias（与 host 项目保持一致），不喂 alias map 直接 `Cannot find module '@/packages/agent-extensions'`。

jiti alias 的解析语义（实测验证自 `node_modules/jiti/dist/jiti.cjs` 中的 `normalizeAliases` / `resolveAlias`，底层是 pathe 的 `utils.ts:59-75` / `132-134`）：

- **prefix-based with path-segment boundary**：`@/packages/agent` 匹配 `@/packages/agent/runtime/X`，**不**误匹配 `@/packages/agent-protocol`（要求下一个字符必须是 `/` 或字符串结尾）
- **longest-match-first**：多个 alias 共享前缀时按 `/` segment 数排序选最长匹配

## 3. 修复

### 3.1 ExtensionHost 默认 importer 切换到 jiti

`packages/agent-extensions/src/ExtensionHost.ts:224` 新建一个进程单例 jiti：

```ts
const sharedJiti = createJiti(import.meta.url, { moduleCache: false })

async function defaultImporter(absolutePath: string): Promise<unknown> {
  return sharedJiti.import(absolutePath)
}
```

`moduleCache: false` 是为了配合 RFC §4 的 deactivate / reactivate 语义——一次卸载后再激活必须重新求值源码而非返回 stale module record。

importer 入参从 file URL specifier 改为绝对路径（jiti 内部 normalise path-vs-URL，省掉 `pathToFileURL` round-trip）。

### 3.2 ExtensionHost 新增 `aliases` option

`packages/agent-extensions/src/types.ts:80-90` 新增可选字段。`ExtensionHost.ts:56-66` 的 constructor 关键分支：

```ts
if (options.importer !== undefined) {
  this.importer = options.importer
} else if (options.aliases !== undefined) {
  // jiti freezes resolver options at construction → 不能复用 sharedJiti
  const aliasedJiti = createJiti(import.meta.url, {
    moduleCache: false,
    alias: options.aliases,
  })
  this.importer = (absolutePath) => aliasedJiti.import(absolutePath)
} else {
  this.importer = defaultImporter
}
```

注意三段分支的取舍：

- 传 `importer` 优先（test 用 in-memory factory，无需 jiti）
- 传 `aliases` 时**必须**新建 per-host jiti（不能 mutate `sharedJiti`，jiti 在 construction 时 freeze options）
- 都不传时复用 `sharedJiti`，避免多 host 重复 babel parser 启动

### 3.3 双重护栏 external jiti

`apps/main/vite.chat.config.ts:44-53` 与 `apps/main/vite.design.config.ts:20-29` 各加一个：

```ts
const externalJitiPlugin: Plugin = {
  name: 'telegraph-external-jiti',
  enforce: 'pre',
  resolveId(source) {
    if (source === 'jiti' || source.startsWith('jiti/')) {
      return { id: source, external: true }
    }
    return null
  },
}
```

要点：

- **`enforce: 'pre'`**：在 vite 自身 resolve 管道之前跑，避免其他 plugin 把 jiti 重新内化
- **走 plugin 而非 `rollupOptions.external`**：plugin 数组在 forge mergeConfig 时是 concat 而非 override，能稳定生效
- **保留 `isExternal` 函数的 jiti 分支作 fallback**（`vite.chat.config.ts:55-60`）：万一未来 forge 修了 mergeConfig 行为，函数仍能兜底；两层护栏防不同失败模式

并把 `jiti ^2.4.2` 提升为 `apps/main/package.json` 的一等 runtime dep，让 electron-forge 打包必定带它（不依赖 pnpm hoist 路径）。

### 3.4 Per-host alias map helper

新建 `apps/main/src/application/node/extension-aliases.ts:33-49`：

```ts
export function buildExtensionAliasMap(): Record<string, string> {
  const monorepoRoot = resolveMonorepoRoot()
  const pkgSrc = (name: string) => resolve(monorepoRoot, 'packages', name, 'src')
  return {
    '@/packages/agent-protocol': pkgSrc('agent-protocol'),
    '@/packages/agent-capabilities': pkgSrc('agent-capabilities'),
    '@/packages/agent-extensions': pkgSrc('agent-extensions'),
    '@/packages/agent-resources': pkgSrc('agent-resources'),
    '@/packages/computer-use-protocol': pkgSrc('computer-use-protocol'),
    '@/packages/computer-use': pkgSrc('computer-use'),
    '@/packages/orchestrator-core': pkgSrc('orchestrator-core'),
    // 最宽前缀最后写仅是行文习惯，jiti 按 segment 数排序，源码顺序无影响
    '@/packages/agent': pkgSrc('agent'),
  }
}
```

`resolveMonorepoRoot()`（`extension-aliases.ts:51-69`）从 `__dirname`（运行时是 `apps/main/.vite/preload/<chunk>.js`）向上走最多 6 层找 `pnpm-workspace.yaml`，找不到直接 throw 让事故立刻可见。

**为何这个 helper 放 `apps/main` 而不是 `packages/agent-extensions`**：
- alias map 是宿主项目特征（要镜像 `apps/main` 的 vite `resolve.alias` 与 chat/design tsconfig `paths`）
- `packages/agent-extensions` 必须保持通用、可被其他宿主复用
- chat / design 的 tsconfig 都 alias 了 `@/apps/main/*`，import 该 helper 无障碍

### 3.5 Worker 接线

`apps/chat/src/application/node/ChatPageletWorker.ts:391-410` 与 `apps/design/src/application/node/DesignPageletWorker.ts:185-195` 在构造 `ExtensionHost` 时传入 `aliases: buildExtensionAliasMap()`，chat 额外通过 `onLifecycleEvent` 把 activation_failed / deactivation_failed 打到 stderr（成功 activation 保持安静），避免又一次 30 分钟黑屏调试。

## 4. 回归验证

| 验证项 | 命令 / 步骤 | 结果 |
|---|---|---|
| 单测 | `pnpm --filter @telegraph/agent-extensions test` | **20/20**，含新增 disk-based TypeScript regression（写真实 `index.ts` + sibling `helper.ts`，断言 `activateFromPath` 无 diagnostics） |
| chat 单测 | `pnpm --filter @telegraph/chat test` | **71/71**，typecheck clean |
| design 单测 | `pnpm --filter @telegraph/design test` | **158/158**（3 个 pre-existing skipped）；typecheck baseline 错误同回归前 |
| main typecheck | `pnpm --filter @telegraph/main typecheck` | 同 baseline，无新增 |
| 集成 smoke | `pnpm start` 启动后观察 chat-worker / design-worker stderr，触发 todo / bookmark / subagents / completion-notify 各一次 | 三类错误全部消失；todo card / `/bookmark` slash command / subagents fan-out / completion notification 全部正常 |
| Bundle 体积 | `npx vite build --config apps/main/vite.chat.config.ts` 对比 jiti external 前后 | 主 chunk 从 1238 KB → 567 KB |

## 5. 复发排查清单

如果未来 extension 又突然 activate 失败：

1. **是 `ERR_MODULE_NOT_FOUND` on 相对 import？** → 检查 `ExtensionHost` 默认 importer 是否仍走 jiti（`packages/agent-extensions/src/ExtensionHost.ts:224` `sharedJiti` 还在）
2. **是 `Cannot find module '../dist/babel.cjs'`？** → 检查 chat / design 两份 vite config 的 `externalJitiPlugin` 还在不在；运行一次 `grep -l "createJiti" apps/main/.vite/preload/*.js` 确认 jiti 没被重新内联
3. **是 `Cannot find module '@/packages/<X>'`？** → 检查 `apps/main/src/application/node/extension-aliases.ts` 的 `buildExtensionAliasMap()` 是否包含 `<X>`；新增 first-party package 时这份 map 要一起加
4. **`resolveMonorepoRoot` throw？** → 看 throw message 里的 `__dirname`，forge 若改了 preload 输出层级（当前 4 层）需要调上限 6 层
5. **是 jiti alias 没匹配（路径"长得对"但仍找不到）？** → 大概率是误踩 path-segment boundary 规则；`@/packages/agent` vs `@/packages/agent-protocol` 不会互相匹配，添加新 package 时优先用完整路径而非依赖最长前缀

## 6. 教训

- **`@electron-forge/plugin-vite` 的 mergeConfig 是已知坑**：任何把 user `rollupOptions.external` 写成函数的写法都可能被静默丢弃。需要 external 一个 package 时优先走 rollup plugin 的 `resolveId` 返回 `{ external: true }`
- **诊断 forge / vite "config 没生效"的标准三段套路**：
  1. top-level 副作用（`console.log` 放文件最外层）证明 config 是否被 import
  2. 改 `chunkFileNames` 让产物 hash 必变，证明 `rollupOptions.output` 是否被消费
  3. 在目标函数内打日志，证明函数是否被实际调用
  三者对比能精准定位 forge 在 merge 哪个字段时把 user 写法吞了
- **Node 25 type-stripping 不是 transpile，是去注解**：模块解析行为完全不变，bundler-style 写法在它面前没有任何宽容；要么写完整后缀，要么过 jiti / tsx 这类 loader
- **jiti 必须显式喂 alias**：与 vite / tsconfig 是两套世界，extension 跑在 jiti 下时宿主项目要负责把 alias map 桥过去
- **per-instance jiti 取舍**：jiti construction 时 freeze options，alias 必须 per-host 新建；但默认 case 仍要共享 singleton 避免重复付出 babel parser 启动成本
- **失败要打出来**：`ExtensionHost.onLifecycleEvent` 默认静默是为了 "一个 bad extension 不能 brick pagelet"（RFC §8.3 Red Flag #4），但宿主必须自己挂 listener 把 failure 打到 stderr，否则又会上演 30 分钟黑屏

## 7. 涉及文件清单

### 改动
- `packages/agent-extensions/src/ExtensionHost.ts:47-69, 217-235` — sharedJiti 单例 + per-host aliased jiti + importer 签名换路径
- `packages/agent-extensions/src/types.ts:66-90` — `importer` 签名 doc + `aliases` 新字段 doc
- `packages/agent-extensions/src/__tests__/ExtensionHost.test.ts:255-330` — disk-based TS regression 重写
- `apps/main/vite.chat.config.ts:12-60` — `externalJitiPlugin` + `isExternal` 双重护栏 + 长 comment
- `apps/main/vite.design.config.ts:12-36` — 对应改动 + 指向 chat 的引用 comment
- `apps/main/package.json` — `jiti ^2.4.2` 升级为 runtime dep
- `apps/chat/src/application/node/ChatPageletWorker.ts:383-410` — `aliases: buildExtensionAliasMap()` + `onLifecycleEvent` stderr 桥
- `apps/design/src/application/node/DesignPageletWorker.ts:183-197` — 对应接线

### 新建
- `apps/main/src/application/node/extension-aliases.ts` — `buildExtensionAliasMap()` + `resolveMonorepoRoot()`

### 相关 commit
- `271a5d5` `feat(agent-extensions): load extension factories through jiti to support TypeScript sources and host-project aliases`
- `83497e8` `feat(main,chat,design): keep jiti external in pagelet bundles and supply host alias map at activation`
