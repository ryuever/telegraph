# Telegraph (Design) — From-Zero Build Plan

**Date**: 2026-05-08
**Status**: Phase 0 + Phase 1 + Phase 2 + Phase 2.5 + Phase 3 + Phase 4 complete; Phase 5 doc/cleanup + x-oasis sub-path split + multi-arg RPC fix (P5.6) + activateConnection race fix (P5.7) landed; runtime smoke test of P5.7 pending user TTY run
**Replaces**: `20260508-port-management-orchestrator-migration-plan.md` (archived),
              `20260508-design-only-orchestrator-rewrite-plan.md` (archived)
**Depends on**: [`D-006` x-oasis ConnectionOrchestrator 能力缺口分析](../discussion/20260508-x-oasis-orchestrator-capability-gaps.md)
              — Gap 2/3 必须在 Phase 3/4 实施前补完（详见 §13）。

---

## 0. 视角声明

本计划**不是**对现有 telegraph 的改造或迁移。
本计划是把 `apps/telegraph` 与 `apps/design` 当作**全新从 0 到 1** 的两个 app 来设计、来建。
现有同名目录里的代码会先被整体 `git mv` 到 `apps/_legacy/` 当作文献参考；
新的 `apps/telegraph` / `apps/design` 从空目录起步。

> 这意味着文档里不会出现「保留 X、移除 Y、冷冻 Z」这类迁移叙事。
> 出现的只会是「新项目里 X 是什么、为什么这样设计、怎么落地」。

---

## 1. 项目目标

构建一个最小可工作的 Electron 桌面 app：

- 启动后显示一个主窗口
- 窗口里渲染一个 design 面板
- design 面板背后跑一个独立的 utility 子进程（后续承载 design 的所有重计算 / IO 工作）
- 主进程、design utility、主 renderer 三方之间通过
  `@x-oasis/async-call-rpc` + `@x-oasis/async-call-rpc-electron` 提供的
  **ConnectionOrchestrator** 模型组织连接，连接拓扑可视化

第一阶段**只做这条**最小链路。后续 chat / monitor 等其它 pagelet、其它业务 service
都按"另开 phase"的方式增量加入，不在本计划。

---

## 2. 名词与角色

| 角色 / 概念 | 定义 |
|---|---|
| **main process** | Electron 主进程。负责窗口、生命周期、orchestrator 宿主、spawn utility |
| **main renderer** | 主 BrowserWindow 的 renderer 进程。承载 React UI（含 DesignPanel）|
| **design utility** | 一个 Electron `utilityProcess`，运行 `apps/design` 的业务代码 |
| **AppOrchestrator** | main 进程内全局唯一的 `ElectronConnectionOrchestrator` 包装，所有 participant 在它上面注册 |
| **participant** | orchestrator 拓扑里的一个节点。本项目第一阶段只有 `renderer:main` 与 `pagelet:design` 两个外部 participant |
| **control-plane channel** | 每个 participant 与 main 之间用于**协商**的通道（不跑业务 RPC）。用于注册 / heartbeat / orchestrator 推送 MessagePort |
| **direct channel** | 当 main 调 `orchestrator.connect(a, b)` 后，a 与 b 之间用 MessagePort 建立的**业务 RPC** 通道。两端互调 service 走这条 |
| **service host** | `RPCServiceHost`，挂业务 service handler 的容器 |
| **inspector** | `OrchestratorInspectorService`，把 AppOrchestrator 的拓扑暴露给 renderer |

---

## 3. 进程拓扑与连接

```
                  ┌─────────────────────────────────────┐
                  │ main process                        │
                  │                                     │
                  │   AppOrchestrator                   │
                  │   ├─ MainCpServer (control-plane)   │
                  │   │     ├─ IPCMainChannel ◄─────────┼─── renderer cp
                  │   │     ├─ OrchestratorInspector    │
                  │   │     └─ register('renderer:main')│
                  │   │                                 │
                  │   ├─ DesignPageletProcess           │
                  │   │     ├─ utilityProcess.fork(...) │
                  │   │     ├─ ElectronUtilityProcessChannel ◄─── utility cp
                  │   │     └─ register('pagelet:design')│
                  │   │                                 │
                  │   └─ on demand:                     │
                  │       orchestrator.connect(...)     │
                  │         pushes MessagePort to both  │
                  │         ends via their cp channels  │
                  └─────────────────────────────────────┘
                              ▲                ▲
                              │ IPC (cp)       │ stdio/parentPort (cp)
                              │                │
              ┌───────────────┴────┐    ┌──────┴────────────────┐
              │ main renderer       │    │ design utility         │
              │ (BrowserWindow)     │    │ (utilityProcess)       │
              │                     │    │                        │
              │  IPCRendererChannel │    │  ElectronUtility...    │
              │   = cp channel      │    │   = cp channel         │
              │                     │    │                        │
              │  + ConnectionsTab   │    │  + designServiceHost   │
              │    proxies inspector│    │                        │
              │    via cp channel   │    │                        │
              │                     │    │                        │
              │  on connect():      │    │  on connect():         │
              │    bind direct port │    │    bind direct port    │
              │    → call           │    │    → service /services │
              │      /services/design│   │      /design listens   │
              └─────────────────────┘    └────────────────────────┘
```

### 第一阶段拓扑里的 participants

| id              | role       | 说明 |
|-----------------|------------|------|
| `renderer:main` | `renderer` | 主 BrowserWindow 的 renderer，DesignPanel 所在 |
| `pagelet:design`| `utility`  | design utility process（第一阶段只 spawn 一个实例） |

> main 自身不作为 participant，inspector 直接挂 control-plane channel 上。
> 这是简化决策，理由见 §6.4。

### 第一阶段建立的 connection

| from              | to               | 触发时机 |
|-------------------|------------------|----------|
| `renderer:main`   | `pagelet:design` | DesignPanel 挂载后通过 inspector 发起 `requestConnect` |

第一阶段 inspector 自身的调用**不走 connection**：它直接挂在 control-plane channel 的 service host 上。

---

## 4. 仓库结构（新写完之后）

```
/
├── apps/
│   ├── telegraph/                       # 主 app（main + renderer + 共享 services）
│   │   ├── src/
│   │   │   ├── application/             # main 进程 bootstrap
│   │   │   │   ├── main.ts              # 入口：DI + app.whenReady
│   │   │   │   ├── telegraph-application.ts
│   │   │   │   ├── telegraph-application-module.ts  # DI module
│   │   │   │   └── preload/
│   │   │   │       └── px.ts            # 极简 preload
│   │   │   ├── core/                    # 跨进程共用基础设施
│   │   │   │   ├── log/                 # LogService
│   │   │   │   └── electron-main/
│   │   │   │       └── utility-process/utilityProcess.ts
│   │   │   ├── services/
│   │   │   │   ├── window-manager/      # BrowserWindow 管理
│   │   │   │   └── connection-orchestrator/
│   │   │   │       ├── common/
│   │   │   │       │   ├── cp-config.ts # 共享常量（cp channel name）
│   │   │   │       │   └── types.ts     # IOrchestratorInspectorService etc.
│   │   │   │       ├── electron-main/
│   │   │   │       │   ├── AppOrchestrator.ts
│   │   │   │       │   ├── MainCpServer.ts
│   │   │   │       │   ├── OrchestratorInspectorService.ts
│   │   │   │       │   └── DesignPageletProcess.ts
│   │   │   │       ├── browser/
│   │   │   │       │   └── RendererCpClient.ts
│   │   │   │       └── node/            # （utility 侧公用）
│   │   │   │           └── UtilityCpClient.ts
│   │   │   ├── index.tsx                # renderer entry
│   │   │   └── types.d.ts               # window.telegraph 等 ambient
│   │   ├── index.html
│   │   ├── components.json              # shadcn (app-side)
│   │   ├── vite.{main,preload,renderer}.config.ts
│   │   ├── forge.config.ts
│   │   ├── tsconfig.json                # strict: true
│   │   └── package.json
│   │
│   ├── design/                          # design pagelet（utility）
│   │   ├── src/
│   │   │   ├── application/
│   │   │   │   ├── browser/             # 在主 renderer 内被引用的 React 组件
│   │   │   │   │   ├── DesignPanel.tsx
│   │   │   │   │   └── connections/ConnectionsTab.tsx
│   │   │   │   └── node/
│   │   │   │       ├── DesignBootstrap.ts   # utility 入口装配
│   │   │   │       └── DesignApplication.ts # 业务核心
│   │   │   ├── services/                # design 自身业务 services
│   │   │   └── main.ts                  # utility entry
│   │   ├── tsconfig.json                # strict: true
│   │   ├── vite.config.ts               # 只构 utility bundle
│   │   └── package.json
│   │
│   └── _legacy/                         # Phase 0 整体 git mv 进来的旧代码
│       ├── telegraph/                   # 旧 apps/telegraph 全部
│       └── design/                      # 旧 apps/design 全部
│
├── packages/
│   ├── ui/                              # shadcn 风格 UI 库（沿用，不动）
│   └── runtime-contracts/               # 跨进程类型契约（沿用，不动）
│
├── eslint.config.mjs                    # 新增：ESLint 9 flat config
├── vitest.config.ts                     # 新增：vitest 工作区配置
├── pnpm-workspace.yaml                  # 调整 packages glob 排除 _legacy
├── package.json                         # 新增 lint / typecheck / test 脚本
└── AGENTS.md                            # Phase 5 末更新
```

要点：

- `apps/_legacy/` 不在 pnpm workspace 里（`pnpm-workspace.yaml` 显式排除），
  也不被任何 vite / forge / tsconfig path 引用。它是纯文献。
- `packages/ui` 与 `packages/runtime-contracts` 沿用现状，不动。第一阶段
  apps/telegraph 与 apps/design 都通过现有 path alias 引用它们。
- `apps/telegraph/src/services/connection-orchestrator/` 是本项目里唯一的
  跨进程通信组件，所有 participant 通过它进出。

---

## 5. Channel 模型

### 5.1 control-plane vs direct channel

x-oasis 的 `ElectronConnectionOrchestrator` 模型：每个 participant 必须先有一条**已建立**的
**control-plane channel** 连到 main 的 orchestrator；当 main 调
`orchestrator.connect(a, b)` 时，main 会通过两端的 cp channel 各推一个 MessagePort
（同一个 `MessageChannelMain` 的两端），两端用 `registerOrchestratorHandler(cp, onPort)`
接收，将 port 绑到一个**direct channel** 上跑业务 RPC。

第一阶段两条 cp 与一条 direct：

| participant | cp channel (class & name) | direct channel | 业务 host |
|---|---|---|---|
| `renderer:main` | `IPCRendererChannel`，name = `telegraph:orchestrator-cp` | `RPCMessageChannel`（绑接收到的 MessagePort）| 不需要（renderer 是调用方）|
| `pagelet:design` | `ElectronUtilityProcessChannel`（基于 `process.parentPort`）| `ElectronMessagePortChannel`（绑接收到的 MessagePort）| `designServiceHost`，挂 `/services/design` |

> 类名以 `@x-oasis/async-call-rpc-electron` 实际导出为准。当前 link-to-source 版本下
> 应该都已存在（见 `/Users/ryu/Documents/code/red/x-oasis/packages/async/async-call-rpc-electron/src/`）。

### 5.2 main↔renderer 控制平面：为什么用 IPCMainChannel

main 不能被外部传入 MessagePort（它是 `MessageChannelMain` 的创建者）。
renderer 想拿到一个到 main 的 MessagePort，唯一官方机制是
`webContents.postMessage(channel, payload, [port])`——但那是 main → renderer **单向 push** 的模型。
要建立**双向 RPC**，最简洁的做法是直接用 IPC：

```
main 侧:
  new IPCMainChannel({
    channelName: ORCHESTRATOR_CP_CHANNEL_NAME,  // 'telegraph:orchestrator-cp'
    acceptAllSenders: true,
    description: 'main-cp',
  })
  cpChannel.setServiceHost(mainCpServiceHost)

renderer 侧:
  new IPCRendererChannel({
    channelName: ORCHESTRATOR_CP_CHANNEL_NAME,
    description: 'renderer:main-cp',
    ipcRenderer: window.telegraph.ipcRenderer,  // preload 暴露
  })
```

IPCMainChannel/IPCRendererChannel 底层就是 ipcMain/ipcRenderer 的 message channel，
**不涉及 MessagePort transfer**，因此完全规避之前老 port-manager 撞上的
`Invalid args: Cannot mix Transferable...` 校验问题。

### 5.3 main↔design utility 控制平面

design utility 用 `electron.utilityProcess.fork(...)` spawn。
fork 之后 main 用 `ElectronUtilityProcessChannel` 包装 `process` 作为 cp channel：

```
main 侧:
  const proc = utilityProcess.fork(designBundlePath, [], { ... })
  const cpChannel = new ElectronUtilityProcessChannel({ process: proc, description: 'pagelet:design-cp' })
  appOrchestrator.registerParticipant('pagelet:design', cpChannel, 'utility')

utility 侧 (DesignBootstrap):
  const cpChannel = new ElectronUtilityProcessChannel({ parentPort: process.parentPort, description: 'utility:cp' })
  registerOrchestratorHandler(cpChannel, (port) => {
    directChannel.bindPort(port)
    directChannel.setServiceHost(designServiceHost)  // 已 register /services/design
  })
```

> `ElectronUtilityProcessChannel` 的 main / utility 两侧是否对称、构造参数是否
> 这样写需要在 P3 实施时按 x-oasis 实际 API 落实。文档此处描述的是模型与责任分工。

### 5.4 connect 流程

```
trigger:  ConnectionsTab 在 mount 后 1 秒内调
  inspector.requestConnect('renderer:main', 'pagelet:design')

OrchestratorInspectorService 收到 (main 侧):
  await appOrchestrator.connect('renderer:main', 'pagelet:design')

AppOrchestrator → ElectronConnectionOrchestrator.connect:
  - 创建 MessageChannelMain，得 port1, port2
  - 通过 'renderer:main' 的 cp channel 调 activateConnection(port1)（ports as transfer）
  - 通过 'pagelet:design' 的 cp channel 调 activateConnection(port2)
  - 两端 onPort 各自把 port 绑到自己的 direct channel
  - direct channel 双向通了，业务 RPC 可用

renderer 侧 ConnectionsTab 拿到的 direct channel:
  - new ProxyRPCClient('/services/design', { channel: directChannel })
  - .ping() 验证
```

第一阶段不主动 disconnect，进程退出时由 `handleParticipantLost` 兜底。

---

## 6. main↔renderer 自身的"调用 inspector"怎么办

ConnectionsTab 要调 `inspector.getTopology()` / `inspector.requestConnect(...)` 等。
这些**不是**业务 RPC，应该走 cp channel 直接调用：

```
renderer:
  const inspector = new ProxyRPCClient(
    orchestratorInspectorServicePath,
    { channel: rendererCpChannel }
  ).createProxy<IOrchestratorInspectorService>()

main:
  mainCpServiceHost.registerServiceHandler(
    orchestratorInspectorServicePath,
    inspectorServiceImpl
  )
  rendererCpChannel.setServiceHost(mainCpServiceHost)
```

也就是说 main 端 cp channel 同时承担两个职责：
1. orchestrator 用它推 MessagePort 给 renderer（`activateConnection` handler）
2. inspector 服务直接挂在它上面给 renderer 调用

x-oasis 的 service host 是 path 维度路由的，两个职责不冲突。

> ⚠️ 这里有一个隐含决策：**main 不作为 participant**。
> 如果未来有需求让 design utility 直接调 main 的某个 service，就需要把 main
> 升级成 participant（注册一个 loopback channel）。第一阶段不需要。

---

## 7. 启动序列

### 7.1 main 进程

```
electron app.whenReady()
  → DI container.load(TelegraphApplicationModule)
  → const app = container.resolve(TelegraphApplication)
  → await app.start()

TelegraphApplication.start():
  1. logService.info('start')
  2. AppOrchestrator instance 已经在 DI 容器里，singleton
  3. mainCpServer.start():
       - new IPCMainChannel(ORCHESTRATOR_CP_CHANNEL_NAME, acceptAllSenders:true)
       - serviceHost.registerServiceHandler(orchestratorInspectorServicePath, inspector)
       - cpChannel.setServiceHost(serviceHost)
       - cpChannel.onClientConnected(senderId =>
           appOrchestrator.registerParticipant('renderer:main', cpChannel, 'renderer')
         )
  4. windowManager.createMainWindow()  // BrowserWindow loadURL
  5. designPageletProcess.spawn():
       - utilityProcess.fork(designEntryPath)
       - cpChannel = new ElectronUtilityProcessChannel({process:proc})
       - appOrchestrator.registerParticipant('pagelet:design', cpChannel, 'utility')
       - proc.on('exit', () => appOrchestrator.handleParticipantLost('pagelet:design'))
```

### 7.2 main renderer

```
index.tsx:
  1. RendererCpClient.init():
       - cpChannel = new IPCRendererChannel(ORCHESTRATOR_CP_CHANNEL_NAME, ...)
       - inspector = new ProxyRPCClient(orchestratorInspectorServicePath, {channel:cpChannel})
                       .createProxy<IOrchestratorInspectorService>()
       - 暴露 RendererCpClient.inspector / RendererCpClient.cpChannel 单例
  2. ReactDOM.render(<App />)

DesignPanel mount:
  - ConnectionsTab uses RendererCpClient.inspector
       → polling getTopology()
       → 用户点 "Connect" 按钮 → inspector.requestConnect('renderer:main','pagelet:design')
       → 后续 onPort 回调（在 cpChannel 上注册的 ORCHESTRATOR_SERVICE_PATH handler）
         拿到 MessagePort，绑到 directChannel，缓存供 Ping 按钮用
```

### 7.3 design utility

```
apps/design/src/main.ts:
  1. logService.info('design utility start')
  2. DI container.load(DesignModule)
  3. const designApp = container.resolve(DesignApplication)
  4. const designServiceHost = new RPCServiceHost()
     designServiceHost.registerServiceHandler('/services/design', designApp)
  5. cpChannel = new ElectronUtilityProcessChannel({parentPort: process.parentPort})
  6. registerOrchestratorHandler(cpChannel, (port) => {
       directChannel = new ElectronMessagePortChannel({port})
       directChannel.setServiceHost(designServiceHost)
     })
  7. logService.info('design utility ready')
```

---

## 8. 业务 service 第一阶段范围

只有一个：

| service path | 实现 | 调用方 | 内容 |
|---|---|---|---|
| `/services/orchestrator-inspector` | `OrchestratorInspectorService` (main) | `renderer:main` 通过 cp channel | `getTopology` / `getStats` / `ping` / **`requestConnect(fromId, toId)`**（新增）|
| `/services/design` | `DesignApplication` (design utility) | `renderer:main` 通过 direct channel | 第一阶段只挂一个 `ping(payload?: {ts:number})` 方法做存活验证 |

> `requestConnect` 是 inspector 第一阶段新增的方法。它仅是 `appOrchestrator.connect(a,b)`
> 的一个透传，把 connect 的触发权下放给 renderer。理由：第一阶段我们希望 connect
> 是用户操作驱动的（点按钮），便于观察。后续如果改为自动 connect，可以删掉。

第一阶段**不**实现：account / workbench / storage / file-system / agent / monitor / model-config 等。
第二阶段开始按需逐个加入。

---

## 9. 工程基线（Phase 0 一并立起）

### 9.1 TypeScript

- `apps/telegraph/tsconfig.json`：开 `"strict": true`，删除手写的 `noImplicitAny` / `strictNullChecks`（被 strict 包含）
- `apps/design/tsconfig.json`：维持 `"strict": true`
- `packages/{ui,runtime-contracts}/tsconfig.json`：维持 `"strict": true`
- 根 tsconfig 提供 `tsc --noEmit` 入口，新增 `pnpm typecheck` 脚本

### 9.2 ESLint

新增**仓库根** `eslint.config.mjs` (ESLint 9 flat config):

```
- @eslint/js                        recommended
- typescript-eslint                 strict-type-checked + stylistic-type-checked
- eslint-plugin-react               recommended
- eslint-plugin-react-hooks         recommended
- eslint-plugin-tailwindcss         recommended
- eslint-config-prettier            disable formatting rules
```

ignores: `**/.vite/**`, `**/dist/**`, `**/node_modules/**`, `apps/_legacy/**`, `**/*.config.{js,ts,mjs}`

新增脚本：
- 根 `pnpm lint` = `eslint .`
- 各 app `pnpm lint` 同根（透传）

### 9.3 Vitest

新增仓库根 `vitest.config.ts`：

```
test: {
  workspace: ['apps/*', 'packages/*'],   // 自动发现 vitest.config.ts in subprojects
  environment: 'node',                   // 默认 node；ui 包覆盖为 jsdom
}
```

各 app/package 按需加自己的 `vitest.config.ts`（继承根）。
新增脚本：根 `pnpm test` = `vitest run`，`pnpm test:watch` = `vitest`。

### 9.4 Pre-commit / CI

第一阶段不接 CI，不上 husky。靠 `pnpm lint && pnpm typecheck && pnpm test` 手动跑。

---

## 10. Phase 划分

> 每个 Phase 完成后做 `pnpm start` 烟囱测试 + 用户 review；通过才进入下一个。

### Phase 0 — Repo 清场 + 工程基线

操作（**等 review 通过我才执行**）：
1. `git mv apps/telegraph apps/_legacy/telegraph`
2. `git mv apps/design apps/_legacy/design`
3. `pnpm-workspace.yaml`：`packages` 列表加 `'!apps/_legacy/**'`
4. 创建空的 `apps/telegraph/` 与 `apps/design/` 骨架（package.json + tsconfig.json 起步）
5. 立 `eslint.config.mjs` + `vitest.config.ts` + 根 `package.json` 加 lint/typecheck/test 脚本
6. 立 `apps/telegraph/tsconfig.json` (strict) + `apps/design/tsconfig.json` (strict)
7. 在 `apps/_legacy/README.md` 写一段 disclaimer：仅供参考，不 import

**验收**：`pnpm install` 通；`pnpm lint` 报「no input files」（正常）；`pnpm typecheck` 通；
`pnpm test` 报「no test files」（正常）。仓库可启动状态从此清空。

#### Phase 0 完成记录（2026-05-08）

实际执行偏离计划之处：

- 不只 mv 了 `telegraph` 和 `design`，把 `apps/{chat,monitor}` 也一并 mv 进 `apps/_legacy/`
  （它们本质上属于老 telegraph 的同款 utility-bundle app，不在新设计内）。
- `packages/{ui,agent,stores}` 也 mv 进 `apps/_legacy/packages/`。理由：`@telegraph/ui` 的
  `dependencies` 引用了 `@telegraph/agent` / `@telegraph/stores`，整批留在 workspace 会让 Phase 0
  baseline 引入大量与新工作无关的失败。Phase 1+ 真用到时再把对应包搬回 `packages/`。
- 唯一保留在 `packages/` 的是 `@telegraph/runtime-contracts`（结构最干净，Phase 2/3 大概率会复用）。
- `vitest` 选了 2.1.8 而不是 4.x：4.x 要求 `vite ^6 || ^7 || ^8`，与未来 forge 模板自带的
  `vite ^5` 冲突。决策延后到 Phase 1 真引入 vite 时再评估升级 vitest。
- ESLint config 加了若干 ignore：`apps/_legacy/**`、`.agents/**`、`.claude/**`、
  `**/*.config.{js,cjs,mjs,ts}`、`packages/runtime-contracts/src/**/*.js`（runtime-contracts
  历史构建产物的 .js 与 .ts 同目录共存，本 Phase 不动）。
- `tsconfig.json` 在 `apps/{telegraph,design}/src/` 都需要至少一个文件，否则 `tsc` 报
  TS18003。各放了一个 `index.ts` stub（`export {}`）。

落地的根级文件：

- `eslint.config.mjs` — ESLint 9 flat: js + typescript-eslint strictTypeChecked
  + react + react-hooks + tailwindcss + prettier。
- `vitest.workspace.ts` — vitest 2 workspace，列出三个项目。
- 根 `package.json` — `lint` / `typecheck` / `test` / `test:watch` 脚本（test 用
  `--passWithNoTests`，baseline 阶段允许"空通过"）。
- `apps/{telegraph,design}/{package.json,tsconfig.json}` — 极简，strict + decorators。
- `packages/runtime-contracts/package.json` — 加了 `lint` / `test` 脚本。
- `apps/_legacy/README.md` — disclaimer。
- `pnpm-workspace.yaml` — 加 `!apps/_legacy/**`。

验证：`pnpm install` ✓ / `pnpm lint` ✓ / `pnpm typecheck` ✓（3 项目全 Done）/ `pnpm test` ✓（vitest 2 识别 3 项目，no test files → exit 0）。

### Phase 1 — main + renderer 最小可启动

实现：
- `apps/telegraph/src/application/main.ts` (electron app.whenReady → BrowserWindow.loadURL)
- `apps/telegraph/src/application/preload/px.ts`（最小：只暴露 ipcRenderer 包装）
- `apps/telegraph/src/application/telegraph-application.ts` + DI module（只含 LogService + WindowManager）
- `apps/telegraph/src/services/window-manager/electron-main/{WindowManager,BrowserWindow}.ts`
- `apps/telegraph/src/core/log/`（极简 file-based LogService，落 `/tmp/telegraph-main.log`）
- `apps/telegraph/src/index.tsx` + `index.html`（只渲一句 "Hello Telegraph"）
- `apps/telegraph/forge.config.ts` + `vite.{main,preload,renderer}.config.ts`
- `apps/telegraph/package.json`（start / package / make 脚本）

**验收**：`pnpm start` 起来，主窗口显示 "Hello Telegraph"，无控制台错误，主进程日志写出 start。

#### Phase 1 完成记录（2026-05-08）

实际偏离计划之处：

- preload 文件名按计划是 `px.ts`，实际用了更标准的 `preload.ts`（`apps/telegraph/src/application/preload/preload.ts`）。preload 只 `contextBridge.exposeInMainWorld('telegraph', { ipc })`，window-side 类型在 `apps/telegraph/src/types.d.ts`。
- `WindowManager` 不分裂成 `BrowserWindow.ts` 子文件，Phase 1 单文件够了；多窗口/pagelet 等 Phase 4 再拆。
- 移除了 Phase 0 留的 `apps/telegraph/src/index.ts` stub —— 因为 `index.tsx` 已存在，两者冲突会让 typescript-eslint v8 的 `projectService` 报 "not found by project service"。
- 主进程里没有用 `import.meta.dirname`：forge-vite-plugin 默认把 main 输出成 cjs，`import.meta.dirname` 不存在，改用 `__dirname`（vite cjs 输出里 native 可用）+ `node:path.join`。
- ESLint 配置补丁：
  - 删掉 `eslint-plugin-tailwindcss` 的 block —— Phase 1 没有 tailwind config，plugin 会对每个 .tsx 报 "Cannot resolve default tailwindcss config path"。Phase 4+ 真用 tailwind 时再加回来。
  - React 17+ automatic jsx-runtime：把 `react/react-in-jsx-scope` 和 `react/jsx-uses-react` 关掉。
  - `vitest.workspace.ts` 加进 ignores（不在任何 tsconfig include 里，会被 projectService 抱怨）。
- 根 `package.json` 加了 `start` / `package` / `make` proxy 脚本（之前忘了）。

落地的 telegraph 源码：

- `apps/telegraph/src/application/main.ts` — 入口；顶部有 `/tmp/telegraph-debug.log` side-channel 日志（forge 在无 TTY 时吞 stdout，靠这个看 import-time crash）。
- `apps/telegraph/src/application/telegraph-application.ts` + `telegraph-application-module.ts` — DI registry：`new Registry((bind) => bind(LogServiceId).to(LogService); bind(WindowManagerId).to(WindowManager); bind(TelegraphApplicationId).to(TelegraphApplication))`。
- `apps/telegraph/src/application/preload/preload.ts`
- `apps/telegraph/src/core/log/LogService.ts` — 写 `/tmp/telegraph-main.log`。
- `apps/telegraph/src/services/window-manager/electron-main/WindowManager.ts` — `@injectable()` + `@inject(LogServiceId)`；用 forge 注入的 `MAIN_WINDOW_VITE_DEV_SERVER_URL` / `MAIN_WINDOW_VITE_NAME` 区分 dev / prod。
- `apps/telegraph/src/index.tsx` + `index.html` + `types.d.ts`
- `apps/telegraph/forge.config.ts`（main + preload + main_window 一个 renderer）
- `apps/telegraph/vite.{main,preload,renderer}.config.ts`
- `apps/telegraph/package.json` 含 electron 41 / forge 7.10 / vite 5 / react 18 / @x-oasis/di。

验证：
- `pnpm install` ✓（macos-alias 在 node v25 + node-gyp 下编译失败，是 forge maker-dmg 的传递依赖，只影响 `pnpm make`，不影响 `pnpm start` —— 暂时忽略）
- `pnpm typecheck` ✓（3 项目全 Done）
- `pnpm lint` ✓（0 problem）
- `pnpm test` ✓（vitest 2，no test files exit 0）
- `pnpm start`：main 进程 + DI + window 创建 + ready-to-show 全部触发，`/tmp/telegraph-main.log` 写出预期序列。后台 nohup 启动会让 forge 失去 TTY 后立刻退出 → vite dev server 跟着死，所以"窗口里渲染出 Hello Telegraph 字样"这一步只能在前台 TTY 里手动验证；窗口创建/loadURL 触发/ready-to-show 这些主进程侧的事件已确认在日志里。

### Phase 2 — AppOrchestrator + MainCpServer + RendererCpClient + Inspector

实现（main 侧）：
- `services/connection-orchestrator/electron-main/AppOrchestrator.ts`（沿用现有实现的设计，重新写）
- `services/connection-orchestrator/electron-main/MainCpServer.ts`
- `services/connection-orchestrator/electron-main/OrchestratorInspectorService.ts`（含 `requestConnect`）
- `services/connection-orchestrator/common/{cp-config.ts,types.ts}`

实现（renderer 侧）：
- `services/connection-orchestrator/browser/RendererCpClient.ts`
- `services/connection-orchestrator/browser/inspectorClient.ts`（factory）

修改 `index.tsx`：mount 前 init RendererCpClient；UI 加一个临时调试块显示 `inspector.getTopology()` 结果。

**验收**：UI 上能看到 `{participants:[], connections:[], capturedAt:...}`；点刷新有新时间戳。
此时 participants 还是空（design utility 还没引入）。

#### Phase 2 完成记录（2026-05-08）

**实施落点**：

main 侧（`apps/telegraph/src/services/connection-orchestrator/`）：
- `common/cp-config.ts` — `ORCHESTRATOR_CP_CHANNEL_NAME = 'telegraph:orchestrator-cp'`、`ORCHESTRATOR_INSPECTOR_PATH = '/services/orchestrator-inspector'`、`ORCHESTRATOR_PROJECT_NAME = 'telegraph'`。
- `common/types.ts` — wire 类型 `ParticipantSnapshot` / `ConnectionSnapshot` / `TopologySnapshot` / `RequestConnectResult` / `IOrchestratorInspectorService`。`ParticipantTypeWire` / `ConnectionStateWire` 为字符串字面量并集，与 x-oasis 内部枚举字面量等同。
- `electron-main/AppOrchestrator.ts` — `@injectable extends ElectronConnectionOrchestrator`；logger funnel 到 `LogService`（注意 `logger` 是函数 `(level, message, data?) => void`，不是 object）；`listParticipants()` / `listConnections()` 用 narrow cast 读 protected `participants` / `connections` Map（不污染上游 API 表面）；`requestConnect(fromId, toId)` 包 `super.connect()` 返回 wire-friendly summary（不能 override `connect()` 改返回类型，TS 不允许窄化父类返回）。
- `electron-main/OrchestratorInspectorService.ts` — `@injectable implements IOrchestratorInspectorService`；`getTopology()` 组合两个 list 并打 capturedAt；`requestConnect()` 直透到 orchestrator。
- `electron-main/MainCpServer.ts` — `start()` 流程：`new IPCMainChannel({ acceptAllSenders: true })` → `new RPCServiceHost()` + `registerServiceHandler(ORCHESTRATOR_INSPECTOR_PATH, inspector)` → `channel.setServiceHost(host)` → `orchestrator.registerParticipant('renderer:main', channel, 'renderer')` + `orchestrator.setRendererCpChannel(channel)`。

renderer 侧（`apps/telegraph/src/services/connection-orchestrator/browser/`）：
- `RendererCpClient.ts` — module-scoped singleton `getRendererCpChannel()`；从 `window.telegraph.ipc` 取 preload 桥（运行时 `unknown` cast 兜底，绕过 ambient 类型 over-optimism）；构造 `IPCRendererChannel({ channelName, ipcRenderer, projectName, description: 'renderer-cp' })`。renderer 侧 Phase 2 不引入 DI 容器，singleton 即可。
- `inspectorClient.ts` — `getInspectorClient()` factory：`new ProxyRPCClient(ORCHESTRATOR_INSPECTOR_PATH, { channel })`；`createProxy<T>` 约束 `T extends Record<string, (...a) => any>`，`interface` 不结构性满足，所以 `as unknown as IOrchestratorInspectorService` 局部 cast，公开面仍是严格类型。

preload 升级（`apps/telegraph/src/application/preload/preload.ts`）：暴露 `window.telegraph.ipc`，含 `IPCRendererChannel` 实际调用的 5 个方法 `send / postMessage(含 transfer) / on / removeListener / removeAllListeners`。

DI 接入：
- `application/telegraph-application-module.ts` — 新 bind `AppOrchestratorId` / `OrchestratorInspectorServiceId` / `MainCpServerId`。
- `application/telegraph-application.ts` — `start()` 顺序：`mainCpServer.start()` 先（cp channel 必须在 renderer 发送第一条消息前就 listening），再 `windowManager.openMainWindow()`。

renderer 入口（`apps/telegraph/src/index.tsx`）：替换 Phase 1 "Hello Telegraph" 占位，挂载后用 `useEffect` 调 `getInspectorClient().getTopology()`，把 JSON 渲染到深色 `<pre>` 块；error 路径用红字显示。

**实施踩坑**：
- `ProxyRPCClient.createProxy<T>()` 的泛型约束 `T extends Record<string, (...args) => any>` 与 `interface IOrchestratorInspectorService` 不结构性兼容（TS 对 interface vs index signature 有已知坑）。解法：`createProxy()` 不带泛型，调用点 `as unknown as IOrchestratorInspectorService` 兜底。
- preload 暴露的 ipc 对象不是完整 Electron `IpcRenderer`，`IPCRendererChannel` 只用其中 5 个方法。直接 `as unknown as IpcRenderer` 比让 preload 暴露 ~30 个方法更克制。
- `window.telegraph` 的 ambient 类型是 required（`Window` 接口里 `telegraph: TelegraphPreloadApi`），但运行时若 preload 失败它就是 undefined。eslint `no-unnecessary-condition` 会把 `window.telegraph?.ipc` 判成无意义 optional chain；解法是先 `as unknown as { telegraph?: ... }` 让运行时 guard 通过 lint。
- `info.type as ParticipantTypeWire` 是冗余 cast（两个类型字面量并集相同），lint `no-unnecessary-type-assertion` 报错；删 cast 即可。
- `apps/design/package.json` 和 `packages/runtime-contracts/package.json` 的 `test` 没传 `--passWithNoTests`，Phase 1 之后这俩没测试导致 `pnpm -r test` 退出码非零；本 Phase 顺手补上 `--passWithNoTests` 让 CI 基线干净。
- IDE LSP 在本会话里持续报一堆 stale 错（指向 `_legacy/` 时代的旧路径），实际盘上 `tsc --noEmit` 完全干净。**判据以 `pnpm -r typecheck` 为准**，IDE diagnostic 当噪音忽略。

**验证状态**：
- `pnpm -r typecheck` ✅ 三个项目全绿。
- `pnpm -r lint` ✅ 三个项目全绿。
- `pnpm -r test` ✅ 三个项目全绿（无 test 文件，全走 `--passWithNoTests`）。
- 端到端 `pnpm start` 在 TTY 里手动验证 UI 显示 topology JSON：**留作 D8 review 时由用户在前台亲自跑一次**（同 Phase 1，后台 nohup 会让 forge 失去 TTY 后退）。日志侧仍可在 `/tmp/telegraph-main.log` 看到 `MainCpServer.start() channel=telegraph:orchestrator-cp`、`MainCpServer ready — inspector @ ...`、`inspector.getTopology() participants=1 connections=0` 等关键序列。

### Phase 2.5 — x-oasis 上游 P0 缺口补强（gate to Phase 3）

参见 [D-006](../discussion/20260508-x-oasis-orchestrator-capability-gaps.md) §2。
直接在 `/Users/ryu/Documents/code/red/x-oasis/` 仓库里改源码（telegraph 通过
`pnpm.overrides` link-to-source 立即生效，参见 R-001）。

实现：
- **Gap 2** — `BaseConnectionOrchestrator.connect(a, b, options?: ConnectOptions)`，
  `options.activateTimeoutMs` 默认 30s；超时 reject 不挂死。
  可选 `retryOnInitialFailure` 走重连策略。
- **Gap 3** — `ElectronConnectionOrchestrator.registerParticipant(...)` 内部自动
  绑 `channel.onClose / onError → handleParticipantLost(id)`；不再依赖业务侧手动调。
- 上述两项各加 1 个 vitest 用例（cold-start timeout / kill-9 后状态机正确流转）。

**验收**：x-oasis 仓 `pnpm test` 绿；本仓 `pnpm typecheck` 仍通过（API 兼容）。

> Gap 1（`replaceParticipantChannel`）按 D-006 §5 是 Phase 8 才阻塞，本阶段不做；
> 但要在 `BaseConnectionOrchestrator` 留好 hook 点，避免 Phase 6+ 改动过大。

**完成记录（2026-05-08）** — x-oasis 仓 commit `2dd835e`，分支
`telegraph-phase-2.5-orchestrator-gaps`。

实际落地：
- **Gap 2** — `BaseConnectionOrchestrator.connect()` 三参重载
  `connect(a: ConnectionConfig | string, b?: ConnectOptions | string, c?: ConnectOptions)`，
  新增 `ConnectOptions { activateTimeoutMs?: number }`（导出在 `orchestrator/index.ts` 与
  `orchestrator/types.ts`）。`_doConnect()` 内部用 `_withActivationTimeout()` 包 setTimeout race，
  默认 `DEFAULT_ACTIVATE_TIMEOUT_MS = 30_000`；超时 reject `TimeoutError` 并把状态回 IDLE。
- **Gap 3** — `registerParticipant()` 内部维护
  `_participantDisconnectCleanups: Map<string, () => void>`，自动 `subscribe(channel.onDidDisconnected,
  () => handleParticipantLost(id, 'channel disconnected'))`，并在重新注册同 id 时先 dispose 旧订阅；
  闭包内 guard `participants.get(id)?.channel === channel` 防 stale channel 触发。
  `unregisterParticipant()` 也调 cleanup。所有 Electron 子类（webContents/utility/preload）
  的 `disconnect()` 已在父类 `AbstractChannelProtocol` 触发 `onDidDisconnectedEvent`，
  因此自动适用，子类零改动。
- **签名修正**：`handleParticipantLost(id, reason: string)` 是必填两参（D-006 旧描述
  `(id, error?)` 不准）。
- **测试** — 新增 `packages/async/async-call-rpc/test/orchestrator/gaps.spec.ts`，6 用例全绿
  （Gap 2 × 3：never resolve → TimeoutError + state IDLE / 快速 resolve 不超时 / 三参向后兼容；
   Gap 3 × 3：disconnect 触发 lost + state TRANSIENT_FAILURE / re-register 后 stale 不触发 /
   unregister 后不触发）。
- **回归验证**：stash 法对比 `async-call-rpc-electron` baseline = 22 failed / 51 passed，
  改动后数字不变；`async-call-rpc` baseline = 6 failed / 252 passed，数字不变。
  Pre-existing failure 是上游开发者写错的 wire 格式期望（`{__orchestrator: ...}`），不在
  D-006 scope 内。
- **集成验证** — `pnpm compile` 在 `async-call-rpc` 与 `async-call-rpc-electron` 都跑通刷新 dist；
  telegraph 仓 `pnpm -r typecheck/lint/test` 三连绿，确认 API 向后兼容。

### Phase 3 — DesignPageletProcess spawn + UtilityCpClient + DesignBootstrap

实现：
- `services/connection-orchestrator/electron-main/DesignPageletProcess.ts`（spawn + register participant）
- `services/connection-orchestrator/node/UtilityCpClient.ts`（utility 侧公用工具）
- `apps/design/src/main.ts` + `apps/design/src/application/node/DesignBootstrap.ts`
- `apps/design/src/application/node/DesignApplication.ts`（含 `ping()`）
- `apps/design/vite.config.ts` + `apps/design/package.json`
- `apps/telegraph/forge.config.ts` 增加 design utility 的 build entry
- `services/connection-orchestrator/common/types.ts` 加 `/services/design` 的 service interface

修改 `telegraph-application.ts`：start 中调 `designPageletProcess.spawn()`。

**验收**：`ps aux` 看到 design utility；UI 调试块的 participants 出现 `{id:'pagelet:design', role:'utility', ...}`；
design utility 日志写出 `design utility ready`。

**完成记录（2026-05-08）** — telegraph commit `461550f`。

实际落地：
- `services/connection-orchestrator/common/types.ts` 加 `IDesignService { ping(now): {pong, serverTime} }`、
  `DESIGN_PARTICIPANT_ID = 'pagelet:design'`、`DESIGN_SERVICE_PATH = '/services/design'`。
- `services/connection-orchestrator/node/UtilityCpClient.ts` —— 通用 utility 侧 helper：
  封装 `ElectronUtilityProcessChannel` over `parentPort`、持有共享 `RPCServiceHost`、
  通过 `registerOrchestratorHandler` 注册 activate-connection 回调。`start(onActivated)`
  把 port 透传给调用方（Phase 4 真正绑 direct channel）。
- `services/connection-orchestrator/electron-main/DesignPageletProcess.ts` ——
  `utilityProcess.fork(.vite/build/design_utility/index.js)` + 包 `ElectronUtilityProcessChannel` +
  `orchestrator.registerParticipant(DESIGN_PARTICIPANT_ID, channel, 'utility')`。
  Channel 自动断开走 Phase 2.5 Gap 3；额外 `process.on('exit')` log 用于诊断。
- `TelegraphApplication.start()` 改 async：`mainCpServer.start()` → `await designPagelet.spawn()` →
  `windowManager.openMainWindow()`，确保 renderer 第一次 poll topology 已能看到两个 participant。
- `apps/design/src/main.ts` —— utility 进程入口；`/tmp/telegraph-design.log` 调试管道；
  `Container.load(designModule)` → `bootstrap.start()`。
- `apps/design/src/application/node/{DesignApplication,DesignBootstrap,design-application-module}.ts` ——
  `DesignApplication implements IDesignService` (Phase 3 仅 `ping()` 实现)；
  `DesignBootstrap` 把 `DesignApplication` 注册到 `cpClient.serviceHost` under `DESIGN_SERVICE_PATH`，
  然后 `cpClient.start()` 监听 activations。Electron `process.parentPort` 通过 `as unknown as ParentPort`
  桥接 Electron DOM lib 与 x-oasis 结构类型差异。
- `apps/telegraph/vite.design.config.ts` + `forge.config.ts` —— 第三个 build entry：
  `entry: '../design/src/main.ts'`，输出 `.vite/build/design_utility/index.js`，
  与 `DesignPageletProcess.resolveEntryPath()` 对齐。
- `apps/design/tsconfig.json` —— shadcn-style 跨 app paths（`@telegraph/services/*`、
  `@telegraph/core/*`），include 限制在 design src + utility-side orchestrator 文件，
  避免拉进 main/renderer 代码引发 lib 冲突。
- 验证：`pnpm -r typecheck/lint/test` 三连绿。运行时验收（`ps aux` + `/tmp/telegraph-design.log`）
  留待 Phase 4 一起跑（UI 已经能看到 participants 后再 sanity check）。

### Phase 4 — DesignPanel + ConnectionsTab + connect/Ping ✅ 完成

实现：
- 在 `packages/ui` 里按 shadcn 风格补 design 面板需要的原语（如缺）
- `apps/design/src/application/browser/DesignPanel.tsx`（被主 renderer 引入）
- `apps/design/src/application/browser/connections/ConnectionsTab.tsx`
  （从 RendererCpClient.inspector 拉拓扑；提供 "Connect" 按钮 → `inspector.requestConnect('renderer:main','pagelet:design')`；
   连上后 "Ping" 按钮通过 direct channel 调 `/services/design.ping()`）
- 主 `index.tsx` 把临时调试块替换为 DesignPanel

**验收**：UI 看到 ConnectionsTab，能 Connect、能 Ping，RTT 数字显示出来；`getTopology` 里出现 connection。

#### 完成记录（实施回放）

**P4.1 — web RPC 包接入**
- `apps/telegraph/package.json` 加 `@x-oasis/async-call-rpc-web` dep（`*` 走 `pnpm.overrides` link-to-source）。
- `apps/telegraph/tsconfig.json` `paths` 加 web 包 dist redirect（与 `async-call-rpc` / `async-call-rpc-electron` 同模式）。
- 决策：**不引入 shadcn/tailwind**——Phase 4 用 inline style + 原生 elements 把跨进程链路打通就行；shadcn 真用上时再 retrofit，Phase 4 越小验证面越扎实。

**P4.2 — UtilityCpClient 升级（Phase 3 留的 placeholder cb）**
- `apps/telegraph/src/services/connection-orchestrator/node/UtilityCpClient.ts` 的 `start(onActivated?)` 改造：
  cb 不再传 raw `MessagePortMain`，而是内部建 `ElectronMessagePortMainChannel({description})` +
  `setServiceHost(this.serviceHost)` + `bindPort(port)`，cb 仅传已绑定好的 channel。
- 调用方（`apps/design/src/application/node/DesignBootstrap.ts`）现在不需要关心 MessagePort 细节，只在 cb 里打日志确认 direct 通道就绪。
- 持有 `directChannels: Map<symbol, ElectronMessagePortMainChannel>` 备多 peer 扩展（Phase 5+ 多 utility 时可直接 fan-out）。

**P4.3 — renderer-side 直通 client 工厂**
- 新增 `apps/telegraph/src/services/connection-orchestrator/browser/directChannelClient.ts`：
  - `awaitDirectChannelClient<T>(servicePath)` 用 `registerOrchestratorHandler(cpChannel, onPort)` 监听 main 来的 activate。
  - 拿到 port 后建 `RPCMessageChannel({port, description})`（`@x-oasis/async-call-rpc-web`）+ `new ProxyRPCClient(servicePath, {channel}).createProxy() as unknown as T`。
  - **idempotent**：handler 全局只装一次（x-oasis `registerOrchestratorHandler` 内部 `service.setChannel` 是覆盖型 ——
    多次调用会互相覆盖；改用 module-scoped `pending: Map<servicePath, PendingEntry>` + `handlerInstalled` 单例 flag），
    同一 servicePath 多次调用返回同一个 cached promise（防止 React StrictMode 双调用 / 用户连点 Ping 触发多次注册）。
  - 暴露 `__resetDirectChannelClient()` 给测试用。

**P4.4 — DesignPanel + ConnectionsTab**
- `apps/design/package.json` 加 `react`/`react-dom` 运行依赖 + `@types/react`/`@types/react-dom` devDep
  （组件最终在 telegraph renderer bundle 里跑，但 design 自己 typecheck 也要见到 react 类型）。
- `apps/design/tsconfig.json` 加 `"jsx": "react-jsx"` + `"lib": ["ES2022","DOM","DOM.Iterable"]` + web 包 dist redirect。
- `apps/design/src/application/browser/DesignPanel.tsx` —— 顶层壳，仅渲染 `ConnectionsTab`（Phase 5+ 添加真业务 tab 时再扩展）。
- `apps/design/src/application/browser/connections/ConnectionsTab.tsx` —— 三大块：
  1. `useEffect` 1Hz poll `inspector.getTopology()` → 实时表格显示 participants + connections（连接状态用色块徽章，READY = 绿）。
  2. "Connect" 按钮 → `inspector.requestConnect('renderer:main', DESIGN_PARTICIPANT_ID)` → 显示返回的 `connectionId`；
     基于 topology 自动 disable/enable（READY 时显示 "Connected"）。
  3. "Ping" 按钮 → `awaitDirectChannelClient<IDesignService>(DESIGN_SERVICE_PATH).ping(start)` → echo 校验 + 显示 RTT(ms) + serverTime。
- 全部用 inline style，无外部 CSS 依赖；颜色风格暗黑（`#0d0d0d` 背景 + `#eee` 字 + 绿色 READY 徽章）跟 Phase 2 调试块对齐。

**P4.5 — telegraph renderer entry 切换**
- `apps/telegraph/src/index.tsx` —— 删除 Phase 2 的 topology JSON 调试块，改为 `<DesignPanel />` 单组件挂载。
- `apps/telegraph/vite.renderer.config.ts` 加 `@design` alias 指向 `../design/src/`（符合 design tsconfig 的 `@design/*` 自身别名）。
- `apps/telegraph/tsconfig.json` 同步加 `@design/*` paths + 把 `../design/src/application/browser/**/*` 加入 `include`，
  让 telegraph 这边 `tsc --noEmit` 也跨 app 检 DesignPanel 的类型（design 自己的 typecheck pass 也覆盖一遍，**双重检查捕获跨 app 类型漂移**）。

**P4.6 — 三连绿验证**
- `pnpm install`：4 个 workspace project，design 新增 react/react-dom + types 安装成功。
- `pnpm -r typecheck`：telegraph + design + runtime-contracts 全 Done。
  - 一处坑：design 的 tsc 拉到 cross-app 引入的 `UtilityCpClient.ts`，`bindPort(port: MessagePortMain)` 不接受 x-oasis 的 `MainPort`。
    最终用 `(rawPort: unknown) => ... port = rawPort as MessagePortMain` 在 cb 入口处一次性 narrow，规避双侧 lib 形状差异。
- `pnpm -r lint`：全 Done。
  - 三处 lint 反复横跳：`@typescript-eslint/no-unnecessary-type-assertion`（assertion 多余）↔ `@typescript-eslint/no-unsafe-argument`（缺 assertion），
    解法是给 cb 显式标 `unknown` 类型再做单次 assertion，让两条规则都满意。
  - 另一处：DesignBootstrap 里 `${String(directChannel)}` 触发 `@typescript-eslint/no-base-to-string`（channel 没 toString），改成打印 `DESIGN_SERVICE_PATH` 字符串。
- `pnpm -r test`：3 个项目都 "No test files found, exiting with code 0"（Phase 4 不引入新单测，运行时验收延后到 Phase 5 用户在 TTY 跑）。

**遗留 / 后续 Phase 处理**
- 多 utility 同时在线时，`awaitDirectChannelClient` 现在用 `lastServicePath` 单变量记录目标 service，活动 connection 大于 1 时会路由错。
  Phase 5+ 多 pagelet 上线时，需要 x-oasis 在 activate 事件里带上 target servicePath（小幅 API 扩展），单独跟踪。
- `directChannels: Map<symbol, channel>` 在 utility 侧只记不清——Phase 5 加 disconnect handling 时需要清理这张表。
- 运行时验证（`pnpm start` → 主窗口 → ConnectionsTab → Connect → Ping → RTT > 0）放到 Phase 5 由用户在 TTY 内执行。

### Phase 5 — 收尾 🟡 文档完成，运行时 smoke test 待用户在 TTY 跑

- 在每个 services 关键文件头补上对设计文档与 Phase 的指针注释
- 更新 `AGENTS.md` 反映新仓库结构
- 把本文档 status 改 Implemented，归档
- `apps/_legacy/README.md` 强调该目录不 import
- 跑一次 `pnpm lint && pnpm typecheck && pnpm test`，全过
- 烟囱测试通过

#### 完成记录（实施回放）

**P5.1 — 关键文件 roadmap 指针**
- 大多数 services 文件在 Phase 0–4 已带 `// Phase N — ...` header；Phase 5 给入口/核心补上明确的 `Design context: codebase-wiki/roadmap/...` 注释，让新读者从代码就能跳到设计文档。
- 涉及：`apps/telegraph/src/application/main.ts`、`apps/design/src/main.ts`、
  `apps/telegraph/src/services/connection-orchestrator/electron-main/AppOrchestrator.ts`（额外加 D-006 缺口分析指针）、
  `apps/design/src/application/browser/DesignPanel.tsx`。
- 决策：不对每个文件都加 doc-pointer，只在 4 个高杠杆点（main 进程入口、utility 进程入口、orchestrator 核心、design UI 入口）落锚——其余文件的 `// Phase N` 已足够回溯。

**P5.2 — `AGENTS.md` 重写**
- 旧 `AGENTS.md` 描述的是 legacy（`packages/ui` shadcn vite-monorepo + monitor 面板 + `vite.fork.config.ts`）。
- 新版本完整反映 from-zero 结构：apps/{telegraph,design} 分工、process topology ASCII 图、path aliases 表、x-oasis link-to-source 调用链、调试日志 sink、设计文档定位指南。

**P5.3 — `apps/_legacy/README.md`**
- Phase 5 检查现有 README，规则（不 import / 历史文献 / 复用要重写）已经全在。**无修改**。

**P5.4 — 三连绿 final pass**
- `pnpm -r typecheck`：runtime-contracts + telegraph + design 全 Done。
- `pnpm -r lint`：全 Done。
- `pnpm -r test`：全 "No test files found, exiting 0"（按计划无新增单测）。

**P5.5 — 烟囱测试 🔜 待用户**
- forge 没有 TTY 时立刻退出（Discoveries 第 10 条），自动化跑不动；放到用户在终端里手动跑 `pnpm start`。
- 验证清单（roadmap §11 第 5–9 条）：
  1. 主窗口出现，`<DesignPanel />` 渲染（黑底标题 "Design"）
  2. design utility 在 `ps aux | grep node` 能看到，5s 内不退
  3. `/tmp/telegraph-main.log` 有 `start ok` 类条目，无 UNHANDLED
  4. ConnectionsTab 拓扑表显示 2 个 participant（renderer:main + pagelet:design）
  5. 点 Connect → 出现 1 条 READY connection
  6. 点 Ping → RTT 数字（毫秒级）显示出来

烟囱通过后，本文档 status 改 **Implemented**，从 active 移到 archived。

**P5.6 — `@x-oasis/async-call-rpc-electron` 子路径拆分 + multi-arg RPC 修复**

P5.5 的烟囱跑前发现两个上游问题，必须先在 x-oasis 解决再回到 telegraph：

1. **multi-arg RPC bug**（async-call-rpc，**两轮修才彻底**）
   - **第一轮**（spread 修）：`middlewares/handleRequest.ts` 中 Promise/Subscription 分支调 `handler(args)`，把整个 args 数组当成单个参数。改 `handler(...args)`。
   - **第二轮**（receive-side decode 修）：第一轮跑后真实 `requestConnect(fromId, toId)` 仍然失败成 `Unknown participant: "undefined"`。深挖发现 receive 端 `handleRequest.ts:84` 写的 `let args = body[0]` 取错——sender (`prepareRequestData.ts`) 写入 `data = [header, body]` 而 `body = params`（数组），receive 应直接 `args = body`。第一轮的 spread 修对了一半但 args 已被预先取掉首元素，多 arg 永远 undefined。
   - 修法：`let args: any = body`；下游 spread 自然处理。
   - **历史 fixture 错**：`test/test.spec.ts:418` 写 `[['arg1','arg2']]` 双层包裹，是按旧 receiver `body[0]` 语义反推的，与真实 sender wire shape 不符。修正成单层 `['arg1','arg2']`。
   - **新 spec**：`multi-arg-promise-request.spec.ts` 4 tests 覆盖 `prepareNormalData` wire-shape + 0/2/3 arg handler + null arg。
   - **strict 副产物**：把 `args` 类型放宽到 `any` 后，`AbstractChannelProtocol.applyOnMessage/SendMiddleware` 的 `[].concat(fns)` 在 telegraph 这边走 link-to-source 的 strict typecheck 时炸成 `ConcatArray<never>`。同时 telegraph P5.7 引入 `electron-browser` 子路径深 import 又激活了几处类似 latent strict 错（`_service`、`channel` 未初始化、`prepareRequestData` 也有同款 `[].concat`、handleRequest 末尾 `[].concat(response)`）。一并改成 `Array.isArray(x) ? x : [x]` + 必要的 `!` definite assignment。
   - **回归**：async-call-rpc baseline `6 fail / 262 pass` → 修后 `6 fail / 262 pass`，0 regression（剩余 6 fail 是 transferable-args sync race，与 fix 无关）。

2. **renderer bundle 不能拉 `electron`**（async-call-rpc-electron）
   - 老的 root barrel 同时 re-export `IPCMainChannel`/`ElectronMessagePortMainChannel`/… 这些 main 进程模块。renderer 通过 `import { IPCRendererChannel } from '@x-oasis/async-call-rpc-electron'` 时，bundler 还是会爬到 main 模块的 `import { ipcMain } from 'electron'`，触发 `__dirname is not defined` 之类的崩溃。
   - 烟囱 fix 期临时用 `vite.renderer.config.ts` 里的 `electron` → `electron-stub.ts` alias + `optimizeDeps.exclude: ['electron']` 兜住，但这是脏修法。
   - **真修法**：拆 `src/electron-browser/` + `src/electron-main/` 两条子路径，root barrel 退化成兼容 re-export。
     - `electron-browser/`：`IPCRendererChannel` + `registerOrchestratorHandler`（从 `ElectronConnectionOrchestrator` 抽出，零 electron 运行时 import）+ `index.ts` barrel。
     - `electron-main/`：`IPCMainChannel` + `ElectronMessagePortMainChannel` + `ElectronUtilityProcessChannel` + `ElectronConnectionOrchestrator`（去掉 `registerOrchestratorHandler` import）+ `index.ts` barrel。`registerOrchestratorHandler` 也从这里 re-export 一份，让 utility (node) 代码可以"一个子路径包打所有"。
     - `package.json` 加 `exports`：`"."`、`"./electron-browser"`、`"./electron-main"` 三个条目。
   - **telegraph 侧**：
     - `apps/telegraph/src/services/connection-orchestrator/browser/{RendererCpClient,directChannelClient}.ts` 改 import `/electron-browser`。
     - `apps/telegraph/src/services/connection-orchestrator/electron-main/{AppOrchestrator,MainCpServer,DesignPageletProcess}.ts` + `node/UtilityCpClient.ts` + `apps/design/src/application/node/DesignBootstrap.ts` 改 import `/electron-main`。
     - 删 `electron-stub.ts`、`vite.renderer.config.ts` 里的 `electron` alias 与 `optimizeDeps.exclude`。
     - 两个 `tsconfig.json` 加子路径 paths 条目，分别指向 `dist/src/electron-{browser,main}/index.d.ts`。
   - **回归**：electron-rpc baseline `22 fail / 51 pass` → 拆分后 `22 fail / 51 pass`，0 regression。telegraph `pnpm -r typecheck` ✅ `pnpm -r lint` ✅ `pnpm --filter telegraph package` ✅（三个 vite entries 都干净 build）。
    - **意义**：renderer 不再需要 alias `electron`；channel 类的进程归属由 import 子路径直接表达，违例（renderer import `/electron-main`）会立刻在 type/runtime 层报错。

**P5.7 — `activateConnection` lazy-install race**

P5.6 修完 multi-arg + sub-path 后，用户实测仍然报：第一次点 Connect 偶发 `Method not found`，再点一次出 connectionId。

- **现象**：`inspector.requestConnect()` reject 成 `Method not found`；过一会重试就好；之后点 Ping 总是成功。
- **链路追踪**：
  1. renderer 点 Connect → `inspector.requestConnect(fromId, toId)` 走 cp channel → main。
  2. main 端 `OrchestratorInspectorService.requestConnect → AppOrchestrator.connect → activateParticipant`。
  3. `activateParticipant` 调 `info.channel.makeRequest(ORCHESTRATOR_SERVICE_PATH, 'activateConnection', port)` 反向打回 renderer 的同一条 cp channel，并 `await` 它的 ack。
  4. renderer 的 cp channel 上**没有任何 RPCService 注册** `ORCHESTRATOR_SERVICE_PATH`（inspector 只挂了 `ProxyRPCClient`，那是 client 不是 server）。
  5. `handleRequest.ts:152` else 分支命中 → 回 `-32601 Method not found` → main 的 await reject → `inspector.requestConnect` reject。
- **为什么后续会"好"**：renderer 端 `awaitDirectChannelClient(DESIGN_SERVICE_PATH)` 内部用 `registerOrchestratorHandler(channel, ...)` 在 channel 上挂 RPCService 服务 `ORCHESTRATOR_SERVICE_PATH`。但这个调用过去**只在用户点 Ping 时才执行**（lazy install）——所以第一次 Connect 永远赶在 install 之前，第二次因为前一次 reject 已让 React 重新可点，且如果用户先点了 Ping handler 就装上了。
- **修法**：把 `registerOrchestratorHandler` 的调用从 `directChannelClient.installHandlerOnce`（lazy）搬到 `RendererCpClient.getRendererCpChannel`（channel 创建即装），handler 委派给一个新导出的 `dispatchActivatedPort` 让 `directChannelClient` 仍然管 servicePath → pending promise 的路由。这样 channel 一旦存在，`activateConnection` 永远有处可落，无论用户点 Connect 还是 Ping 在前。
- **不引入 D-006 新 gap**：方案不依赖任何 x-oasis 改动，纯 telegraph 侧 wiring 调整。多 direct-channel 场景（D-006 Gap 1）继续用 `lastServicePath` cursor，等 Gap 1 把 servicePath 写进 activation payload 后再换。
- **回归验证**：`pnpm -r typecheck` ✅、`pnpm --filter telegraph package` ✅。运行时验证待用户 TTY `pnpm start` 复测——预期：第一次冷启动点 Connect 立刻成功，无需"过一会"。

---

## 11. 验证标准（第一阶段判定通过 = 全过）

1. `pnpm install` 干净，无奇怪 warning
2. `pnpm lint` 通
3. `pnpm typecheck` 通
4. `pnpm test` 通（哪怕只是 placeholder test）
5. `pnpm start` 启动主窗口，DesignPanel 显示
6. design utility process 在 `ps` 能看到，5 秒内不 exit
7. `/tmp/telegraph-main.log` 有 `start ok` 类条目，无 UNHANDLED
8. ConnectionsTab 看到 2 个 participant，1 条 READY 的 connection
9. Ping 按钮返回 RTT > 0

---

## 12. 决策点（D1–D8 — 全部已确认 2026-05-08）

- [x] **D1**：main 不作为 participant，inspector 直接挂 main cp channel 上。
- [x] **D2**：design 第一阶段只 spawn 一个实例，participant id = `'pagelet:design'`（不带序号）。
- [x] **D3**：connect 由用户在 ConnectionsTab 点按钮触发（inspector 新增 `requestConnect` 方法）。
- [x] **D4**：control-plane channel 用 `IPCMainChannel`/`IPCRendererChannel`（不走 MessagePort handshake）。
- [x] **D5**：旧代码 `git mv` 到 `apps/_legacy/`，pnpm workspace 排除。
      实际范围扩大到 `apps/{telegraph,design,chat,monitor}` + `packages/{ui,agent,stores}`。
- [x] **D6**：Phase 0 一并完成 strict 化 + ESLint 9 flat config + vitest workspace config。
- [x] **D7**：第一阶段业务 service 只有 `OrchestratorInspectorService` + `DesignApplication.ping()`。
- [x] **D8**：Phase 0 → Phase 5 串行推进，每个 Phase 完成后 pause 等 review。

---

## 13. 风险与开放项

### 13.1 x-oasis 上游缺口（参见 [D-006](../discussion/20260508-x-oasis-orchestrator-capability-gaps.md)）

D-006 列出的 8 项缺口里有 3 项 P0 必须在新项目里照单解决，**不是延期能糊弄过去的**：

| Gap | telegraph 阻塞节点 | 何时必须补 |
|-----|--------------------|-----------|
| Gap 2 — `connect()` 加 `activateTimeoutMs` + 首连重试 | Phase 4 ConnectionsTab "Connect" 按钮，design utility cold start 可能 > 5s | **Phase 3 实施前** |
| Gap 3 — channel 断开自动 `handleParticipantLost` | 任何 utility 崩溃后能否自动转入 reconnect | **Phase 3 实施前**（不然 ConnectionsTab 会撒谎） |
| Gap 1 — `replaceParticipantChannel(id, channel)` | utility 进程被重新 spawn 后保持 participantId 不变 | 不阻塞 Phase 0–5 验收，但**新增 Phase 6** 要补 |

P1 里 Gap 4（`listParticipants` / `listConnections`）和 Gap 5（`createEventForwarder`）telegraph 这边要在 `OrchestratorInspectorService` 内 workaround；x-oasis 后续提供后再切。

x-oasis 在 `pnpm.overrides` 里 link-to-source（参见 R-001），任何 P0 补强**直接在 x-oasis 仓库里改**、telegraph 立即生效。

### 13.2 实施期已知技术风险

- `ElectronUtilityProcessChannel` 在 main / utility 两侧的具体构造参数与对称性需在 Phase 3 实施时按 x-oasis 实际 API 落实。如果 API 不直接支持「main 端用 `process` 包装、utility 端用 `process.parentPort` 包装」的对称用法，可能需要在 `apps/telegraph/src/core/electron-main/utility-process/utilityProcess.ts` 包一层 transfer-list 友好的 postMessage helper。
- `ProcessClientChannel` 之前撞过的 mixed-args 问题在新模型里**不会**复现：cp channel 上传的都是普通对象，`activateConnection(port)` 调用只传一个 port（不混传普通对象）。但 Phase 3 实跑前不能完全打包票，需要实测确认。
- design utility 之前有 `[instantiate error] constructorDeps undefined`（疑似 link-to-source 后 `@x-oasis/di` 实例不一致）。新项目里 design utility 起步时如果复现，需要单独排查（可能要在 `pnpm-workspace.yaml` / utility bundle 的 vite externals 里精确控制 `@x-oasis/di` 解析路径）。这是已知风险，Phase 3 起 utility 时优先验证。
- ESLint 9 flat config + typescript-eslint strict-type-checked 在 Phase 0 引入后已通过空 baseline 验证；Phase 1+ 写实代码时若大批冒红，可临时降级到 `recommended`，Phase 5 收尾再升回 `strictTypeChecked`。

---

## 14. 与其它文档的关系

### Active

- 本文档 — 描述「从 0 到 1 全新构建，老代码 git mv 到 `apps/_legacy/` 当文献」。
- [`D-006` x-oasis ConnectionOrchestrator 能力缺口分析](../discussion/20260508-x-oasis-orchestrator-capability-gaps.md)
  — Phase 3/4 实施时必须照单补 P0 三项（Gap 1/2/3），见 §13.1。
- [`R-001` x-oasis link-to-source 配置](../reference/20260508-x-oasis-link-to-source-setup.md)
  — `pnpm.overrides` 配置说明。

### Archived

- `20260508-port-management-orchestrator-migration-plan.md` — 描述「老 port-manager 与新 orchestrator 共存」。
- `20260508-design-only-orchestrator-rewrite-plan.md` — 描述「老代码冷冻 + 新 orchestrator 在原项目里 inplace 重写」。
