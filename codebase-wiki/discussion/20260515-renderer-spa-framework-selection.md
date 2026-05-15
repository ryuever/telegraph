---
id: D-009
title: Renderer SPA 框架选型（React Router v7 + 自实现 KeepAlive）
description: >
  从 telegraph "侧边栏多入口 / 切换不丢状态 / 路由级 lazy" 的真实诉求出发，
  对 Remix、Next.js、React Router v7、TanStack Router 做选型对比，最终决定
  采用 Vite + React Router v7 (data mode, SPA) + 自实现 PageletHost 的 KeepAlive
  方案，并说明它与 A-008 ConnectionOrchestrator + Pagelet 后端拓扑的协作方式。
category: discussion
created: 2026-05-15
updated: 2026-05-15
tags: [renderer, react, react-router, remix, keep-alive, spa, vite, tech-selection]
status: draft
references:
  - id: A-008
    rel: extends
    file: ../architecture/20260509-telegraph-final-process-architecture.md
    note: A-008 §6 提到 "Chat/Design 通过路由切换或 BrowserView 叠加由 WindowManager 决定"，本文补齐路由层选型并坚定走"单 BrowserWindow + 单 SPA + KeepAlive"路线。
  - id: D-004
    rel: derived-from
    file: ./20260506-electron-multi-renderer-vs-single-renderer.md
    note: D-004 已确认走单 renderer 路线，本文是单 renderer 路线下的前端框架细化。
  - id: A-010
    rel: related-to
    file: ../architecture/20260513-vscode-contribution-model-for-telegraph.md
    note: A-010 提出 TelegraphManifest 声明式贡献模型，本文 PageletHost 的 pagelet 注册表是其在 renderer 侧的最小落点。
  - id: D-010
    rel: derives
    file: ./20260515-react-native-mobile-monorepo-integration.md
    note: D-010 在本文 desktop renderer 选型基础上扩展 mobile RN 端，提出 packages/shared 服务接口抽象层
---

# Renderer SPA 框架选型（React Router v7 + 自实现 KeepAlive）

> 在 D-004 确定 "Electron 单 renderer + 多 pagelet utility process" 后，renderer 侧仍需要选定一个前端框架来承载 Chat / Design / Setting / Monitor / Connection 等多入口。本文记录该选型的诉求、候选方案、对比与最终决策。

## 1. 真实诉求

| # | 诉求 | 含义 | 对框架的要求 |
|---|------|------|--------------|
| R1 | 主体是单一 React App | 所有 pagelet 入口共享同一份 BrowserWindow / 同一颗 React 树 | 不需要 SSR；不需要多页面构建 |
| R2 | 侧边栏多入口（chat / design / setting / monitor / connection / home） | 入口数量**有限且可枚举**（5 ~ 10 个） | 路由系统要支持嵌套与 lazy |
| R3 | **切换 chat → design → chat 时 chat 内容必须不丢** | 页面切换不能 unmount，要保留组件 state、scroll、未提交的输入框、长连接订阅等 | **路由级 KeepAlive** |
| R4 | 路由级 lazy loading | 首次访问 design 才下载它的 chunk | `React.lazy()` / dynamic import |
| R5 | 不要 Next.js 这种重生态 | 不要 RSC、不要 server actions、不要 `app/` 目录强约定 | 排除全栈框架 |
| R6 | 每个入口逻辑上对应一个 pagelet utility process | UI 层的"loader"实质是对 ConnectionOrchestrator direct channel RPC 的薄包装 | **不需要服务端 loader**，纯客户端 data fetching 即可 |

> **关键洞察**：R3 是真正的难点；R1/R2/R4 任何框架都能做；R5/R6 排除掉全栈框架。

## 2. 候选方案盘点

### 2.1 Remix v2

**结论：不推荐。**

- Remix 设计前提是 SSR + 服务端 loader。Electron 里没有真服务端，要么把 handler 搬到 main 进程（`itsMapleLeaf/remix-electron` 模式，复杂），要么用 `ssr: false` 退化成 SPA——退化后 Remix 的核心价值就剩一半。
- **Remix 不解决 KeepAlive**——它的 `<Outlet>` 切换路由时组件照样 unmount。
- 更要命的是 **Remix v2 已经合并进 React Router v7**，Remix 团队官方建议新项目直接用 React Router v7 framework mode，Remix 这个 brand 在淡出。

### 2.2 Next.js

**结论：用户已排除。**

RSC / server actions / `app/` 全家桶对一个 Electron 桌面 SPA 是过度设计；构建产物大、生态绑定紧、与 Electron 主进程协作笨拙。

### 2.3 React Router v7（data mode, SPA）

**结论：✅ 推荐主选。**

- React Router v7 把 Remix 的 data API（`loader` / `action` / `useLoaderData` / `<Form>` / 错误边界 / pending UI）抽出来，**可以纯客户端使用**，没有 SSR 包袱。
- 与 Vite 6 的官方集成完善，HMR 快。
- 生态最大，文档最完善，团队熟悉度最高。
- Loader 内部直接调 `directChannelClient.invoke('IDesignService', 'listProjects')`，完美匹配 telegraph 的 RPC 模型（见 A-008 §6）。
- **同样不解决 KeepAlive**——但这是 React 全社区的共同问题，与是否用 RR v7 无关。

### 2.4 TanStack Router

**结论：备选，类型安全更强但生态偏小。**

- 路由类型推导是目前 React 生态最强的（end-to-end type-safe routing）。
- 内置 query cache / preload / infinite loaders，开箱即用程度高于 RR v7。
- 缺点：社区规模仍明显小于 RR；KeepAlive 同样需要自己实现；与 Vite 的协同没有 RR v7 那么"官方"。
- 适合**类型偏执项目**或团队愿意为类型红利投入学习成本。telegraph 当前优先级不在这里。

### 2.5 综合对比表

| 维度 | Remix v2 | Next.js (App Router) | **React Router v7 (SPA)** | TanStack Router |
|------|----------|----------------------|----------------------------|-----------------|
| 本质 | RR v7 + 约定 + SSR | 全栈框架 | 官方路由库 | 第三方路由库 |
| Loader/Action | ✅（需服务端） | ✅ RSC | ✅（纯客户端可用） | ✅（不同 API） |
| KeepAlive | ❌ 自己搞 | ❌ 自己搞 | ❌ 自己搞 | ❌ 自己搞 |
| 类型安全 | 中 | 中 | 中 | **强** |
| Electron 友好度 | 中（SSR 包袱） | 低（RSC 假设） | **高** | 高 |
| 生态规模 | 大（在收敛） | 最大 | **最大** | 小但活跃 |
| 学习成本 | 中 | 高 | 低 | 中 |
| 是否被官方推荐为 Remix 后继 | — | — | ✅ | — |

## 3. KeepAlive 方案对比

KeepAlive 是 Vue 内置的能力，React 官方一直没有等价物（实验性 `<Activity>` / `<Offscreen>` 仍不稳定）。社区主流方案如下：

### 3.1 `react-activation`

- GitHub: <https://github.com/CJY0208/react-activation>
- 模拟 Vue `<KeepAlive>`，提供 `<KeepAlive>` 组件和 `useActivate` / `useUnactivate` 生命周期 hook。
- 内部使用 portal + 自定义 fiber 操作来"摘除"和"挂回" subtree。
- 优点：API 直观，最贴近 Vue 心智模型。
- 缺点：**有黑魔法**——portal 跨树移动 fiber 的方案与 React 18 concurrent 模式偶有兼容性问题；React DevTools 树视图错位；遇到 Suspense / Error Boundary 边界 case 调试困难。

### 3.2 React 18.3+ 实验性 `<Activity>`

- 原 `<Offscreen>`，2025 年初改名为 `<Activity>`。
- 官方方向，但 API、文档、生态都还不稳。
- **当前不建议在生产路线上押注。**

### 3.3 自实现 PageletHost（display 切换）✅

```tsx
// PageletHost.tsx
const pagelets = [
  { id: 'home',       Component: lazy(() => import('@/apps/home/...')) },
  { id: 'chat',       Component: lazy(() => import('@/apps/chat/...')) },
  { id: 'design',     Component: lazy(() => import('@/apps/design/src/application/browser/DesignPanel')) },
  { id: 'monitor',    Component: lazy(() => import('@/apps/monitor/...')) },
  { id: 'setting',    Component: lazy(() => import('@/apps/setting/...')) },
  { id: 'connection', Component: lazy(() => import('@/apps/connection/...')) },
];

function PageletHost() {
  const active = useActivePageletId();          // 从 router 派生（如 useLocation().pathname.split('/')[1]）
  const visited = useVisitedPagelets(active);   // 已访问过的 pagelet 集合，按需挂载

  return (
    <>
      {pagelets.map(({ id, Component }) =>
        visited.has(id) ? (
          <div
            key={id}
            hidden={id !== active}
            className="pagelet-slot absolute inset-0"
            aria-hidden={id !== active}
          >
            <Suspense fallback={<PageletLoading />}>
              <Component />
            </Suspense>
          </div>
        ) : null,
      )}
    </>
  );
}
```

**核心思想**：
- 已 visited 的 pagelet 都挂在 React 树里，只用 CSS `hidden` / `display: none` 切换可见性。
- 切换 0 成本：**state / scroll / DOM / 长连接订阅全部保留**，因为没有 unmount。
- Lazy 天然支持：`React.lazy` 包一层，首次访问才下载 chunk。
- **完全可控**，没有 portal / fiber 黑魔法。
- React DevTools 能看到完整树，调试友好。

**适用前提**（telegraph 满足）：
- pagelet 数量**有限且可枚举**（5 ~ 10 个）。
- 用户预期切换频繁，希望状态保留。

**已知 trade-off**：
- 所有 visited 过的 pagelet 一直占内存——telegraph 场景几个 pagelet 不是问题；如果未来要支持 100+ 个 panel 才需要 LRU 卸载策略。
- 隐藏的 pagelet 仍然能收到 `useLocation` 等 router context 更新——pagelet 内部需要用 `useIsPageletActive()` hook 来判断，决定是否执行副作用（如订阅推送、轮询）。这一约束**显式比隐式好**，不是缺点。

### 3.4 KeepAlive 方案选择

| 方案 | 推荐度 | 理由 |
|------|--------|------|
| **自实现 PageletHost (display 切换)** | ✅ 主选 | 入口可枚举、控制力强、无黑魔法、与 React DevTools / Suspense 兼容 |
| `react-activation` | 🟡 备选 | 如果未来需要"任意页面任意位置 KeepAlive"才考虑 |
| `<Activity>` | ❌ 不选 | 实验性、文档少、API 还在变 |

## 4. 与 A-008 后端拓扑的协作

A-008 §6 已经定义"Renderer 通过 direct channel 与各 pagelet utility process 直连"。在本选型下，前端层的协作方式如下：

```
Renderer (single BrowserWindow / single SPA)
├── <BrowserRouter>                                # React Router v7 data mode
│   └── <PageletHost>                              # 本文新增的 KeepAlive 容器
│       ├── <ChatPagelet>      (visited, hidden)   # 用 directChannelClient('chat') 通信
│       ├── <DesignPagelet>    (visited, active)   # 用 directChannelClient('design') 通信
│       └── <MonitorPagelet>   (not visited yet)   # 未挂载，未触发 lazy 下载
└── <Sidebar>
    └── 路由 link：/chat | /design | /monitor | …
```

**关键耦合点**：

1. **Pagelet 注册表是 PageletHost 的输入**——这与 A-010 提出的 `TelegraphManifest` 声明式贡献模型对齐：未来每个 app 在 manifest 里声明 `panel.entry`，PageletHost 自动从 manifest 派生 `pagelets[]` 数组。
2. **首次进入某 pagelet 时**：
   - `React.lazy` 下载 chunk；
   - pagelet 组件内部触发 `ConnectionOrchestrator.connect('renderer:main', 'pagelet:design:1')`（如尚未 connect）；
   - direct channel 建联后才能 `directChannelClient('design').invoke(...)`。
3. **切换离开某 pagelet 时**：
   - DOM 仍在，但 `visible = false`；
   - pagelet 内部应当**暂停高频副作用**（如 monitor 的 1Hz 拉取），通过 `useIsPageletActive()` 判断；
   - **不主动 disconnect**：保持 channel 存活以便下次秒切；连接资源由 Daemon 在内存压力大时统一回收。
4. **Pagelet utility process 崩溃后**：
   - x-oasis `replaceParticipantChannel` 在底层透明换链（A-008 I7）；
   - 如果换链期间用户刚好停留在该 pagelet，UI 表现为 pending（loader 在等 RPC 响应）；
   - Pagelet 内部的 React state（如已渲染的消息列表）**保留**——因为 React 树没有 unmount。
   - **重要副作用**：如果 pagelet 进程持有的状态（如 chat session）丢失了，但 UI 树上还显示着"假的"旧消息——需要 pagelet 在重连后主动 `refetch` 或对账。这是 KeepAlive 模式的固有 trade-off，要在每个 pagelet 的设计中显式处理。

## 5. 最终技术栈

```
构建：       Vite 6 + electron-forge VitePlugin（沿用现状）
路由：       react-router v7 (data mode, createBrowserRouter, ssr: false)
KeepAlive:   自实现 PageletHost (display 切换 + React.lazy + Suspense)
数据获取：   loader 内调用 directChannelClient → ConnectionOrchestrator RPC
            （如有缓存/订阅复杂度，再引入 TanStack Query）
状态：       Zustand（轻量、无侵入；packages/stores 已有基础）
样式：       Tailwind v4 + packages/ui（沿用现状）
```

## 6. 待办与风险

### 6.1 立即可推进

1. 在 `apps/main` 的 renderer 入口引入 `react-router` v7，搭出最小 `<PageletHost>` + `<Sidebar>` 骨架。
2. 把现有的 `DesignPanel` 接入 PageletHost 的 design slot，验证：
   - 切到 home 再切回 design，design 内的 ConnectionsTab 选中状态是否保留；
   - 首次切到 design 时是否正确触发 lazy chunk 下载；
   - 隐藏期间 design 是否暂停了不必要的订阅。
3. 提供 `useIsPageletActive()` hook 与文档约定。

### 6.2 中期演进

- 与 A-010 `TelegraphManifest` 集成：PageletHost 的 `pagelets[]` 由 manifest 派生，不再手动维护。
- Pagelet 崩溃 → 透明换链 → UI 对账的统一约定（可能需要在 pagelet 模板里内置一个"reconnect epoch" 监听，自动 invalidate 关键 loader）。

### 6.3 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 隐藏的 pagelet 仍订阅高频事件 → 内存/CPU 浪费 | 中 | `useIsPageletActive()` 约定 + ESLint 规则提醒 |
| KeepAlive 下 React state 与 pagelet 进程状态不一致 | 高 | 每个 pagelet 必须设计 reconnect/refetch 策略 |
| 路由库未来再次大版本变更 | 低 | RR v7 是 React 官方路由，向前兼容承诺较好 |
| `<Activity>` 稳定后是否要迁移 | 低 | 自实现方案 API 面非常小，迁移成本可控 |

## 7. 不做的事

- **不做** SSR / streaming SSR（Electron 桌面应用无 SEO / 首屏 TTFB 需求）。
- **不做** Remix framework features（loader / action 已经被 RR v7 data mode 覆盖）。
- **不做** 多 BrowserWindow（D-004 已结论：单 BrowserWindow + 单 SPA）。
- **不引入** `react-activation` / `<Activity>`，除非 PageletHost 自实现遇到无法解决的边界 case。
