---
id: I-001
title: Chat 页面 Tailwind 未生效故障复盘
description: >
  记录 Telegraph 在 Electron Forge 开发模式下 chat 页面样式失效的问题，
  包含可见现象、根因分解、时间线、修复动作、回归验证与复发排查清单。
category: issue
created: 2026-05-04
updated: 2026-05-04
tags: [tailwind, vite, electron-forge, cache, postcss, incident, regression]
status: final
---

# Chat 页面 Tailwind 未生效故障复盘

> 本文沉淀 2026-05-04 的一次前端样式故障：`#/chat` 页面长期表现为“深色背景 + 近乎无样式文本”。
> 目标是为后续同类问题提供快速定位模板。

## 现象（Symptoms）

- 打开应用首页后点击 `Open Chat`（`#/chat`），聊天页结构存在，但 Tailwind 样式未呈现。
- Network 中 `renderer.css` 常见为 `304`，切换 hash 路由（`#/chat`）时无新增关键请求。
- 用户体感是“页面能跳转，但像没加载 Tailwind”。

## 影响范围（Impact）

- 仅影响 renderer UI 的视觉呈现，业务逻辑（路由、会话、发送）大体可运行。
- 影响调试效率：问题表象像 Tailwind 配置失效，但真实原因包含“错误 dev server 被连接”与“旧缓存复用”。

## Issue 元信息（Issue Meta）

- 严重级别：`S2`（主要功能可用，核心体验明显受损）
- 状态：`resolved`
- 首次发现时间：2026-05-04 11:20（UTC+8）
- 关闭时间：2026-05-04 12:06（UTC+8）

## 环境指纹（Environment Fingerprint）

- OS：macOS Darwin 25.4.0
- 运行形态：Electron Forge + Vite renderer dev server
- 关键端口：Forge renderer `5173`，standalone dev `5174`
- 关键路由：`#/chat`

## 根因（Root Cause）

本次属于“多因素叠加”，按优先级拆分如下。

### 1) 直接触发因：Electron 误连旧 Vite 实例（端口 5173）

- Electron Forge renderer 默认使用 `5173`。
- 本机存在历史 `vite` 进程也占用 `5173`，其 `renderer.css` 内容不包含 chat 关键类（例如 `bg-zinc-950`）。
- 结果：应用启动看似正常，但拿到的是“错误实例”的 CSS，造成样式缺失。

### 2) 放大因：样式扫描链路在不同启动方式下不够稳健

- 仅目录级 `@source` 在不同运行上下文中排查成本高，不易快速确认扫描边界。
- 将 `@source` 改为显式 glob 后，能够稳定覆盖 `apps/telegraph/src` 与 `packages/ui/src` 的 `ts/tsx` 类名来源。

### 3) 辅助因：HTTP 缓存让问题表现更顽固

- `renderer.css` 出现 `304` 时，旧内容会被持续复用，导致“明明改了配置但页面不变”的错觉。

## 时间线（UTC+8）

| 时间 | 事件 |
|---|---|
| 11:20 左右 | 发现 `pnpm dev` 提示 `Port 5173 is in use`，自动切到其他端口。 |
| 12:03 左右 | 首次 `pnpm --filter telegraph start` 拉起 Forge，显示 renderer `http://127.0.0.1:5173/`。 |
| 12:03-12:04 | 对 `localhost:5173/src/renderer.css` 抽样检查，chat 关键类计数为 0（异常）。 |
| 12:04 左右 | 手动清理旧 `5173` 进程后重启 Forge。 |
| 12:04 之后 | 再次检查 `localhost:5173/src/renderer.css`，chat 关键类恢复（如 `bg-zinc-950`、`rounded-tr-md` 等非 0）。 |
| 12:06 左右 | 用户确认“样式好了”。 |

## 修复动作（Changes Applied）

### A. 提升 Tailwind 扫描确定性

- 文件：`apps/telegraph/src/renderer.css`
- 动作：将 `@source` 改为显式路径模式：
  - `apps/telegraph/index.html`
  - `apps/telegraph/src/**/*.{ts,tsx}`
  - `packages/ui/src/**/*.{ts,tsx}`
  - `packages/stores/src/**/*.{ts,tsx}`

### B. 避免 dev/forge 端口混淆

- 文件：`apps/telegraph/vite.renderer.config.ts`
- 动作：
  - 增加端口策略：Forge 使用 `5173`，`mode=standalone` 使用 `5174`
  - 开启 `strictPort: true`
  - 保留 dev 阶段 `Cache-Control: no-store`

- 文件：`apps/telegraph/package.json`
- 动作：`dev` 脚本改为 `vite --mode standalone`（主动避开 Forge 端口）。

### C. 保持 CSS 注入路径单一

- 文件：`apps/telegraph/src/index.tsx`
- 动作：通过 `import './renderer.css'` 作为 renderer 样式入口，减少链路歧义。

## 验证方法（How to Verify）

1. 关闭旧进程后启动：`pnpm --filter telegraph start`
2. 访问 `#/chat`
3. 在 DevTools Network 打开 `renderer.css` 响应体，确认包含：
   - `bg-zinc-950`
   - `rounded-tr-md`
   - `max-w-3xl`
4. 若命中以上类名且页面视觉正常，则修复生效。

## 预防措施（Preventive Actions）

- 将 `pnpm dev` 与 Forge renderer 分端口并开启 `strictPort`，防止“误连旧进程”。
- 将 `@source` 改为显式 glob，降低扫描不确定性。
- 在 wiki 的 issue 归档模板中固定“验证方法 + Runbook”章节，缩短下次排查时间。

## 复发排查清单（Runbook）

当再次出现“chat 无样式”时，按顺序执行：

1. 检查端口占用：是否有旧 `vite` 占据 `5173`。
2. 确认 Electron 连接的 renderer 地址是否为本次启动的实例。
3. 直接检查 `renderer.css` 响应体是否包含 chat 关键类名。
4. 清理该 dev origin 的缓存/存储后重启应用。
5. 若类名仍缺失，回看 `renderer.css` 的 `@source` 与 `postcss` 入口是否被改动。
