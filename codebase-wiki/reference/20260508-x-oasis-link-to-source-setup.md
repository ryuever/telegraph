---
id: R-001
title: x-oasis 本地 source link 配置手册（telegraph）
description: >
  把 telegraph workspace 的 4 个 app 全部指向本地 /Users/ryuyutyo/Documents/code/red/x-oasis/
  的 source（而非 dist）的完整步骤：上游 12 个包改 main 字段 + telegraph pnpm.overrides
  + 移除 vite external + tsconfig paths。
  
  ⚠️ **已过时**：项目已于 2026-05-09 切换回 npm 包版本，不再使用 link 方式。
category: reference
created: 2026-05-08
updated: 2026-05-09
tags: [x-oasis, pnpm, link, vite, tsconfig, monorepo, electron, setup]
status: archived
references:
  - id: P-003
    rel: derived-from
    file: ../roadmap/20260508-port-management-orchestrator-migration-plan.md
  - id: D-006
    rel: related-to
    file: ../discussion/20260508-x-oasis-orchestrator-capability-gaps.md
---

# x-oasis 本地 source link 配置手册（telegraph）

> 在 telegraph 重构 port management 的过程中，我们需要边迁移边补强 x-oasis 的
> `ConnectionOrchestrator`（详见 D-006），如果走 "改 x-oasis → 发版 → 升级 telegraph"
> 的常规路径，反复弹跳代价过高。本文给出一次性把所有 x-oasis 包都 link 到本地
> source 的方案，带 sourcemap 直接调试。

## 0. 前置假设

```
~/Documents/code/
├── modules/ai/telegraph/        ← 本仓库
└── red/x-oasis/                 ← x-oasis 上游仓库（同事/用户本地）
```

相对路径：`telegraph` → `x-oasis` = `../../../red/x-oasis`

## 1. 涉及的 12 个 x-oasis 包

### 4 个 async 包（核心）

| npm 名 | x-oasis 路径 |
|--------|--------------|
| `@x-oasis/async-call-rpc` | `packages/async/async-call-rpc` (v0.5.0) |
| `@x-oasis/async-call-rpc-electron` | `packages/async/async-call-rpc-electron` (v0.3.0) |
| `@x-oasis/async-call-rpc-node` | `packages/async/async-call-rpc-node` |
| `@x-oasis/async-call-rpc-web` | `packages/async/async-call-rpc-web` |

### 8 个 utility 包（async-call-rpc 的 workspace:* 依赖）

| npm 名 | x-oasis 路径 |
|--------|--------------|
| `@x-oasis/deferred` | `packages/promise/deferred` |
| `@x-oasis/disposable` | `packages/event/disposable` |
| `@x-oasis/emitter` | `packages/event/emitter` |
| `@x-oasis/id` | `packages/misc/id` |
| `@x-oasis/is-ascii` | `packages/assertion/is-ascii` |
| `@x-oasis/is-function` | `packages/assertion/is-function` |
| `@x-oasis/is-object` | `packages/assertion/is-object` |
| `@x-oasis/is-promise` | `packages/assertion/is-promise` |

## 2. 上游：把 12 个 package.json 的 main 字段指向 src

> ⚠️ 这一步会修改 x-oasis 上游仓库；请在 x-oasis 仓库内单独提一个 PR / 分支。
> 短期可以在 x-oasis 内本地改不提交。

每个 `package.json` 改成：

```jsonc
{
  "name": "@x-oasis/async-call-rpc-electron",
  "version": "0.3.0",
  "main": "src/index.ts",       // ← 原本是 "dist/index.js"
  "module": "src/index.ts",     // ← 同上
  "typings": "src/index.ts",    // ← 原本是 "dist/index.d.ts"
  "files": ["src", "dist"],     // 保留 dist 不影响发版
  // ...
}
```

**为什么必须改上游而不是只在 telegraph 用 tsconfig paths**：

- pnpm.overrides + link 协议时，consumer 解析模块走的是被 link 包的 `main` 字段
- vite / esbuild 在 main / fork bundle 时走 node 解析，也是 `main` 字段
- 单纯 tsconfig paths 只对 TS 类型解析有效，对运行时 / vite 无效

## 3. telegraph 顶层加 pnpm.overrides

编辑 `package.json`（仓库根）：

```jsonc
{
  "name": "telegraph-workspace",
  "private": true,
  "pnpm": {
    "overrides": {
      "@x-oasis/async-call-rpc": "link:../../../red/x-oasis/packages/async/async-call-rpc",
      "@x-oasis/async-call-rpc-electron": "link:../../../red/x-oasis/packages/async/async-call-rpc-electron",
      "@x-oasis/async-call-rpc-node": "link:../../../red/x-oasis/packages/async/async-call-rpc-node",
      "@x-oasis/async-call-rpc-web": "link:../../../red/x-oasis/packages/async/async-call-rpc-web",

      "@x-oasis/deferred": "link:../../../red/x-oasis/packages/promise/deferred",
      "@x-oasis/disposable": "link:../../../red/x-oasis/packages/event/disposable",
      "@x-oasis/emitter": "link:../../../red/x-oasis/packages/event/emitter",
      "@x-oasis/id": "link:../../../red/x-oasis/packages/misc/id",
      "@x-oasis/is-ascii": "link:../../../red/x-oasis/packages/assertion/is-ascii",
      "@x-oasis/is-function": "link:../../../red/x-oasis/packages/assertion/is-function",
      "@x-oasis/is-object": "link:../../../red/x-oasis/packages/assertion/is-object",
      "@x-oasis/is-promise": "link:../../../red/x-oasis/packages/assertion/is-promise"
    }
  }
}
```

> `link:` 协议路径是**相对于 telegraph 根 package.json**。
> overrides 会覆盖所有 4 个 app 的依赖（telegraph / chat / design / monitor 全部生效），
> 不需要每个 app 单独配置。

执行：

```bash
pnpm install
```

验证：

```bash
ls -la apps/telegraph/node_modules/@x-oasis/
# 应该看到所有 12 个包都是 symlink 指向 ../../../red/x-oasis/packages/...
```

## 4. 移除 vite external 规则

`apps/telegraph/vite.main.config.ts` 和 `apps/telegraph/vite.fork.config.ts` 当前都包含：

```ts
// 移除前
build: {
  rollupOptions: {
    external: [
      'electron',
      /@x-oasis\/async-call-rpc\/.*/,             // ← 删除
      /@x-oasis\/async-call-rpc-electron\/.*/,    // ← 删除
      // ...
    ]
  }
}
```

**为什么要移除**：

- link 到 source 后，包内是 `.ts` 文件而不是 `.js`
- 如果保留 external，运行时 node require 会失败（找不到 dist）
- 让 vite / esbuild 直接 bundle src，配合 sourcemap 调试

**潜在影响**：main / fork bundle 体积变大几百 KB，可接受。如果后续需要优化，
可以单独把 utility 包（is-* / deferred / disposable 等纯函数库）保留 external，
只 inline async-call-rpc 系列。

## 5. tsconfig paths 加 source 路径（IDE 跳转 / 类型推导）

在每个 app 的 `tsconfig.json` 加 `paths`：

```jsonc
// apps/telegraph/tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@x-oasis/async-call-rpc": ["../../../red/x-oasis/packages/async/async-call-rpc/src/index.ts"],
      "@x-oasis/async-call-rpc/*": ["../../../red/x-oasis/packages/async/async-call-rpc/src/*"],
      "@x-oasis/async-call-rpc-electron": ["../../../red/x-oasis/packages/async/async-call-rpc-electron/src/index.ts"],
      "@x-oasis/async-call-rpc-electron/*": ["../../../red/x-oasis/packages/async/async-call-rpc-electron/src/*"]
      // 其他 10 个包按需加
    }
  }
}
```

> `paths` 只影响 TS 类型解析，不影响运行时。配它的目的是让 VSCode "Go to Definition"
> 直接跳到 x-oasis src，而不是跳到 link 后的 .d.ts。

`apps/{chat,design,monitor}/tsconfig.json` 同样补上。

## 6. 启动验证

```bash
# 仓库根
pnpm install
pnpm start
```

成功标志：

- ✅ telegraph 启动正常，design panel 可见
- ✅ DevTools Sources 面板能看到 x-oasis 的 .ts 文件（带 sourcemap）
- ✅ 在 x-oasis src 任意文件加 `console.log` → 重启 telegraph → 日志立即出现
- ✅ `pnpm -r typecheck` 全绿

## 7. 工作流：边迁移边补强

```
┌──────────────────────────────────────────────┐
│ 1. 在 x-oasis src 中改代码（补 D-006 缺口）   │
│ 2. 在 telegraph 内 pnpm start 验证            │
│ 3. 验证通过 → 在 x-oasis 跑单元测试          │
│ 4. x-oasis 提 commit                          │
│ 5. 重复                                       │
│ 6. 全部跑通后 → x-oasis 发版 → telegraph 切回 │
│    semver 依赖                                │
└──────────────────────────────────────────────┘
```

## 8. 回滚方案

切回正式发版：

1. x-oasis 12 个包 `package.json` 恢复 `main: dist/index.js`
2. 在 x-oasis 跑 `pnpm -r build`
3. 在 x-oasis 跑 `pnpm -r publish`
4. telegraph 顶层 `package.json` 删除 `pnpm.overrides`
5. 各 app 的 `dependencies` 升级到新版本号
6. 恢复 `vite.main.config.ts` / `vite.fork.config.ts` 的 external 规则（可选）
7. `pnpm install`

## 9. 已知陷阱

| 陷阱 | 现象 | 解决 |
|------|------|------|
| 只改 main 不改 module | bundler 走 module 字段时仍指向 dist | 三个字段一起改 |
| pnpm.overrides 路径写错 | `pnpm install` 报 "ENOENT no such file" | 路径必须**相对于 link 目标的发起包**（即 telegraph 根 package.json） |
| 没移除 vite external | 运行时 `Cannot find module '@x-oasis/...'` | 检查两个 vite config |
| dist 与 src 类型 drift | `pnpm typecheck` 报奇怪的类型错误 | 在 x-oasis 跑一次 `pnpm -r build`，让 dist 与 src 一致；或彻底删 dist |
| Forge package 阶段失败 | 打 dmg 时找不到 .ts | Forge 阶段必须 build dist；或在 forge.config.ts 强制 inline |

## 10. 相关文档

- 本配置的需求来源：P-003 §2 决策表 + Phase 0
- 要补的 x-oasis 能力：D-006
- pnpm overrides 官方文档：https://pnpm.io/package_json#pnpmoverrides
