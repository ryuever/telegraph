# Design-Only ConnectionOrchestrator Rewrite Plan

> **⚠️ ARCHIVED — superseded by `20260508-from-zero-design-only-electron-app-plan.md`**
>
> 本文档以「从老 telegraph 改造迁移」的视角写成。
> 用户 2026-05-08 后明确把视角改为「从 0 到 1 全新项目，老代码只是参考」，
> 因此本方案叙事整体被推翻，由新文档取代。
>
> 此处仅保留历史记录与设计要点（control-plane vs direct channel 模型、
> §2 拓扑、§3 channel 模型、§5 启动序列）作为新文档的素材沉淀，不要再据此动工。

**Date**: 2026-05-08
**Status**: Archived
**Supersedes (scope-wise)**: `20260508-port-management-orchestrator-migration-plan.md`
  （旧 plan v2 假设老 port-manager 与新 orchestrator 共存；本 plan 收紧到「彻底放弃老 port-manager，先把 design 一条最小链路跑通」）

---

## 0. 背景与决策回放

老 `apps/telegraph/src/services/port-manager/` 是 telegraph 自研的端口编排层，覆盖
renderer↔main / renderer↔utility / utility↔utility 多路通道、acquire / assignPassingPort / 重连
等所有职能。

最近 `@x-oasis/async-call-rpc` link-to-source 后，新加的 `validateAndDetectArgType`
中间件在 `prepareNormalData` 阶段严格禁止「Transferable + serializable 混传」。
老 port-manager 的 `assignPassingPort({ connectId, reconnect }, port)`
正好踩中（一个普通对象 + 一个 `MessagePort`），导致整套老链路在 main 启动后立即抛错，
chat / monitor / design 三条入口全部起不来。

**已经做出的决策**：
- 不修老 port-manager（用户的 hard rule）。
- 改为：**完全放弃老 port-manager 的进程通信编排**，
  改用 `@x-oasis/async-call-rpc-electron` 提供的 `ElectronConnectionOrchestrator`
  能力重新搭建。
- **第一阶段范围极度收紧**：只把 design 一条链路跑通；chat / monitor / shared / daemon
  以及一切非 design-必需的业务 service 都暂时移除入口，只留代码不引用。
- 设计文档先行，review 后才动工。

---

## 1. 第一阶段范围

### 1.1 保留（必须可工作）

| 模块 | 说明 |
|---|---|
| 主窗口 BrowserWindow | 显示主 renderer，承载 design panel |
| 主 renderer (`apps/telegraph/src/index.tsx`) | 渲染 DesignPanel inline |
| `DesignPanel` (`apps/design/src/application/browser/`) | 设计面板 UI，含 ConnectionsTab |
| design utility process | 运行 `apps/design/src/main.ts`，承载 DesignApplication |
| main 进程 bootstrap | `apps/telegraph/src/application/main.ts` + `telegraph-application.ts` |
| `AppOrchestrator` (main) | `apps/telegraph/src/services/connection-orchestrator/electron-main/AppOrchestrator.ts` |
| `OrchestratorInspectorService` (main) | 暴露拓扑给 renderer |
| LogService | dlog/file logger，全程依赖 |
| WindowManager | 创建主窗口 |
| `MainProcess`（精简版） | 作为 main 端 RPC service host 容器 |
| `PageletProcess`（design-only 版） | 创建 design utility process，注册到 orchestrator |
| `DesignApplication` (utility) | design utility 内业务入口 |
| `DesignPageletNode`（精简版） | utility 端控制平面 + 业务 host 装配 |
| `runtime-contracts` 包 | 已被 design 使用，保留 |

### 1.2 暂时保留代码、不从入口引用（"冷冻"）

按用户决策选项 B：**代码不删，但不再被 import**。

| 路径 | 处理方式 |
|---|---|
| `apps/telegraph/src/services/port-manager/**` | 不再 import，从 telegraph-application 完全摘除 |
| `apps/telegraph/src/services/process/shared-process/**` | 同上 |
| `apps/telegraph/src/services/process/daemon-process/**` | 同上 |
| `apps/telegraph/src/services/process/main-process/MainProcess.ts` | 替换为新精简实现，旧实现保留为 `MainProcess.legacy.ts`（git mv 重命名） |
| `apps/telegraph/src/services/process/pagelet-process/electron-main/PageletProcess.ts` | 同上，重命名为 `PageletProcess.legacy.ts`，新实现独立写 |
| `apps/telegraph/src/services/process/pagelet-process/node/{chat,monitor}-pagelet-entry.ts` | 不在 forge.config 的 build 入口列表里，自然被排除 |
| `apps/telegraph/src/services/agent/**` | 不再 import |
| `apps/telegraph/src/services/monitor/**` | 不再 import |
| `apps/telegraph/src/services/account/**` | 不再 import |
| `apps/telegraph/src/services/workbench/**` | 不再 import |
| `apps/telegraph/src/services/storage/**` | 不再 import |
| `apps/telegraph/src/services/file-system/**` | 不再 import |
| `apps/telegraph/src/services/file-access/**` | 不再 import |
| `apps/telegraph/src/services/model-config/**` | 不再 import（preload 里可保留 stub 或一并去掉） |
| `apps/telegraph/src/services/ping/**` | 不再 import |
| `apps/telegraph/src/services/tabs/**` | 不再 import |
| `packages/ui/src/components/monitor/**` | 不再 import |
| `apps/design/src/services/**`（旧 forwarding 用） | 已在前一轮删除/简化，保持 |

### 1.3 先不做（明确推迟）

- chat / monitor pagelet 接入新 orchestrator
- shared / daemon utility process 接入新 orchestrator
- 业务 service（Account / Workbench / Storage / FileSystem / Agent / Monitor / ModelConfig）的迁移
- 重连策略与 heartbeat（`AppOrchestrator` 内已 `heartbeat.enabled=false`，保持）
- Forwarding Proxy（design utility 直接通过 control-plane channel 拉到 main 给的 port，不需要 forwarding）

---

## 2. 目标拓扑

```
                 ┌─────────────────────────────────┐
                 │        main process             │
                 │                                 │
                 │  AppOrchestrator                │
                 │     ▲       ▲                   │
                 │     │       │                   │
                 │  control   control              │
                 │  plane     plane                │
                 │     │       │                   │
                 │     │       │                   │
                 └─────┼───────┼───────────────────┘
                       │       │
              IPCMain  │       │  UtilityProcess
              MessagePort      │  parentPort
              (preload bridge) │
                       │       │
                       ▼       ▼
              ┌──────────────┐ ┌────────────────────┐
              │ main renderer│ │ design utility     │
              │              │ │                    │
              │ DesignPanel  │ │ DesignApplication  │
              │ ConnectionsTab│ │ /services/design   │
              └──────────────┘ └────────────────────┘
```

第一阶段拓扑里的 participants：

| participant id        | role        | 说明 |
|-----------------------|-------------|------|
| `main`                | `process`   | main 进程自己（用于自描述；此处暂不必要，可省略） |
| `renderer:main`       | `renderer`  | 主 renderer，DesignPanel 所在 |
| `pagelet:design`      | `utility`   | design utility process（第一阶段只 spawn 一个实例，id 不带序号） |

connections（按需 lazy 建立）：

| from              | to                | 何时建立 |
|-------------------|-------------------|----------|
| `renderer:main`   | `main`            | renderer 启动后调 OrchestratorInspectorService 时按需 connect |
| `pagelet:design`  | `main`            | design utility ready 后由 main 触发 connect（实际就是 control-plane 发 port）|
| `renderer:main`   | `pagelet:design`  | 第一阶段不需要（renderer 不直接调 design utility 的业务 service；如果将来需要，由 main `orchestrator.connect` 推 port 给两端） |

---

## 3. Channel 模型

### 3.1 Control-plane 与 Direct（业务）channel 的区分

按 x-oasis 文档，`ElectronConnectionOrchestrator` 的工作模型：

- 每个 participant 注册时**必须**有一条已建立的 **control-plane channel**（控制平面通道）连到 main 的 orchestrator。
- 当 main 调 `orchestrator.connect(fromId, toId)` 时，main 会通过两端的 control-plane channel
  分别推一个新的 `MessagePort`（两个 port 是同一个 `MessageChannelMain` 的两端）。
- 两端通过 `registerOrchestratorHandler(controlPlaneChannel, onPort)` 接收这个 port，
  在 `onPort` 回调里把 port 绑到一个**业务 channel**（direct channel）上，
  然后注册业务 service 即可。
- 同一个 participant pair 之间的 RPC 调用走 direct channel，不再过 main。

第一阶段在 telegraph 里，control-plane channel 与 direct channel 分别是：

| participant       | control-plane channel              | direct channel(s)            |
|-------------------|------------------------------------|------------------------------|
| `main`            | （main 自己持有 orchestrator，不需要）| —                          |
| `renderer:main`   | `IPCRendererChannel` (channel name = `telegraph:orchestrator-cp`) | `RPCMessageChannel`（绑接收到的 MessagePort），用于调 main 的 OrchestratorInspectorService |
| `pagelet:design`  | `ElectronUtilityProcessChannel`（main 端持有）/ utility 端`ElectronUtilityProcessChannel`（基于 `process.parentPort` 的实现）| 同上：`ElectronMessagePortChannel`（utility 侧）/ `ElectronMessagePortMainChannel`（main 侧），绑接收到的 port |

> 注：上表 main 侧/utility 侧的具体 class 选择以 `@x-oasis/async-call-rpc-electron` 实际导出为准；
> 文档讨论阶段先不锁死类名。**实施时这里要再确认一遍**。

### 3.2 main↔renderer 控制平面 handshake

**为什么必须用 IPC**：main 进程不是 utility，它是 `MessageChannelMain` 的创建者；
renderer 拿到一个到 main 的 MessagePort 的唯一官方机制就是
`webContents.postMessage(channel, payload, [port])` —— 也就是说 renderer↔main 的
**control-plane channel** 必须基于 IPC（而不是 MessagePort）。

`@x-oasis/async-call-rpc-electron` 已经提供了 `IPCMainChannel` / `IPCRendererChannel`，
可以直接用作 control-plane（**它们底层就是 ipcMain/ipcRenderer 的 message channel，不涉及 MessagePort transfer**）。

具体流程：

```
main 启动:
  1. AppOrchestrator 实例化（持有 ElectronConnectionOrchestrator）
  2. main 创建一个 IPCMainChannel { channelName: 'telegraph:orchestrator-cp', acceptAllSenders: true }
     —— 这是所有 renderer 共用的 control-plane "服务端"
  3. 当主窗口创建后，IPCMainChannel 自动接受第一个连上来的 webContents

主 renderer 启动:
  1. 主 renderer 启动后用 preload 暴露的 ipcRenderer 创建
     IPCRendererChannel { channelName: 'telegraph:orchestrator-cp' }
  2. main 与 renderer 之间的 control-plane channel 已自动建立（双向 ipc message）
  3. renderer 调 appOrchestrator.registerParticipant('renderer:main', ipcChannel, 'renderer')
     —— 但这一步不在 renderer 进程内做（orchestrator 在 main）；
     **由 main 在收到 renderer 第一个心跳/握手消息后代为 register**。

main↔renderer connect:
  - 当 renderer 第一次想调用 main 的 OrchestratorInspectorService 时：
    a. renderer 调 main 端代码：appOrchestrator.connect('renderer:main', 'main')
       —— 但 'main' 不是个真正的 participant（main 自己持有 host），
       这种情况要么把 InspectorService 直接挂到 control-plane channel 上，
       要么在 main 自己注册一个 participant id = 'main'（loopback channel？）。
    b. 选项 A：把 InspectorService 直接挂在 control-plane IPCMainChannel 上，
       就不需要 connect。control-plane 同时承载控制 + InspectorService 的 RPC。
       简单、零额外代码。
    c. 选项 B：true orchestrator 模式 —— main 给自己也注册一个 participant，
       用 loopback channel 让其它 participant connect 到它。完整但复杂。
  - **建议第一阶段走选项 A**：control-plane channel 同时承载 OrchestratorInspectorService
    的 RPC handler。这是「先跑通最小链路」的合理简化。

  - 这意味着第一阶段 `'main'` 暂不作为 participant 出现在拓扑里；
    拓扑只有 `renderer:main` 和 `pagelet:design`（以及它们之间的连接，如有）。
```

### 3.3 main↔pagelet:design 控制平面 handshake

```
main spawn design utility 流程:
  1. PageletProcess (design-only 重写版) 用 utilityProcess.fork() 起 design utility
  2. 起来后 main 用 ElectronUtilityProcessChannel 包装 process.stdin/stdout
     作为 control-plane channel
     （x-oasis-electron 应该已经支持，否则用 process.postMessage 自己包一个）
  3. main 调 appOrchestrator.registerParticipant('pagelet:design', cpChannel, 'utility')
  4. utility 进程内：
     - DesignPageletNode 用 process.parentPort 创建 control-plane channel
     - 调 registerOrchestratorHandler(cpChannel, (port) => {
         directChannel.bindPort(port)
         directChannel.setServiceHost(designServiceHost)  // /services/design
       })

connect renderer ↔ pagelet:design (按需，第一阶段暂不需要):
  1. renderer 通过 main control-plane 向 main 发请求 "我要连 pagelet:design"
  2. main 调 appOrchestrator.connect('renderer:main', 'pagelet:design')
  3. orchestrator 创建 MessageChannelMain，把 port1 通过 renderer 的 cp 推给 renderer，
     port2 通过 utility 的 cp 推给 utility
  4. 两端 onPort 把 port 绑到各自 direct channel 上
```

### 3.4 一个关键开放问题：`'main'` 是不是 participant？

第一阶段建议：**不是**。OrchestratorInspectorService 直接挂在 main 控制平面（IPCMainChannel）上，
对 renderer 暴露。拓扑里只有 `renderer:main` 与 `pagelet:design` 两个外部 participant。

理由：
- main 是 orchestrator 的宿主，让它"自己 connect 自己"概念上别扭。
- 第一阶段 design utility 不需要直接调 main 的 service（它只调 OrchestratorInspector 是 renderer 的事）。
- 简化握手：少一条 loopback、少一处状态。

代价：
- 拓扑可视化里看不到 "main" 这个节点；ConnectionsTab 里 connections 列表里也不会有
  `renderer:main → main` 这条边。第一阶段可接受（后续要可视化时再补一个 `'main'` participant + loopback）。

> Review point: 是否同意第一阶段不把 main 作为 participant？

---

## 4. 文件级改动清单

### 4.1 新增

| 文件 | 内容 |
|---|---|
| `apps/telegraph/src/services/connection-orchestrator/common/cp-config.ts` | `export const ORCHESTRATOR_CP_CHANNEL_NAME = 'telegraph:orchestrator-cp'` 等共享常量 |
| `apps/telegraph/src/services/connection-orchestrator/electron-main/MainCpServer.ts` | main 侧 control-plane 服务端：创建 IPCMainChannel + 把 OrchestratorInspectorService 挂上去；接受 renderer 接入后向 AppOrchestrator 注册 `renderer:main` participant |
| `apps/telegraph/src/services/connection-orchestrator/browser/RendererCpClient.ts` | renderer 侧 control-plane 客户端：创建 IPCRendererChannel + 提供给 ConnectionsTab 用 |
| `apps/telegraph/src/services/connection-orchestrator/node/UtilityCpClient.ts` | utility 侧 control-plane 客户端：包装 `process.parentPort` 为 channel，调 registerOrchestratorHandler |
| `apps/telegraph/src/services/process/pagelet-process/electron-main/DesignPageletProcess.ts` | 全新写一个 design-only 的 spawner（不复用老 PageletProcess）。职责：fork design utility、建 cp channel、注册 participant |
| `apps/design/src/application/node/DesignBootstrap.ts` | utility 侧 bootstrap：建 cp channel + utility cp client + 拿 port 后挂 DesignApplication（替换现 DesignPageletNode）|

### 4.2 修改

| 文件 | 改动 |
|---|---|
| `apps/telegraph/src/application/main.ts` | DI container 只 load `telegraph-application-module` 的精简版；移除 LegacyXxxModule 的 import |
| `apps/telegraph/src/application/telegraph-application.ts` | 重写 `start()`：只做 LogService → WindowManager → BrowserWindow → MainCpServer → DesignPageletProcess.spawn。删除所有 SharedProcessMain / DaemonProcessMain / Account / Workbench / Storage / FileSystem / Monitor / Agent / port-manager 相关代码 |
| `apps/telegraph/src/application/telegraph-application-module.ts` | DI module：只声明 LogService / WindowManager / MainProcess（精简）/ AppOrchestrator / OrchestratorInspectorService / MainCpServer / DesignPageletProcess |
| `apps/telegraph/src/index.tsx` | 移除 chat / monitor 相关 import 与渲染分支；移除 InlinePanelChannelManager 用法；保留 DesignPanel 渲染；新增 RendererCpClient 初始化（在 DesignPanel 挂载前） |
| `apps/telegraph/src/services/process/main-process/electron-main/MainProcess.ts` | 重命名为 `MainProcess.legacy.ts`，新写一个 30 行的精简版只提供 `serviceHost` |
| `apps/telegraph/src/services/process/pagelet-process/electron-main/PageletProcess.ts` | 重命名为 `PageletProcess.legacy.ts`；不再被任何地方引用 |
| `apps/telegraph/src/services/window-manager/electron-main/BrowserWindow.ts` | 删除内部对 port-manager 的 `acquire-port` 注册；其它逻辑保留 |
| `apps/design/src/main.ts` | 简化为：load DesignApplication DI module → 启动 DesignApplication → new DesignBootstrap().init()（即用新 cp 模型）；移除现有 DesignPageletNode 引用 |
| `apps/design/src/application/browser/connections/ConnectionsTab.tsx` | 已有的实现走 `mainProcessChannelProtocol`（来自老 InlinePanelChannelManager），要改为走新的 RendererCpClient 暴露的 channel |
| `apps/telegraph/src/application/preload/px.ts` | 删除 `modelConfig.*` 暴露；保留 ipcRenderer 通用桥（control-plane 需要） |

### 4.3 删除（git rm）

第一阶段不删（按用户选项 B 决策），保持代码在仓里，只断引用。

### 4.4 不动

- `apps/telegraph/src/services/connection-orchestrator/{common,electron-main}/{AppOrchestrator,OrchestratorInspectorService,types}.ts`
- `apps/telegraph/src/core/electron-main/utility-process/utilityProcess.ts`（若需要 transfer list 支持，可能要小改 `postMessage` wrapper；这一点在实施时再定）
- `packages/runtime-contracts/`
- `packages/ui/src/components/Toolbar.tsx` 等不依赖 monitor / chat 的 UI 原语

---

## 5. 启动序列（精简后的"新 main 流程"）

```
main.ts
  └─ build DI container (telegraph-application-module)
  └─ app.whenReady()
  └─ resolve(TelegraphApplication).start()

TelegraphApplication.start():
  1. LogService init
  2. AppOrchestrator init           # ElectronConnectionOrchestrator 实例
  3. MainCpServer.start(orchestrator, mainProcessHost)
       - new IPCMainChannel('telegraph:orchestrator-cp', acceptAllSenders:true)
       - serviceHost.registerServiceHandler(orchestratorInspectorServicePath, inspectorService)
       - cpChannel.setServiceHost(serviceHost)
       - 监听 webContents 接入事件，首次接入时调
         appOrchestrator.registerParticipant('renderer:main', cpChannel, 'renderer')
  4. WindowManager.createMainWindow()
  5. DesignPageletProcess.spawn()
       - utilityProcess.fork(design-pagelet-bootstrap.js)
       - 用 ElectronUtilityProcessChannel 包装 process 作为 cpChannel
       - appOrchestrator.registerParticipant('pagelet:design', cpChannel, 'utility')
       - 进程 exit 时 unregister
```

renderer 启动序列（`apps/telegraph/src/index.tsx`）：

```
index.tsx
  └─ RendererCpClient.init()
       - new IPCRendererChannel('telegraph:orchestrator-cp')
       - 暴露 cpChannel 供 DesignPanel 用
  └─ ReactDOM.render(<App />)

DesignPanel mount:
  └─ ConnectionsTab uses cpChannel:
       - new ProxyRPCClient('/services/orchestrator-inspector', { channel: cpChannel })
       - .createProxy<IOrchestratorInspectorService>()
       - 直接调 getTopology / ping
```

design utility 启动序列：

```
design-pagelet-bootstrap.js (esm built from apps/design/src/main.ts)
  └─ new DesignBootstrap().init()
       - 用 process.parentPort 创建 cpChannel
       - new RPCServiceHost()  // for /services/design
       - registerOrchestratorHandler(cpChannel, (port) => {
           directChannel.bindPort(port)
           directChannel.setServiceHost(designServiceHost)
         })
       - 启动 DesignApplication & 注册 /services/design 到 designServiceHost
```

---

## 6. 验证标准

第一阶段判定为通过的最小标准：

1. `pnpm start` 不报 `Invalid args: Cannot mix Transferable...`
2. main 进程的 `/tmp/telegraph-main.log` 出现 `start() returned` 且后续 5 秒内没有 UNHANDLED 错误
3. 主窗口显示，DesignPanel 能渲染
4. design utility process 在 `ps aux` 里能看到，并且不在 5 秒内 exit
5. ConnectionsTab 能 fetch 到 topology，至少看到 `pagelet:design` 一个 participant
6. ConnectionsTab 的 Ping 按钮对 `pagelet:design` 能返回 RTT（验证 connect 真正建立 + direct channel 工作）

不在本阶段判定标准内（即不要求工作）：
- chat / monitor 面板
- 任何业务 service（写文件、发请求、读 storage 等）

---

## 7. 实施 Phase 划分

> 每个 Phase 后做一次 `pnpm start` 烟囱测试 + 用户 review。

| Phase | 内容 | 期望状态 |
|---|---|---|
| P1 | 入口断引用：main.ts / telegraph-application{,.module}.ts 删掉所有 chat/monitor/shared/daemon/account/workbench/storage/agent/monitor/port-manager 的 import 与逻辑；index.tsx 删掉所有相关 UI 分支与 channel 初始化。仅保留极简 stub（"hello design"）让 pnpm start 能启动到主窗口（DesignPanel 暂时硬编码"功能未就绪"占位）。 | 启动成功，主窗口显示，无运行时错误 |
| P2 | 引入 MainCpServer + RendererCpClient（control-plane only，不接 design utility）；OrchestratorInspectorService 挂在 cp channel 上；ConnectionsTab 改为走 RendererCpClient.cpChannel 调 inspector。 | ConnectionsTab 能 fetch topology（结果为空），无运行时错误 |
| P3 | 引入 DesignPageletProcess + DesignBootstrap（design utility 走新 cp 模型）；utility 端 cp 接 OrchestratorHandler；main 端 registerParticipant('pagelet:design', cp, 'utility')。 | ConnectionsTab 看到 `pagelet:design` participant；Ping 暂未工作 |
| P4 | 实现 connect: renderer 调 inspector.requestConnect('renderer:main','pagelet:design')（或者第一阶段直接 main 自动 connect）；direct channel 建立；utility 端 designServiceHost 挂 /services/design；ConnectionsTab Ping 按钮可用。 | Ping 返回 RTT；direct channel 验证工作 |
| P5 | 清理 + 文档更新：把"暂时保留"的旧代码加 `// LEGACY: do not import` 头部注释；更新 AGENTS.md 标注当前架构状态；归档此文档为完成状态。 | 仓库可移交 |

---

## 8. 待 review 的关键决策

请用户在 review 时显式确认以下选项：

- [ ] **D1**：第一阶段拓扑里**不把 `'main'` 作为 participant**，OrchestratorInspectorService 直接挂在 control-plane channel 上。同意？
- [ ] **D2**：旧代码处理方式 = **保留代码 + 不从入口 import**（不 git rm，不 git mv 到 legacy/）。同意？
- [ ] **D3**：design pagelet 第一阶段**只 spawn 一个实例**，participant id 用 `pagelet:design`（不带序号）。同意？
- [ ] **D4**：第一阶段**不实现 renderer↔pagelet:design 的 direct channel**（renderer 不直接调 design 业务 service，所有调用都过 inspector）。Ping 走 inspector→main→（main 已与 utility 直连？）这条链路是否够？还是 P4 必须真正建立一条 renderer↔utility direct channel 才算"跑通"？
- [ ] **D5**：preload 是否要保留 `modelConfig.*` 等业务桥？建议**不保留**，第一阶段 preload 只暴露最小的 ipcRenderer 包装。
- [ ] **D6**：`MainProcess` 与 `PageletProcess` 用 git mv 重命名为 `.legacy.ts` 还是仅在原文件加 LEGACY 标记？建议 git mv（更明确，且新文件可同名占位）。
- [ ] **D7**：是否同意按 P1→P5 的顺序推进，每个 Phase 完成后 pause 等 review？

---

## 9. 风险

- `ElectronUtilityProcessChannel` 是否能直接作为 utility 的 control-plane channel（即 main 端 `new` 出来即可与 utility 端 `process.parentPort` 通信）需要在 P3 实施时确认。如果不能直接用，需要小改 `apps/telegraph/src/core/electron-main/utility-process/utilityProcess.ts:73` 的 postMessage wrapper 来支持 transfer list。
- `IPCMainChannel({ acceptAllSenders: true })` 在多 webContents 场景下是否会冲突未验证；第一阶段只有一个主 renderer，应该不会遇到。
- `validateAndDetectArgType` 校验对新模型应该完全友好（control-plane 上传的都是普通对象；activateConnection(port) 上只传一个 port，不混传），但需 P3 实跑确认。
- design utility 内 DI 容器之前在老链路上报过 `constructorDeps undefined`，可能与 link-to-source 后 `@x-oasis/di` 实例不一致有关。在 P3 起 design utility 时若复现，需要单独排查（不在本 plan 直接解决）。

---

## 10. 与旧 plan 的关系

`20260508-port-management-orchestrator-migration-plan.md`（plan v2）描述的是
"老 port-manager 与新 orchestrator 共存 / pagelet 端做 forwarding proxy" 路径，
现已被本 plan 取代。旧 plan 文档不删，但应在文首加一段注释指向本文。
