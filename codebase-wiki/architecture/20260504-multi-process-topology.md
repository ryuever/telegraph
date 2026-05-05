---
id: A-002
title: Telegraph 多进程拓扑（main / daemon / shared / pagelet / preload / renderer）
description: >
  剖析 apps/telegraph 的五大进程角色（主进程、shared utility-process、
  daemon utility-process、pagelet utility-process、preload + renderer）的职责定位、
  构建配置、启动顺序与端口握手机制，明确各进程之间的 IPC 拓扑与服务路由。
category: architecture
created: 2026-05-04
updated: 2026-05-05
tags: [process, ipc, electron, utility-process, message-port, port-broker]
status: final
references:
  - id: A-001
    rel: related-to
    file: ./20260504-di-and-cross-platform-paradigm.md
  - id: A-003
    rel: related-to
    file: ./20260504-stability-and-performance-monitoring.md
  - id: D-001
    rel: related-to
    file: ../discussion/20260504-multica-vs-pi-multi-agent-for-telegraph.md
  - id: A-004
    rel: related-to
    file: ./20260504-multica-implementation-map-and-telegraph-adaptation.md
  - id: I-002
    rel: related-to
    file: ../issue/20260505-pi-ai-llm-trace-await-sink-deadlock.md
---

# Telegraph 多进程拓扑

> Telegraph 是一个**多进程 Electron 应用**：在标准的"主进程 + Renderer"之外，它额外引入了三种 utility-process（shared / daemon / pagelet）和一个端口经纪人（port broker）。本文逐一剖析每个进程的角色定位、构建产物、启动入口、生命周期，并给出五个角色之间的端口握手与 RPC 路由全貌，作为后续新增进程或调整拓扑时的参考蓝图。

---

## 1. 拓扑总览

```
                    ┌──────────────────────────────────┐
                    │  main process (Electron)         │
                    │  - 入口: src/application/main.ts │
                    │  - 持有 BrowserWindow + 端口经纪 │
                    │  - 注册：account / workbench /   │
                    │    log / monitor / fs / utils    │
                    └─────────┬────────────────────────┘
                              │ MessagePortMain
              ┌───────────────┼─────────────────┬─────────────────────┐
              ▼               ▼                 ▼                     ▼
      ┌───────────────┐ ┌─────────────┐  ┌────────────────┐   ┌──────────────────┐
      │ shared-process│ │daemon-process│  │ pagelet-process│   │ renderer (BrowserWindow │
      │ (utility)     │ │ (utility)    │  │ (utility, N×)  │   │  / BrowserView)         │
      │ Storage 真实  │ │ Diagnostics  │  │ 项目运行时     │   │  preload (px.ts) 桥接   │
      │ 实现 + 状态   │ │ + 5s 监控循环│  │ AMD 入口动态   │   │  IPCRenderer            │
      │               │ │              │  │ 加载           │   │                         │
      └───────┬───────┘ └──────┬───────┘  └────────┬───────┘   └─────────┬───────────────┘
              │                │                   │                     │
              └────────────────┴───── MessagePortMain pair ──────────────┘
                                          │
                                          ▼
                              port-manager (经纪人)
                              连接矩阵：5×5 角色组合
                              connectId = `${fromId}:${fromType}:${toType}`
```

按 `apps/telegraph/src/services/process/channel.README` 中的简化描述：

```
(server)           (client)
sharedprocess => main process
  (client)    (client)            (server)
    UI -> pagelet process -> sharedprocess -> ...
```

---

## 2. 构建配置：5 个入口 1 个 Renderer

`apps/telegraph/forge.config.ts:18-47`：

```ts
new VitePlugin({
  build: [
    { entry: 'src/application/main.ts',
      config: 'vite.main.config.ts' },
    { entry: 'src/application/preload/px.ts',
      config: 'vite.preload.config.ts' },
    { entry: 'src/services/process/shared-process/node/shared-process-bootstrap.ts',
      config: 'vite.fork.config.ts' },
    { entry: 'src/services/process/daemon-process/node/daemon-process-bootstrap.ts',
      config: 'vite.fork.config.ts' },
    { entry: 'src/services/process/pagelet-process/node/pagelet-process-bootstrap.ts',
      config: 'vite.fork.config.ts' },
  ],
  renderer: [{ name: 'main_window', config: 'vite.renderer.config.ts' }],
})
```

| Vite 配置 | 输出 | 说明 |
|---|---|---|
| `vite.main.config.ts` | `index.js` | `package.json:7` 指向；externals = Node 内置 + `electron` + `electron-log` + `@sentry/node` + `electron-store` + `@x-oasis/async-call-rpc/.*` |
| `vite.preload.config.ts` | `preload.js` | `BrowserWindow` 默认 preload；alias 同 main |
| `vite.fork.config.ts` | `[name].js` | 输出 `shared-process-bootstrap.js` / `daemon-process-bootstrap.js` / `pagelet-process-bootstrap.js`；externals 同 main |
| `vite.renderer.config.ts` | Renderer bundle | 异步加载 `@tailwindcss/vite` + React 插件；alias `@` = `src` |

> **统一构建配置 + 统一 alias** 是跨进程代码复用的前提。所有 `@telegraph/{application,core,services}` 在四套 vite 中保持一致。

---

## 3. 五大进程角色

### 3.1 main process（Electron 主进程）

- **入口**：`src/application/main.ts`
- **构建产物**：`.vite/build/index.js`
- **职责**：
  - 持有所有 `BrowserWindow` / `BaseWindow`
  - 拥有 `WindowManager` + `TelegraphMenu`（操作系统级菜单）
  - 拥有**端口经纪人** `AcquirePortMain`、所有进程间端口对的源头
  - 拥有可被远程消费的服务：`Account` / `Workbench` / `LogService` / `FileSystemManager` / `MainProcessUtils` / `MonitorBridge`
  - 拥有 fork shared / daemon / pagelet 的责任
- **启动序列**（`telegraph-application.ts:118-162`）：
  1. `logService.trace(TrackerEvent.TelegraphAppLaunch)` + 性能埋点
  2. `initAboutInfo()`：设置 macOS 关于面板
  3. `initCrashListener(logService)`：见 [A-003 §1](./20260504-stability-and-performance-monitoring.md#1-崩溃捕获-crash-reporter)
  4. `acquirePortMain.initAcquirePort(...)`：创建端口经纪
  5. `sharedProcessMain.initialize(...)` + `daemonProcessMain.initialize(...)`：注入循环依赖
  6. `setupSharedProcessMain()` → 启动 shared utility-process
  7. `setupDaemonProcessMain()` → 启动 daemon utility-process
  8. `storageServiceClient.getProfile()`：通过 RPC 经 shared 取登录态
  9. `account.handleAuthValidation(...)` → `initMainWindow()` → `prepareMainProcess()`
- **服务注册**（`telegraph-application.ts:164-171`）：
  ```ts
  this.mainProcess.registerServiceHandler(AccountServicePath,        this.account)
  this.mainProcess.registerServiceHandler(workbenchServicePath,      this.workbench)
  this.mainProcess.registerServiceHandler(LogServicePath,            this.logService)
  this.mainProcess.registerServiceHandler(FileSystemServicePath,     this.fileSystemManager)
  this.mainProcess.registerServiceHandler(MainProcessUtilsServicePath, this.mainProcessUtils)
  this.mainProcess.registerServiceHandler(monitorServicePath,        this.monitorBridge)
  ```

### 3.2 shared-process（应用唯一的 utility-process）

- **角色定位**：**跨进程的"状态容器"**——所有需要在多个进程间共享的持久化状态（profile、配置、文件元数据）放在这里。本项目当前实际承载 `StorageService`。
- **入口**：`src/services/process/shared-process/node/shared-process-bootstrap.ts`
- **构建产物**：`.vite/build/shared-process-bootstrap.js`
- **创建方式**（`SharedProcessMain.ts:93-108`）：
  ```ts
  this.utilityProcess.start({
    id: 'shared-process',
    serviceName: 'shared-process',
    ppid: process.pid,
    entry: this.fileAccess.asFileUri('@build/shared-process-bootstrap.js').fsPath,
  })
  ```
- **registerServiceHandler**（`SharedProcessNode.ts:60-63`）：
  - `StorageServicePath` → `StorageService`
  - `sharedProcessServicePath` → `this`
- **生命周期**：app 启动时创建一次，无自动重启；伴随主进程退出。
- **bizName**：`share-process`（`SharedProcessModule.ts:30`，注意拼写为 "share-process"，与目录名 "shared-process" 不一致——是已知约定差异）。

### 3.3 daemon-process（应用唯一的 utility-process）

- **角色定位**：**长驻的后台调度 + 监控宿主**——不依赖 Electron `app` API、可以承担定时任务、收集 metrics、未来扩展 Job Queue 的天然位置。当前承载 `Diagnostics`（5 秒采样 `app.getAppMetrics` + `ps -ax` PidTree）。
- **入口**：`src/services/process/daemon-process/node/daemon-process-bootstrap.ts`
- **构建产物**：`.vite/build/daemon-process-bootstrap.js`
- **创建方式**（`DaemonProcessMain.ts:93-101`）：与 shared 对称。
- **registerServiceHandler**（`DaemonProcessNode.ts:43`）：
  - `DiagnosticsServicePath` → `Diagnostics`
  - `StorageServicePath` → `StorageService`（自有副本，但当前未被外部消费）
  - `daemonProcessServicePath` → `this`
- **客户端代理（消费 main 的服务）**：`MainProcessUtilsClient`、`MonitorBridgeClient`、`WorkbenchClient`，全部通过 `mainProcessChannelProtocol` 走 RPC（`DaemonProcessModule.ts:53-75`）。
- **bizName**：`daemon-process`。

### 3.4 pagelet-process（每个项目一个 utility-process）

- **角色定位**：**为单个"项目/Pagelet"提供运行时容器**。一个 BrowserWindow 内可以打开多个项目 Tab，每个项目对应一个独立的 utility-process（cache 复用），从而避免项目之间的代码污染、内存泄漏互相影响。
- **入口**：`src/services/process/pagelet-process/node/pagelet-process-bootstrap.ts`
  - **特殊点**：bootstrap 完成后会**动态 import** `process.env[TELEGRAPH_AMD_ENTRY]` 指向的项目自有入口：
    ```ts
    if (process.env[TELEGRAPH_AMD_ENTRY]) {
      import(process.env[TELEGRAPH_AMD_ENTRY]).then(module => {
        const { initApplication } = module.default as { initApplication: InitApplicationInPagelet }
        initApplication?.(container, pageletProcessNode.getServiceHost())
      })
    }
    ```
    项目方实现 `initApplication(container, serviceHost)` 即可拿到本进程 DI 容器和 RPC 宿主，注册自定义服务。这是 Telegraph 的**项目插件接入点**。
- **创建位置**（`Pagelet.ts:204-227`）：每次新建 Pagelet（=新建一个 BrowserView Tab）时，先尝试 `BrowserWindow.cachedPageletProcessMap` 命中复用，否则通过 `pageletProcessFactory(projectName, windowManager)` 实例化并 `createUtilityProcess({ id, amdEntry })`。
- **每个 pagelet 还有独立的端口经纪**：`AcquireProcessPortMain`，类型为 `AssignPassingPortType.PageletProcess`（`PageletProcess.ts:73-98`）。
- **registerServiceHandler**（`PageletProcessNode.ts:61-64`）：
  - `pageletProcessServicePath` → `this`
  - `LogServicePath` → 进程内 `LogService`
- **bizName**：`projectName`（即每个项目自己写日志到 `<projectName>.log`）。
- **强制端口**：bootstrap 阶段立即请求 4 条端口（pagelet / daemon / shared / main），见 §4。

### 3.5 preload（每个 BrowserWindow 一个）

- **入口**：`src/application/preload/px.ts`（TS 编译为 `preload.js`）；`preload.js` 也存有一个手写沙盒版本作为参考。
- **挂载方式**（`BaseWindow.ts:64-67`）：
  ```ts
  webPreferences: {
    preload: this.fileAccess.asFileUri('@build/preload.js').fsPath,
  }
  ```
- **暴露给 renderer 的 `window.telegraph`**（`px.ts:43-119`）刻意保持极小：
  - `ipcRenderer.{send,invoke,on,once,removeListener}`——`send` 检测到 `args[0].ports.length` 时改走 `window.postMessage` 以转发 `MessagePort`
  - `ipcMessagePort`：占位符，保留 VS Code preload 风格
  - `webFrame.setZoomLevel`
- **`validateIPC` 校验**：`px.ts:34-41` 当前总是返回 `true`（注释保留 `telegraph:` 前缀校验逻辑供未来启用）。

### 3.6 renderer（BrowserWindow / BrowserView 内的 Chromium 进程）

- **HTML 入口**：`apps/telegraph/index.html`；React entry 通过 `vite.renderer.config.ts` 的 `name: 'main_window'`。
- **路由约定**：所有 `loadURL` 走 `FileAccess.asLoadURL`，并在 query 中追加 `TELEGRAPH_PAGELET_RENDERER_PROCESS_ID` 用作端口经纪的归属判定，例如：
  - `/login?TELEGRAPH_PAGELET_RENDERER_PROCESS_ID=main-renderer-login`
  - `/app?TELEGRAPH_PAGELET_RENDERER_PROCESS_ID=main-renderer-app`
  - `/auxiliary?TELEGRAPH_PAGELET_RENDERER_PROCESS_ID=auxiliary-app`
  - `/monitor?TELEGRAPH_PAGELET_RENDERER_PROCESS_ID=monitor-window-app`（`WindowManager.ts:114`）
- **Pagelet sub-renderer**：每个 `Pagelet` 在主窗口里挂一个 `BrowserView`（`Pagelet.createBrowserView()` lines 146-196），通过 `PageletClientChannel` 与 main / shared / daemon / 自家的 pagelet-process 建立 4 条端口（`PageletClientChannel.ts:132-135`）。
- **当前仍使用已废弃的 `BrowserView`**——后续应迁移到 `WebContentsView`（见 [A-003 §7](./20260504-stability-and-performance-monitoring.md#7-代码层可见的稳定性差距与改进项)）。

### 3.7 helper / 其他

`src/application/helper/` 不含 fork helper，仅两个文件：
- `about.ts` — `app.setAboutPanelOptions`
- `crash.ts` — 详见 [A-003 §1](./20260504-stability-and-performance-monitoring.md#1-崩溃捕获-crash-reporter)

唯一的 `child_process.exec` 出现在 `src/core/node/process/process-utils.ts:1-24`，仅供 `Diagnostics` 调用 `ps -ax` 收集 PidTree。

---

## 4. 端口经纪与 IPC 拓扑

### 4.1 三套 IPC 通道

Telegraph 把 IPC 显式地分成三层：

| 层 | 用途 | 抽象 |
|---|---|---|
| `ipcRenderer` 经 preload bridge | **仅**用于端口分发握手（`'acquire-port'` 与 `${pageletId}-assign-passing-port`） | `IPCMainChannel` / `IPCRendererChannel`（`@x-oasis/async-call-rpc-electron`） |
| `MessageChannelMain` + `MessagePortMain` | **所有真实跨进程服务调用** | `ElectronMessagePortMainChannel` / `ElectronUtilityProcessChannel` |
| `utilityProcess.fork` | 启动 utility-process 本身 | `electron.utilityProcess.fork`（封装在 `core/electron-main/utility-process/utilityProcess.ts:86`） |

> 业务侧绝不会直接 `ipcMain.handle` / `ipcRenderer.invoke`——所有 IPC 都被 `RPCServiceHost`/`ProxyRPCClient` 封装。

### 4.2 端口经纪的三个组件

- **`AcquirePortMain`**（`port-manager/electron-main/AcquirePortMain.ts`）
  主进程侧的全局经纪。预创建 `sharedProcessChannel` + `daemonProcessChannel`（`:99-102`），并监听 renderer 端口请求 `IPCMainChannel({ channelName: 'acquire-port' })`（`:149`）。
- **`AcquireProcessPortMain`**（`port-manager/electron-main/AcquireProcessPortMain.ts`）
  每个 utility-process 启动时创建一个，用于该进程到其他角色的端口分发，并附带为该进程实例化一个 `ProcessPingMain`。
- **`ProcessClientChannel`**（`port-manager/node/ProcessClientChannel.ts`）
  utility-process 侧的客户端。`initPortChannel()` 中：
  1. 注册自己的服务 host
  2. 用 `process.parentPort` 建 `ElectronUtilityProcessChannel`
  3. **主动调用 `acquireMainPort()`**（`:111`），保证一启动就有到主进程的通道
- **`PageletClientChannel`**（`port-manager/browser/PageletClientChannel.ts`）
  Pagelet renderer 侧的客户端，初始化时**并发请求 4 条端口**（`:132-135`）：
  - `acquirePageletPort()`、`acquireDaemonPort()`、`acquireSharedPort()`、`acquireMainPort()`

### 4.3 connectId 与握手

端口对的唯一键定义在 `port-manager/common/connectId.ts:14-15`：

```
connectId = `${fromId}:${fromType}:${toType}`
```

握手通过 `MessageChannelPair.sayHelloOptionsRequest` 完成（`MessageChannelPair.ts:62-87`）：

```ts
async sayHelloOptionsRequest() {
  if (this.peerEntry.isConnected) return
  this._logService.info(PortManagerLog.MessageChannelSayHello, this.id)
  const isConnected = await this.peerEntry.client.sayHelloOptionsRequest(this.id)
  isConnected && this.connect()
}
```

### 4.4 服务路径全表

`/services/...` 是跨进程 RPC 的路由 key，统一定义在各服务 `common/config.ts`：

| 服务路径 | 宿主 | 定义位置 |
|---|---|---|
| `/services/log` | main / pagelet | `services/log/common/log.ts:9` |
| `/services/workbench` | main | `workbench/common/config.ts` |
| `/services/account` | main | `account/common/config.ts` |
| `/services/main-process-utils` | main | `main-process-util/common/config.ts:3` |
| `/services/monitor` | main | `monitor/common/config.ts:3` |
| `/services/file-system-manager` | main | `file-manager/common/config.ts` |
| `/services/storage` | shared | `storage/common/config.ts` |
| `/services/shared-process` | shared | `process/shared-process/common/config.ts:10` |
| `/services/diagnostics` | daemon | `diagnostics/common/config.ts:3` |
| `/services/daemon-process` | daemon | `process/daemon-process/common/config.ts:10` |
| `/services/pagelet-process` | pagelet | `process/pagelet-process/common/config.ts:8` |
| `/services/ping-main` | 每对 process pair | `ping/common/config.ts:4` |
| `/services/acquire-port-main` | main + per-process | `port-manager/common/config.ts:3` |
| `/services/main-process-port` 等五个 `*-process-port` | port pair 握手 | `port-manager/common/config.ts:11-23` |

### 4.5 启动编排示意

```
main.ts
└─ TelegraphApplication.start()
   ├─ initCrashListener
   ├─ acquirePortMain.initAcquirePort(...)            # 主侧经纪人就绪
   ├─ sharedProcessMain.createUtilityProcess()        # fork shared
   ├─ daemonProcessMain.createUtilityProcess()        # fork daemon
   ├─ storageServiceClient.getProfile()               # RPC 经 sharedProcessChannel
   ├─ workbench.createMainWindow()                    # BrowserWindow + preload
   │     └─ Pagelet.startupPageletProcess()           # 按需 fork pagelet
   │            ↳ BrowserView 端 PageletClientChannel
   │              acquire{Pagelet,Daemon,Shared,Main}Port()
   └─ prepareMainProcess()                            # 主进程注册 6 个 service handler
```

---

## 5. utility-process 启动机制

### 5.1 fork 调用

`src/core/electron-main/utility-process/utilityProcess.ts:86-90`：

```ts
this._process = utilityProcess.fork(modulePath, args, {
  env, serviceName,
  execArgv: ['--inspect=4255'],   // 三类 utility 都监听同一调试端口
})
```

> ⚠️ 三类 utility-process 共享 `--inspect=4255`，多进程同时调试时只有第一个能成功 attach（典型 Chrome/VS Code Inspector 行为），后续应改为按角色偏移（4256/4257/4258）。

### 5.2 进程参数全部走 ENV

`createEnv()`（lines 96-129）将启动配置以**字符串环境变量**注入子进程：

| 环境变量 | 用途 |
|---|---|
| `TELEGRAPH_ENTRY` | 子进程入口 fs path |
| `TELEGRAPH_PPID` | 父进程 pid |
| `TELEGRAPH_PROJECT_NAME` | pagelet 进程的项目名（用于 bizName） |
| `TELEGRAPH_AMD_ENTRY` | pagelet 动态 import 的项目入口 |
| `TELEGRAPH_PROCESS_ID` | 由经纪人分配，用于 connectId |
| `TELEGRAPH_PAGELET_RENDERER_PROCESS_ID` | renderer 自报家门 |
| `TELEGRAPH_ROOT_TRACE_ID` | 用于跨进程日志 trace |
| `TELEGRAPH_APP_NAME` / `TELEGRAPH_APP_VERSION` | 由 `ApplicationInfo.injectChildProcessEnv(env)` 注入 |
| `FORCE_COLOR=1` | 保留控制台高亮 |

> **重要约定**：跨进程参数**只**通过 ENV 传，不走 IPC 启动消息。这也意味着子进程一旦 fork 完成，参数不可变；要改参数必须重启子进程。

---

## 6. 进程角色对照速查

| 维度 | main | shared | daemon | pagelet | preload | renderer |
|---|---|---|---|---|---|---|
| 进程类型 | Electron browser | utility-process | utility-process | utility-process | preload script | Renderer |
| 数量 | 1 | 1 | 1 | N（每项目 1 个） | 每窗口 1 个 | 每窗口/视图 1 个 |
| 入口文件 | `main.ts` | `shared-process-bootstrap.ts` | `daemon-process-bootstrap.ts` | `pagelet-process-bootstrap.ts` | `preload/px.ts` | `index.html` |
| 主要 Service | `WindowManager` `Workbench` `Account` `MonitorBridge` `MainProcessUtils` `FileSystemManager` `LogService` | `StorageService` `LogService(share-process)` | `Diagnostics` `LogService(daemon-process)` | `LogService(<projectName>)` 项目自定义 | `window.telegraph` 桥接 | React UI |
| 端口角色 | 经纪人源头 | client（持自己的 host） | client（持自己的 host） | client（持自己的 host） | bridge | client（4 条端口） |
| 重启策略 | 跟随 app | 无（伴随主） | 无（伴随主） | 按需重建（cache 命中复用） | 跟随窗口 | 跟随窗口 |
| 调试端口 | Electron 主侧 `--inspect-electron` | `4255` | `4255` | `4255` | — | DevTools |
| bizName | `main` | `share-process` | `daemon-process` | `<projectName>` | — | — |

---

## 7. 设计要点与未来扩展提示

1. **shared / daemon 是显式的"职责分割"，不是冗余**：
   - shared = **状态**（持久化 / 共享配置 / Storage）
   - daemon = **行为**（监控、调度、聚合上报）
   - 两者都不能直接访问 BrowserWindow，必须通过 RPC 回主进程拿 `MonitorBridge` / `MainProcessUtils`。
2. **pagelet 是隔离器**：项目崩溃只影响自身的 utility-process 与 BrowserView，不会拖死 main 与其他项目。
3. **port-manager 是 N×M 拓扑的中央交换机**：未来再加新角色（例如 worker-process），只需在 `AssignPassingPortType` 中追加枚举并在 `AcquirePortMain` 路由分支里增加分支，整体协议不变。
4. **目前缺的能力**（详见 [A-003 §7](./20260504-stability-and-performance-monitoring.md#7-代码层可见的稳定性差距与改进项)）：
   - 子进程崩溃后无自动重启路径（`MainProcess.registerProcess` 仅删除条目）
   - utility-process 内部缺少 `process.on('uncaughtException')`
   - `BrowserView` 需迁移到 `WebContentsView`
   - `--inspect=4255` 端口冲突
5. **新增进程角色的步骤**：
   1. 写 `<role>/electron-main/<Role>Main.ts`（fork 执行者）
   2. 写 `<role>/node/<Role>Module.ts` + `<Role>Node.ts` + `<role>-process-bootstrap.ts`
   3. 在 `forge.config.ts` 增加一个 fork build entry
   4. 在 `AssignPassingPortType` 增加枚举
   5. 在 `AcquirePortMain` / `AcquireProcessPortMain` 增加路由分支
   6. 在主进程 `Registry` 中绑定 `<Role>MainId` + 必要的 `*Client`

---

## 8. 小结

Telegraph 把"一个 Electron app"拆成了一个三层架构：

- **协调层**：main process（窗口 + 端口经纪 + 服务注册）
- **后台层**：shared（状态）+ daemon（监控/调度）
- **业务隔离层**：每个项目独立的 pagelet-process + BrowserView

层与层之间的连接全部走 `MessagePortMain` + `RPCServiceHost`/`ProxyRPCClient`，由 `AcquirePortMain` 充当中央经纪。任何新功能落到哪一层，决定了它的隔离粒度和上下文：和窗口/系统级 API 强耦合 → main；需要持久化状态 → shared；需要定时任务/系统级监控 → daemon；属于"项目"自身 → pagelet。
