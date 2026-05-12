---
id: A-009
title: Telegraph 运行时目录分层与文件结构约定
description: >
  以 VS Code 的 node/electron-browser/browser-common/browser 分层范式为参照，
  系统梳理 Telegraph 项目中 electron-main / electron-browser（preload）/ browser / node / common
  五个运行时目录的含义、代码边界与完整文件映射。
category: architecture
created: 2026-05-12
updated: 2026-05-12
tags: [file-structure, runtime-environment, electron-main, electron-browser, preload, browser, node, common]
status: draft
references:
  - id: A-001
    rel: related-to
    file: ./20260504-di-and-cross-platform-paradigm.md
  - id: A-008
    rel: related-to
    file: ./20260509-telegraph-final-process-architecture.md
---

# Telegraph 运行时目录分层与文件结构约定

> 本文以 VS Code 的 `node/electron-browser/browser-common/browser` 四层运行时目录范式为参照，
> 系统梳理 Telegraph 从零重写后的五个运行时目录分层、代码边界约束与完整文件映射。

## 1 范式背景：VS Code 的运行时目录约定

VS Code 将每个 service 的代码按运行环境拆分为子目录：

| 目录名 | 运行时 | 可用 API |
|--------|--------|----------|
| `node` | 纯 Node.js（主进程 / utility 进程） | `fs`, `child_process`, `net`, `path` 等 Node 内置模块 |
| `electron-browser` | Electron preload 上下文 | `ipcRenderer`（受限子集），`contextBridge`，`MessagePort` |
| `browser-common` | Renderer 与 preload 共享 | 纯浏览器 API + 跨进程类型定义，无任何 Electron 依赖 |
| `browser` | Electron renderer（Chromium） | DOM、`fetch`；通过 RPC proxy 调用远程服务 |

核心思想：**目录名即运行时约束**。代码放在哪个目录，就只能使用该运行时可用的 API；编译配置（tsconfig + vite alias）和外部依赖白名单共同守卫边界。**入口文件也不例外**——`main.ts` 归入 `electron-main/`，utility 入口归入 `node/`，不因"它是入口"就平铺在上级目录。

## 2 Telegraph 的运行时分层

Telegraph 的 from-zero 重写继承了上述思想，但命名和边界根据 Electron + x-oasis 的实际能力做了调整：

| 目录名 | 运行时 | 可用 API | 典型内容 |
|--------|--------|----------|----------|
| `common` | **全平台共享** | 纯类型、常量、序列化安全接口 | `types.ts`, `cp-config.ts` |
| `electron-main` | Electron 主进程 | `ipcMain`, `utilityProcess`, `BrowserWindow`, `webContents`, Node 全部 | Orchestrator, WindowManager, ProcessSpawner |
| `electron-browser` | Electron preload（`contextBridge` 侧） | `ipcRenderer`（send/on/postMessage）, `MessagePort`, `contextBridge` | preload.ts, direct channel 绑定 |
| `browser` | Electron renderer（Chromium） | DOM; 通过 `ProxyRPCClient` 调用远程服务（底层经 preload 透传） | React 组件, RPC proxy 消费者 |
| `node` | Utility 进程（Electron `utilityProcess.fork`） | `process.parentPort`, Node 全部, `MessagePortMain` | Bootstrap, Application, RPCServiceHost 注册 |

### 2.1 `common` — 全平台共享

```
services/connection-orchestrator/common/
├── cp-config.ts          # 控制面 channel 名称、project name 等常量
└── types.ts              # 参与者 ID、服务路径、服务接口（IDesignService 等）、拓扑快照类型
```

**硬约束**：
- 零运行时依赖——不 import `electron`、`@x-oasis/async-call-rpc-*` 的运行时模块
- 只允许导出 `type`、`interface`、`const`（纯数据常量）
- 所有接口方法签名必须 **serializable**（可跨 `postMessage` 传递）

### 2.2 `electron-main` — Electron 主进程

```
services/connection-orchestrator/electron-main/
├── AppOrchestrator.ts           # 继承 ElectronConnectionOrchestrator，注册参与者
├── MainCpServer.ts              # 主进程侧 cp 服务端（RPCServiceHost）
├── OrchestratorInspectorService.ts  # Inspector RPC 实现（getTopology / requestConnect）
├── DesignPageletProcess.ts      # spawn design utility + 注册 participant
├── DaemonProcess.ts             # spawn daemon utility + 注册 participant
├── MonitorPageletProcess.ts     # spawn monitor utility + 注册 participant
└── SharedProcess.ts             # spawn shared utility + 注册 participant

services/window-manager/electron-main/
└── WindowManager.ts             # BrowserWindow 生命周期管理
```

**可用 API**：`ipcMain`, `utilityProcess`, `BrowserWindow`, `webContents`, 全部 Node 内置模块

**硬约束**：
- 可 import `@x-oasis/async-call-rpc-electron/electron-main`
- 可 import `common/` 下的类型与常量
- **禁止** import `browser/` 或 `node/` 目录下的任何模块

### 2.3 `electron-browser` — Electron Preload

Telegraph 中 `electron-browser` 目录的代码只有一个文件，但它是整个跨进程通信的关键枢纽：

```
application/electron-browser/
└── preload.ts    # contextBridge 暴露 + direct channel 绑定
```

**可用 API**：`ipcRenderer`（send/on/postMessage/removeListener）, `contextBridge`, `MessagePort`

**核心职责**（`preload.ts:33-200`）：
1. 创建 `IPCRendererChannel` 连接 cp 通道（`preload.ts:83-88`）
2. 为每个 utility 创建独立 `RPCMessageChannel` direct channel（`preload.ts:102-105`）
3. 注册 `registerOrchestratorHandler` 接收 `activateConnection` 送达的 MessagePort（`preload.ts:120-126`）
4. 用 `ProxyRPCClient` 创建各 service 的代理（`preload.ts:128-142`）
5. 通过 `contextBridge` 将 RPC proxy 暴露给 renderer（`preload.ts:191-193`）

**硬约束**：
- 可 import `@x-oasis/async-call-rpc-electron/electron-browser`（IPCRendererChannel）
- 可 import `@x-oasis/async-call-rpc-web`（RPCMessageChannel）
- 可 import `@x-oasis/async-call-rpc`（ProxyRPCClient）
- 可 import `common/` 下的类型与常量
- **禁止**使用 `ipcRenderer.invoke` / `ipcRenderer.sendSync`（orchestrator 只用异步消息传递）
- **MessagePort 不可跨 contextBridge**——所有 port 处理必须在 preload 侧完成

### 2.4 `browser` — Electron Renderer

```
services/connection-orchestrator/browser/
├── RendererCpClient.ts      # Renderer 侧 cp 通道（module-scoped singleton）
├── inspectorClient.ts       # Inspector RPC 代理（getTopology / requestConnect）
└── directChannelClient.ts   # Direct channel 客户端工厂（awaitDirectChannelClient）

application/browser/
├── HomePage.tsx             # 首页组件
└── Sidebar.tsx              # 侧栏导航
```

**可用 API**：DOM; 通过 `ProxyRPCClient` / `RPCMessageChannel` 消费远程服务

**硬约束**：
- 可 import `@x-oasis/async-call-rpc`（ProxyRPCClient）
- 可 import `@x-oasis/async-call-rpc-web`（RPCMessageChannel）
- 可 import `common/` 下的类型与常量
- **禁止**直接 import `electron`（renderer 隔离在 contextBridge 之后）
- 所有跨进程调用统一走 RPC proxy，不直接操作 IPC 原语

**关键设计**：`RendererCpClient`（`RendererCpClient.ts:54-88`）挂载了空的 `RPCServiceHost`，使 renderer cp 通道对未注册的 incoming request（如 `activateConnection`）静默忽略而非回复 "Method not found"。

### 2.5 `node` — Utility 进程

```
services/connection-orchestrator/node/
└── UtilityCpClient.ts   # Utility 进程通用 cp 客户端（所有 utility 共用）
```

**可用 API**：`process.parentPort`, `MessagePortMain`, 全部 Node 内置模块

**核心职责**（`UtilityCpClient.ts:81-140`）：
1. 用 `ElectronUtilityProcessChannel` 包裹 `process.parentPort` 连接 cp（`UtilityCpClient.ts:94-98`）
2. 创建共享 `RPCServiceHost` 供业务服务注册（`UtilityCpClient.ts:98`）
3. `start()` 注册 `registerOrchestratorHandler`，收到 port 后绑定到 `ElectronMessagePortMainChannel`（`UtilityCpClient.ts:113-134`）

**硬约束**：
- 可 import `@x-oasis/async-call-rpc-electron/electron-main`（`ElectronUtilityProcessChannel` 和 `ElectronMessagePortMainChannel` 虽在 electron-main 包下，但 utility 进程的 Electron runtime 也可使用）
- 可 import `common/` 下的类型与常量
- **禁止**使用 `ipcMain`、`BrowserWindow` 等主进程专属 API

## 3 跨 App 目录结构

每个 app（design / shared / daemon / monitor）内部也遵循 `browser/` + `node/` 分层：

### 3.1 有 UI 的 Pagelet（design / monitor）

```
apps/design/src/
├── application/
│   ├── node/                            # ★ 只运行在 utility 进程
│   │   ├── main.ts                      #   入口（node 运行时）
│   │   ├── DesignBootstrap.ts           #   UtilityCpClient + 服务注册
│   │   ├── DesignApplication.ts         #   IDesignService 实现
│   │   └── design-application-module.ts #   DI 注册
│   └── browser/                         # ★ 打包进 renderer bundle
│       ├── DesignPanel.tsx              #   侧栏面板（React）
│       ├── DesignEntry.tsx              #   入口包装
│       ├── DesignView.tsx               #   设计视图
│       ├── DesignWorkspace.tsx          #   工作区布局
│       └── connections/
│           └── ConnectionsTab.tsx        #   连接调试标签页
└── global.d.ts
```

```
apps/monitor/src/
├── application/
│   ├── node/                            # ★ 只运行在 utility 进程
│   │   ├── main.ts                      #   入口（node 运行时）
│   │   ├── MonitorBootstrap.ts
│   │   ├── MonitorApplication.ts
│   │   └── monitor-application-module.ts
│   └── browser/                         # ★ 打包进 renderer bundle
│       ├── MonitorPanel.tsx
│       ├── ProcessesTable.tsx
│       ├── PsTreePanel.tsx
│       ├── Sparkline.tsx
│       └── hooks.ts
└── global.d.ts
```

### 3.2 无 UI 的 Utility（shared / daemon）

```
apps/shared/src/
└── application/
    └── node/                            # ★ 只有 node 层
        ├── main.ts                      #   入口（node 运行时）
        ├── SharedBootstrap.ts
        ├── SharedApplication.ts
        └── shared-application-module.ts

apps/daemon/src/
└── application/
    └── node/                            # ★ 只有 node 层
        ├── main.ts                      #   入口（node 运行时）
        ├── DaemonBootstrap.ts
        ├── DaemonApplication.ts
        └── daemon-application-module.ts
```

## 4 全局文件结构映射

### 4.1 完整源码树（按运行时着色）

```
apps/telegraph/src/
│
├── application/
│   ├── electron-main/
│   │   ├── main.ts                          [electron-main]  Electron 入口
│   │   ├── telegraph-application.ts         [electron-main]  生命周期管理
│   │   └── telegraph-application-module.ts  [electron-main]  DI 注册表
│   ├── electron-browser/
│   │   └── preload.ts                       [electron-browser] contextBridge + direct channel
│   └── browser/
│       ├── HomePage.tsx                     [browser]  首页
│       └── Sidebar.tsx                      [browser]  侧栏
│
├── core/
│   └── log/
│       └── LogService.ts                [common]  跨进程日志（纯 Node API）
│
├── services/
│   ├── connection-orchestrator/
│   │   ├── common/                      [common]   类型 + 常量
│   │   │   ├── cp-config.ts
│   │   │   └── types.ts
│   │   ├── electron-main/              [electron-main]
│   │   │   ├── AppOrchestrator.ts
│   │   │   ├── MainCpServer.ts
│   │   │   ├── OrchestratorInspectorService.ts
│   │   │   ├── DesignPageletProcess.ts
│   │   │   ├── DaemonProcess.ts
│   │   │   ├── MonitorPageletProcess.ts
│   │   │   └── SharedProcess.ts
│   │   ├── browser/                     [browser]
│   │   │   ├── RendererCpClient.ts
│   │   │   ├── inspectorClient.ts
│   │   │   └── directChannelClient.ts
│   │   └── node/                        [node]
│   │       └── UtilityCpClient.ts
│   └── window-manager/
│       └── electron-main/              [electron-main]
│           └── WindowManager.ts
│
├── index.tsx                            [browser]  Renderer 入口
├── App.tsx                              [browser]  根组件
└── types.d.ts                           [common]   RPC proxy 类型声明

apps/design/src/
├── application/
│   ├── node/                           [node]
│   │   ├── main.ts
│   │   ├── DesignBootstrap.ts
│   │   ├── DesignApplication.ts
│   │   └── design-application-module.ts
│   └── browser/                        [browser]  打包入 renderer
│       ├── DesignPanel.tsx
│       ├── DesignEntry.tsx
│       ├── DesignView.tsx
│       ├── DesignWorkspace.tsx
│       └── connections/ConnectionsTab.tsx
└── global.d.ts

apps/monitor/src/
├── application/
│   ├── node/                           [node]
│   │   ├── main.ts
│   │   ├── MonitorBootstrap.ts
│   │   ├── MonitorApplication.ts
│   │   └── monitor-application-module.ts
│   └── browser/                        [browser]
│       ├── MonitorPanel.tsx
│       ├── ProcessesTable.tsx
│       ├── PsTreePanel.tsx
│       ├── Sparkline.tsx
│       └── hooks.ts
└── global.d.ts

apps/shared/src/
└── application/node/                   [node]
    ├── main.ts
    ├── SharedBootstrap.ts
    ├── SharedApplication.ts
    └── shared-application-module.ts

apps/daemon/src/
└── application/node/                   [node]
    ├── main.ts
    ├── DaemonBootstrap.ts
    ├── DaemonApplication.ts
    └── daemon-application-module.ts

packages/runtime-contracts/src/          [common]  纯类型包
packages/ui/src/                         [browser]  纯 React + Tailwind
```

### 4.2 构建配置与运行时对应关系

| Vite 配置 | 入口 | 输出 | 运行时 | 可用 alias |
|-----------|------|------|--------|-----------|
| `vite.main.config.ts` | `src/application/electron-main/main.ts` | `.vite/build/index.js` | electron-main | `@telegraph/{application,core,services}` |
| `vite.preload.config.ts` | `src/application/electron-browser/preload.ts` | `.vite/build/preload.js` | electron-browser | `@telegraph/{application,core,services}` |
| `vite.renderer.config.ts` | `src/index.tsx` | `dist/` | browser | `@`, `@telegraph/{application,core,services,ui}`, `@design`, `@monitor` |
| `vite.design.config.ts` | `../design/src/application/node/main.ts` | `.vite/build/design_utility/` | node | `@design`, `@telegraph/services` |
| `vite.shared.config.ts` | `../shared/src/application/node/main.ts` | `.vite/build/shared_utility/` | node | `@telegraph/{services,core}` |
| `vite.daemon.config.ts` | `../daemon/src/application/node/main.ts` | `.vite/build/daemon_utility/` | node | `@telegraph/{services,core}` |
| `vite.monitor.config.ts` | `../monitor/src/application/node/main.ts` | `.vite/build/monitor_utility/` | node | `@monitor`, `@telegraph/{services,core}` |

**关键观察**：
- **electron-main** 和 **electron-browser** 的 alias 配置相同（都指向 `src/` 子树），但实际 import 受文件目录约束——preload 只 import `common` + `electron-browser` 包
- **browser** 的 renderer 配置最宽——包含 `@design` 和 `@monitor`，用于跨 app 导入 React 组件
- **node** 的各 utility 配置最窄——只有 `@telegraph/services`（common + node 部分）和 `@telegraph/core`

## 5 跨目录 import 规则矩阵

| From → To | `common` | `electron-main` | `electron-browser` | `browser` | `node` |
|-----------|----------|-----------------|--------------------|-----------|--------|
| `common` | ✅ | ❌ | ❌ | ❌ | ❌ |
| `electron-main` | ✅ | ✅ | ❌ | ❌ | ❌ |
| `electron-browser` | ✅ | ❌ | ✅* | ❌ | ❌ |
| `browser` | ✅ | ❌ | ✅** | ✅ | ❌ |
| `node` | ✅ | ❌ | ❌ | ❌ | ✅ |

\* `electron-browser` 可 import `@x-oasis/async-call-rpc-electron/electron-browser` 和 `@x-oasis/async-call-rpc-web`  
\** `browser` 通过 `ProxyRPCClient` 消费远程服务，底层 IPC 通道由 preload 侧透传，renderer 不直接操作任何 IPC 原语

## 6 新增服务的目录放置规则

当需要新增一个跨进程服务时，遵循以下步骤：

1. **`common/types.ts`** — 定义服务接口（如 `IFooService`）和 `FOO_SERVICE_PATH` 常量
2. **`common/cp-config.ts`** — 如有新 channel 常量，加在此处
3. **`electron-main/`** — 如需主进程侧 spawner 或 inspector 扩展
4. **`node/`** — utility 进程侧实现（`FooBootstrap.ts` + `FooApplication.ts`），复用 `UtilityCpClient`
5. **`electron-browser/`** — preload 侧注册 direct channel + `ProxyRPCClient` + `contextBridge` 暴露
6. **`browser/`** — renderer 侧消费代码（如有 UI，放在对应 app 的 `application/browser/`）

### 典型模式：新增一个 Pagelet 服务

```
1. common/types.ts          →  IMyService, MY_SERVICE_PATH, MY_PARTICIPANT_ID
2. electron-main/MyPageletProcess.ts  →  spawn utility + registerParticipant
3. apps/my-app/src/application/
   ├── node/main.ts          →  DI 容器 + bootstrap（node 入口）
   ├── node/MyBootstrap.ts   →  UtilityCpClient + serviceHost
   └── browser/MyPanel.tsx   →  React 面板
4. electron-browser/preload.ts →  direct channel + ProxyRPCClient + contextBridge
5. browser/                 →  如需 renderer 侧辅助客户端
6. vite.my.config.ts        →  新增 utility 构建配置
7. forge.config.ts          →  新增 build entry
```

## 7 与 VS Code 范式的差异

| 维度 | VS Code | Telegraph |
|------|---------|-----------|
| `browser-common` | 有（renderer + preload 共享） | 无独立目录；共享代码放 `common/`（更严格：连 renderer 也不直接用 Electron API） |
| Preload 代码位置 | 每个 extension 的 `electron-browser/` | `application/electron-browser/preload.ts`（所有 direct channel 集中管理，目录名与运行时对齐） |
| Utility 进程 | 无（VS Code 无 utility process） | `node/` 目录对应 utility 进程运行时 |
| 服务发现 | Extension host 动态加载 | `ConnectionOrchestrator` 静态注册 + 动态连接 |
| RPC 框架 | vscode-rpc（自定义 IPC） | `@x-oasis/async-call-rpc-electron`（通用 Electron RPC） |

核心差异归结为一点：**Telegraph 的 `common` 比 VS Code 的 `browser-common` 更严格**——它不仅是 renderer 与 preload 的共享层，而是全进程的共享层，连 Node 侧也 import 它。这保证了类型和常量在所有进程中唯一来源。
