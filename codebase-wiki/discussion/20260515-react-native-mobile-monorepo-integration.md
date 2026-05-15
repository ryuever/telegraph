---
id: D-010
title: React Native Mobile 接入 Monorepo 调研（目录结构 + 跨平台共享策略）
description: >
  在 telegraph 现有 Electron + pnpm monorepo 基础上接入 React Native (Expo) 移动端，
  调研可共享 / 不可共享的包边界、推荐目录结构、NativeWind vs Tamagui 选型、
  Metro + pnpm monorepo 配置要点，以及可借鉴的开源项目（Bluesky / Solito / Tamagui starter）。
category: discussion
created: 2026-05-15
updated: 2026-05-15
tags: [react-native, expo, mobile, monorepo, cross-platform, nativewind, tamagui, solito]
status: draft
references:
  - id: D-009
    rel: derived-from
    file: ./20260515-renderer-spa-framework-selection.md
    note: D-009 确定了 desktop renderer 的 React Router v7 + PageletHost 方案，本文在 renderer 之上扩展 mobile 端
  - id: A-008
    rel: related-to
    file: ../architecture/20260509-telegraph-final-process-architecture.md
    note: A-008 定义了 desktop 多进程拓扑（ConnectionOrchestrator / Pagelet / UtilityProcess），mobile 端不走该拓扑，需要独立的 API client 层
  - id: D-004
    rel: related-to
    file: ./20260506-electron-multi-renderer-vs-single-renderer.md
    note: D-004 确定了 desktop 单 renderer 路线，mobile 则是完全独立的 RN 应用
sources:
  - title: "Bluesky Social App (RN + Web)"
    url: "https://github.com/bluesky-social/social-app"
  - title: "Solito — RN + Next.js unified"
    url: "https://github.com/nandorojo/solito"
  - title: "Tamagui — cross-platform UI"
    url: "https://github.com/tamagui/tamagui"
  - title: "Expo monorepo guide"
    url: "https://docs.expo.dev/guides/monorepos/"
  - title: "NativeWind v4"
    url: "https://www.nativewind.dev/"
---

# React Native Mobile 接入 Monorepo 调研（目录结构 + 跨平台共享策略）

> 在 D-009 确定 desktop renderer 采用 React Router v7 + PageletHost 之后，telegraph 需要扩展
> 到移动端。本文调研如何在现有 Electron + pnpm monorepo 基础上接入 React Native (Expo)，
> 核心问题是：**哪些代码能跨平台共享、哪些必须重写、目录结构怎么组织**。

## 1. 现有包的可共享性分析

| 包 | 可共享？ | 原因 |
|---|---|---|
| `packages/runtime-contracts` | ✅ 完全可共享 | 纯 TypeScript 类型定义（`RunInput` / `RuntimeEvent` / tool / extension types），零平台依赖 |
| `packages/stores` | ✅ 可共享 | Zustand 是 RN 兼容的；store 定义和核心逻辑可复用 |
| `packages/agent` | ⚠️ 部分 | harness / runtime 抽象层可共享，但 pi-ai 调用在 mobile 端走 HTTP 而非 Electron IPC |
| `packages/services` | ❌ 不可共享 | 深度绑定 Electron（`ConnectionOrchestrator` / `MessagePort` / `UtilityProcess` / `parentPort`） |
| `packages/ui` | ❌ 不可共享 | shadcn + Radix UI + Tailwind + DOM（`<div>` / `className` / `ref`），RN 无法渲染 |
| `apps/*/application/browser/` | ⚠️ 逻辑可参考 | UI 层必须重写，但数据流 / 业务逻辑可以抽取到共享包 |
| `apps/*/application/node/` | ❌ 不可共享 | 跑在 Electron UtilityProcess 里，mobile 没有 utility process |

**核心结论**：类型和状态可以共享，UI 和 IPC 层必须各写一套。需要一个**服务接口抽象层**来弥合 desktop RPC 与 mobile HTTP 的差异。

## 2. 推荐目录结构

```
telegraph/                                 # monorepo root
├── apps/
│   ├── telegraph/                         # Electron 桌面端（现有，不动）
│   │   └── ...                            # main / preload / renderer / design utility
│   │
│   ├── mobile/                            # ← 新增：Expo React Native 应用
│   │   ├── app/                           # Expo Router (file-based routing)
│   │   │   ├── (tabs)/                    # 底部 tab 布局
│   │   │   │   ├── _layout.tsx            # TabNavigator：chat / design / setting
│   │   │   │   ├── chat.tsx
│   │   │   │   ├── design.tsx
│   │   │   │   └── setting.tsx
│   │   │   ├── _layout.tsx                # Root layout (providers + DI)
│   │   │   └── +not-found.tsx
│   │   ├── src/
│   │   │   ├── features/                  # 功能模块（与 desktop apps/ 对齐但独立 UI）
│   │   │   │   ├── chat/
│   │   │   │   │   ├── components/        # RN 版 chat 组件（FlatList / GiftedChat 等）
│   │   │   │   │   └── hooks/             # 复用 shared hooks + mobile 特有逻辑
│   │   │   │   └── design/
│   │   │   ├── services/                  # mobile 端 API client
│   │   │   │   ├── api-client.ts          # HTTP/WebSocket client（不走 ConnectionOrchestrator）
│   │   │   │   └── service-registry.ts    # 注入 mobile impl 的 IChatService / IDesignService
│   │   │   └── theme/                     # NativeWind (Tailwind for RN) 配置
│   │   ├── app.json
│   │   ├── metro.config.js               # Metro 配置 watchFolders 指向 monorepo 包
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   ├── chat/                              # 现有 desktop pagelet（不动）
│   ├── design/                            # 现有 desktop pagelet（不动）
│   ├── connection/                        # 现有 desktop pagelet（不动）
│   ├── monitor/                           # 现有 desktop pagelet（不动）
│   ├── setting/                           # 现有 desktop pagelet（不动）
│   ├── shared/                            # 现有 desktop shared process（不动）
│   ├── daemon/                            # 现有 desktop daemon process（不动）
│   └── main/                              # 现有 desktop main process（不动）
│
├── packages/
│   ├── ui/                                # 现有：shadcn/Tailwind（仅 web/desktop）
│   │   └── ...
│   │
│   ├── ui-native/                         # ← 新增：RN 共享组件（NativeWind + 自定义）
│   │   ├── src/
│   │   │   ├── components/                # 跨平台 primitives（Button / Card / Input / Avatar…）
│   │   │   ├── theme/                     # design tokens（颜色、间距、字体）→ 与 packages/ui 对齐
│   │   │   └── index.ts
│   │   ├── nativewind.config.ts
│   │   └── package.json
│   │
│   ├── shared/                            # ← 新增：纯逻辑共享层（零 UI 依赖）
│   │   ├── src/
│   │   │   ├── types/                     # 从 runtime-contracts 重新导出 + mobile 扩展
│   │   │   ├── hooks/                     # 平台无关的 React hooks
│   │   │   │   ├── useChatSession.ts      # 依赖注入：desktop 走 RPC，mobile 走 HTTP
│   │   │   │   └── useDesignProjects.ts
│   │   │   ├── stores/                    # 从 packages/stores 重新导出或迁入
│   │   │   └── services/                  # 服务接口抽象层
│   │   │       ├── interfaces.ts          # IChatService / IDesignService / ISettingService
│   │   │       ├── desktop-impl.ts        # desktop: directChannelClient → RPC
│   │   │       └── mobile-impl.ts         # mobile: fetch / WebSocket
│   │   └── package.json
│   │
│   ├── runtime-contracts/                 # 现有：不变
│   ├── agent/                             # 现有：部分可复用
│   ├── stores/                            # 现有：中期可迁入 shared/stores
│   └── services/                          # 现有：Electron 专属，mobile 不用
│
├── pnpm-workspace.yaml                    # 无需改动（apps/* + packages/* 已覆盖新增目录）
└── ...
```

## 3. 服务接口抽象层设计

desktop 的 pagelet 通过 `ConnectionOrchestrator` + `directChannelClient` 做 RPC；mobile 没有 utility process，需要走 HTTP API。抽象层是两个平台共享业务逻辑的关键。

```typescript
// packages/shared/src/services/interfaces.ts

export interface IChatService {
  listSessions(): Promise<ChatSession[]>;
  sendMessage(sessionId: string, content: string): Promise<void>;
  onMessage(callback: (msg: Message) => void): () => void;  // 返回 unsubscribe
}

export interface IDesignService {
  listProjects(): Promise<DesignProject[]>;
  // ...
}
```

```typescript
// packages/shared/src/services/desktop-impl.ts
// desktop 实现：走 ConnectionOrchestrator RPC

import { directChannelClient } from '@/apps/main/src/services/connection-orchestrator/browser/...';

export class DesktopChatService implements IChatService {
  async listSessions() {
    return directChannelClient('chat').invoke('listSessions');
  }
  async sendMessage(sessionId: string, content: string) {
    return directChannelClient('chat').invoke('sendMessage', { sessionId, content });
  }
  onMessage(callback: (msg: Message) => void) {
    const sub = directChannelClient('chat').on('message', callback);
    return () => sub.dispose();
  }
}
```

```typescript
// apps/mobile/src/services/mobile-impl.ts
// mobile 实现：走 HTTP + WebSocket

const API_BASE = 'https://api.telegraph.ai';  // 或环境变量

export class MobileChatService implements IChatService {
  async listSessions() {
    return fetch(`${API_BASE}/chat/sessions`).then(r => r.json());
  }
  async sendMessage(sessionId: string, content: string) {
    return fetch(`${API_BASE}/chat/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  }
  onMessage(callback: (msg: Message) => void) {
    const ws = new WebSocket(`${WS_BASE}/chat/stream`);
    ws.onmessage = (e) => callback(JSON.parse(e.data));
    return () => ws.close();
  }
}
```

```typescript
// packages/shared/src/hooks/useChatSession.ts
// 共享 hook：只依赖接口，不依赖平台

import { useContext } from 'react';
import { ChatServiceContext } from '../services/context';
import type { IChatService } from '../services/interfaces';

export function useChatSession(sessionId: string) {
  const chatService = useContext(ChatServiceContext) as IChatService;
  // ... 用 chatService 做数据获取、订阅等
}
```

desktop renderer 和 mobile app 各自在根 Provider 里注入不同的 impl：

```tsx
// desktop renderer (apps/telegraph/src/index.tsx)
<ChatServiceProvider value={new DesktopChatService()}>
  <PageletHost />
</ChatServiceProvider>

// mobile app (apps/mobile/app/_layout.tsx)
<ChatServiceProvider value={new MobileChatService()}>
  <Slot />
</ChatServiceProvider>
```

## 4. UI 跨平台方案选型

### 4.1 NativeWind v4（推荐）

| 维度 | 评价 |
|---|---|
| 与现有 Tailwind 的对齐度 | **极高**——同一个 `className="bg-red-500 p-4"` 语法，desktop 渲染为 DOM CSS，mobile 渲染为 RN StyleSheet |
| 学习成本 | 低——你已经用 Tailwind 了 |
| 生态 | Expo 官方推荐，v4 已稳定 |
| 限制 | 不支持 Radix UI 的 `data-*` 状态选择器；某些 CSS 特性（grid / container queries）在 RN 不可用 |

### 4.2 Tamagui（不推荐作为主选）

| 维度 | 评价 |
|---|---|
| 理论优势 | 一套组件编译到 web (div + CSS) + native (View + StyleSheet)，有优化编译器 |
| 现实问题 | 1) 你现有 `packages/ui` 已深度绑定 shadcn + Radix + Tailwind，迁移成本极高；2) Tamagui 的 styled API 与 Tailwind 心智模型冲突；3) v2 仍在 rc 阶段 |
| 适用场景 | **全新项目**可以从 Tamagui 起步；存量项目迁移 ROI 太低 |

### 4.3 为什么不尝试 react-native-web 统一

`react-native-web` 可以让 RN 组件在 web 端渲染，但：
- 你 desktop renderer 已经是成熟的 React + Tailwind 生态，倒退到 RN 写法没有收益。
- RN 组件在 web 端的性能和可访问性不如原生 DOM。
- 你的 desktop 需求（Electron 主进程 / preload / utility process）RN 完全无法覆盖。

**结论**：mobile 和 desktop **各写各的 UI**，通过 `packages/shared/` 共享逻辑，通过 `packages/ui-native/` 共享 RN 组件库。这是最务实的路线。

## 5. Metro + pnpm Monorepo 配置

```javascript
// apps/mobile/metro.config.js
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 让 Metro 能解析 monorepo 里的 packages
config.watchFolders = [monorepoRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// pnpm 特有：处理 symlink 解析
config.resolver.disableHierarchicalMkdirs = true;

module.exports = config;
```

**已知坑**：
1. pnpm 的 symlink 结构与 Metro 的默认模块解析有冲突——`disableHierarchicalMkdirs` 是必须的。
2. 如果 shared 包引用了 RN 不兼容的模块（如 `electron`），需要用 Metro `resolver.resolveRequest` 做平台条件导出，或者在 `package.json` 的 `exports` 字段用 `react-native` condition。
3. `tsconfig.json` 的 paths alias 在 Metro 中不生效，需要用 `babel-plugin-module-resolver` 或 Metro `resolver.extraNodeModules` 映射。

## 6. 可借鉴的开源项目

### 6.1 Bluesky Social App

- 仓库：<https://github.com/bluesky-social/social-app>
- 场景：RN app (iOS + Android) + Web，共享业务逻辑。
- 目录结构：`src/` 按 feature 分目录，`view/com/` 放 RN 组件，`web/` 放 web 版。
- 借鉴点：feature 目录组织方式、跨平台 hook 抽象模式。
- 注意：Bluesky 不是 monorepo（单 package 结构），目录组织方式可参考但不完全适用。

### 6.2 Solito Example Monorepo

- 仓库：<https://github.com/nandorojo/solito/tree/master/example-monorepos>
- 场景：RN (Expo) + Next.js monorepo，共享代码放在 `packages/app/`。
- 目录结构：
  ```
  apps/expo/       → Expo RN 应用
  apps/next/       → Next.js web 应用
  packages/app/    → 共享代码（components / features / provider）
  ```
- 借鉴点：**最值得抄的 monorepo 结构**——把 `packages/app` 换成你的 `packages/shared` + `packages/ui-native`，把 `apps/next` 换成 `apps/telegraph` 即可。
- Solito 本身提供 `useRouter()` 统一 RN Navigation 和 Next.js Router 的 hook——你在 desktop 用 React Router v7 (D-009)，可能需要一个类似的 router 抽象，但优先级不高。

### 6.3 Tamagui Starter Monorepo

- 仓库：<https://github.com/tamagui/tamagui/tree/main/code/starters>
- 场景：`npm create tamagui@latest` 生成的 monorepo 骨架。
- 目录结构：
  ```
  apps/next/       → Next.js
  apps/expo/       → Expo
  packages/app/    → 共享
  packages/ui/     → Tamagui 组件库
  ```
- 借鉴点：monorepo 骨架和包间依赖声明方式可以参考。
- 不建议引入 Tamagui 本身（见 §4.2）。

### 6.4 Expo 官方 Monorepo 指南

- 文档：<https://docs.expo.dev/guides/monorepos/>
- 重点关注：Metro 配置、pnpm 兼容性、`expo-yarn-workspaces` 替代方案、CI 构建。

## 7. 渐进式落地路线

### Phase 0 — 跑通空白 Expo App

- 创建 `apps/mobile/`，用 `npx create-expo-app` 初始化。
- 配置 `metro.config.js` 的 `watchFolders` 指向 monorepo root。
- 验证能 `import type { RuntimeEvent } from '@/packages/runtime-contracts'`。
- **验收标准**：`pnpm --filter mobile start` 能在模拟器里打开空白 App，Metro 无报错。

### Phase 1 — 共享逻辑层

- 创建 `packages/shared/`，定义 `IChatService` / `IDesignService` 接口。
- desktop 侧提供 `DesktopChatService` impl（包装现有 `directChannelClient`）。
- mobile 侧提供 `MobileChatService` impl（先用 mock 数据，后续接 HTTP API）。
- 迁移 `packages/stores` 中的核心 store 到 `packages/shared/stores`（或重新导出）。
- **验收标准**：`packages/shared/` 的 `typecheck` 通过，desktop renderer 不受影响。

### Phase 2 — Mobile UI 骨架

- 创建 `packages/ui-native/`，配置 NativeWind v4。
- 搭 `apps/mobile/app/(tabs)/` 的 chat / design / setting 页面骨架。
- 复用 `packages/shared/hooks/` 里的 hook 做数据获取。
- **验收标准**：mobile chat 页面能展示 mock 数据列表。

### Phase 3 — 接入真实后端

- mobile 的 `MobileChatService` 从 mock 切换到真实 HTTP / WebSocket API。
- 需要后端先暴露 HTTP 接口（这是独立的后端话题）。
- **验收标准**：mobile chat 能收发真实消息。

### Phase 4 — 深度共享

- 评估哪些 `packages/agent/` 的逻辑可以迁入 `packages/shared/`。
- 评估 desktop `apps/*/application/browser/` 中的业务逻辑是否值得抽取。
- `packages/ui/` 和 `packages/ui-native/` 的 design token 统一（颜色、间距、字体）。
- **验收标准**：两个平台视觉风格对齐，共享代码占比 > 40%。

## 8. 风险与不做的事

### 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| Metro + pnpm symlink 解析问题 | 高 | §5 已列出配置要点；遇到新问题参考 Expo 官方 monorepo guide |
| 共享层抽象过度（过早把 desktop 特有逻辑迁入 shared） | 中 | 遵循"先复制后抽象"原则——同一份逻辑在两个平台各写一遍，确认稳定后再抽取 |
| NativeWind v4 对某些 Tailwind 特性不支持 | 低 | 大部分常用特性已覆盖；不支持的降级为 RN StyleSheet |
| mobile 后端 API 未就绪 | 高 | Phase 1–2 用 mock 数据推进，不阻塞 UI 开发 |

### 不做的事

- **不做** Tamagui 统一 UI（§4.2 已论证）。
- **不做** react-native-web 统一（§4.3 已论证）。
- **不做** mobile 端的 ConnectionOrchestrator / UtilityProcess 适配——mobile 走 HTTP，不走 IPC。
- **不做** Solito router 统一——desktop 用 React Router v7 (D-009)，mobile 用 Expo Router，暂时各管各的。
- **不改动** 现有 `apps/` 和 `packages/` 的结构——mobile 是增量添加，不破坏现有架构。
