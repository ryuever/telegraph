---
id: A-001
title: Telegraph DI 容器与多平台代码维护范式
description: >
  剖析 apps/telegraph 基于 @x-oasis/di 的依赖注入容器、跨平台目录分层
  （common/node/electron-main/browser）、以及通过 RPC 代理实现"同接口、跨进程"
  服务消费的开发范式，沉淀未来扩展服务和插入新平台时应遵循的开发规范。
category: architecture
created: 2026-05-04
updated: 2026-05-04
tags: [di, dependency-injection, multi-platform, rpc, conventions]
status: final
references:
  - id: A-002
    rel: related-to
    file: ./20260504-multi-process-topology.md
  - id: A-003
    rel: related-to
    file: ./20260504-stability-and-performance-monitoring.md
---

# Telegraph DI 容器与多平台代码维护范式

> 本文回答两个问题：(1) `apps/telegraph` 用什么 DI 容器、按什么模式注册和消费服务；(2) 同一份代码如何同时服务于 Electron 主进程、Node 子进程、Renderer Browser 三种宿主，并以"接口契约 + RPC 代理"的方式让上层代码无需感知服务实际运行在哪里。文末汇总未来新增服务时应遵循的硬性约定。

---

## 1. DI 框架：`@x-oasis/di`

`apps/telegraph/package.json:54` 声明依赖 `"@x-oasis/di": "^0.4.0"`。该库不是 InversifyJS / tsyringe / NestJS，但 API 与 InversifyJS 高度同构，公共出口仅四类：

```ts
// node_modules/@x-oasis/di/dist/index.d.ts
export { default as Container } from './Container'
export { default as Registry }  from './Registry'
export { inject } from './decorator/inject'
export { injectable } from './decorator/injectable'
export { createId } from './common'
```

绑定能力（`BindingType`）覆盖 5 种形态：`Constructor`、`ConstantValue`、`Factory`、`ParamsFactory`、`DynamicValue`。Telegraph 仅使用其中四种：

| API | 用途 | 在本项目的代表场景 |
|---|---|---|
| `bind(ID).to(Class)` | 用 `@injectable()` 类直接绑定，惰性单例 | 大多数业务 Service：`Workbench`、`WindowManager`、`Account` |
| `bind(ID).toConstantValue(instance)` | 绑定常量实例 | `FileAccess`、`MainProcessUtils`、`EmptyProjects` |
| `bind(ID).toParamsFactory(Class)` | 暴露一个调用即实例化的工厂；前置位置参数 + 后置 `@inject(...)` | `BrowserWindowFactoryId`、`PageletProcessFactoryId`、`PanelFactoryId` |
| `bind(ID).toDynamicValue(({ container }) => …)` | 动态解析（典型用于先取依赖再构造） | 跨进程 RPC 客户端代理、按 `bizName` 构造的 `LogService` |

> **本项目不使用 `toFactory`**。所有"运行期带参实例化"统一走 `toParamsFactory`，这是约定。

---

## 2. 标识符（DI Token）规范

每一个绑定都使用 `createId('xxx')` 创建的字符串令牌（也可以是普通字符串或 Symbol，但 Telegraph 全量使用 `createId`）。Token 的命名与摆放位置遵循三条规则：

1. **令牌与实现类同文件导出**——不集中放在 constants 文件。如：
   ```ts
   // src/application/telegraph-application.ts:66
   export const TelegraphApplicationId = createId('telegraph-application')
   @injectable()
   class TelegraphApplication extends Disposable { … }
   ```
2. **客户端代理令牌带 `Client` 后缀，且放在 `common/config.ts`**——这是跨进程消费的入口。如 `WorkbenchClient`、`StorageClient`、`MonitorBridgeClient`、`MainProcessUtilsClient`。
3. **工厂令牌带 `Factory` 后缀**——所有 `.toParamsFactory(...)` 绑定都对应一个 `XxxFactoryId`。如 `BrowserWindowFactoryId`、`PageletProcessFactoryId`、`UtilityProcessFactoryId`、`ProcessPingMainFactoryId`、`AcquireProcessPortMainFactoryId`、`PanelFactoryId`、`PageletFactoryId`、`DisposablePanelFactoryId`、`DisposablePageletFactoryId`。

---

## 3. 模块组合：每个进程一个 `Registry`

`Container` 装配方式统一：构造一个 `Container`，通过 `container.load(registry)` 一次性加载该进程的根 `Registry`，整个进程不再嵌套 sub-registry。

### 3.1 主进程 Registry — `src/application/telegraph-application-module.ts:91-147`

```ts
export default new Registry(bind => {
  bind(ApplicationInfoId).to(ApplicationInfo)
  bind(TelegraphApplicationId).to(TelegraphApplication)

  // toDynamicValue：依赖另一个已注册服务来构造
  bind(LogServiceId).toDynamicValue(({ container }) => {
    const { rootTraceId, appVersion, appName } =
      container.get(ApplicationInfoId).getAppInfo()
    return new LogService({
      logger: new CommonNodeLogger({ bizName: 'main', rootTraceId, appVersion, appName }),
    })
  })

  // toConstantValue：纯值/纯工具类
  bind(FileAccessId).toConstantValue(new FileAccess({ alias: { … } }))
  bind(MainProcessUtilsId).toConstantValue(new MainProcessUtils())

  // to(Class)：标准 @injectable 服务
  bind(WorkbenchId).to(Workbench)
  bind(WindowManagerId).to(WindowManager)
  bind(SharedProcessMainId).to(SharedProcessMain)
  bind(DaemonProcessMainId).to(DaemonProcessMain)
  bind(MainProcessId).to(MainProcess)

  // toParamsFactory：每次调用都实例化（窗口、Tab、子进程等）
  bind(BrowserWindowFactoryId).toParamsFactory(BrowserWindow)
  bind(UtilityProcessFactoryId).toParamsFactory(UtilityProcess)
  bind(PageletProcessFactoryId).toParamsFactory(PageletProcess)
  bind(PageletFactoryId).toParamsFactory(Pagelet)
  bind(PanelFactoryId).toParamsFactory(Panel)

  // 跨进程客户端代理
  bind(StorageServiceClient).toDynamicValue(({ container }) => {
    const mainProcess = container.get(MainProcessId)
    return new ProxyRPCClient(StorageServicePath, {
      channel: mainProcess.getSharedProcessChannel(),
    }).createProxy()
  })

  bind(MonitorBridgeId).to(MonitorBridge)
})
```

### 3.2 启动入口 — `src/application/main.ts:25-35`

```ts
const container = new Container()
container.load(registry)

app.whenReady().then(() => {
  const application = container.get(TelegraphApplicationId) as TelegraphApplication
  application.start()
})
```

整个主进程仅在此处显式 `container.get(...)` 一次，其后所有依赖通过构造函数注入级联解析。

### 3.3 子进程 Registry

每个 utility-process 都有自己的独立 `Container` + `Registry`，与主进程无共享对象：

| 进程 | Registry 文件 | Bootstrap |
|---|---|---|
| shared-process | `src/services/process/shared-process/node/SharedProcessModule.ts` | `node/shared-process-bootstrap.ts` |
| daemon-process | `src/services/process/daemon-process/node/DaemonProcessModule.ts` | `node/daemon-process-bootstrap.ts` |
| pagelet-process | `src/services/process/pagelet-process/node/PageletProcessModule.ts` | `node/pagelet-process-bootstrap.ts` |

> 进程之间通过 RPC（见 §6）通信，DI 容器互不耦合，便于独立调试和单元测试。

---

## 4. 服务定义范式

### 4.1 标准 `@injectable` 服务

构造函数全部使用 `@inject(Id)` 注入，**禁止直接 `new`**。`Disposable` 是所有服务的统一基类。

```ts
// src/application/telegraph-application.ts:66-98
export const TelegraphApplicationId = createId('telegraph-application')

@injectable()
class TelegraphApplication extends Disposable {
  constructor(
    @inject(FileAccessId)         private fileAccess: FileAccess,
    @inject(LogServiceId)         private logService: LogService,
    @inject(MainProcessId)        private mainProcess: MainProcess,
    @inject(WorkbenchId)          private workbench: Workbench,
    @inject(WindowManagerId)      private windowManager: WindowManager,
    @inject(SharedProcessMainId)  private sharedProcessMain: SharedProcessMain,
    @inject(DaemonProcessMainId)  private daemonProcessMain: DaemonProcessMain,
    @inject(MonitorBridgeId)      private monitorBridge: MonitorBridge,
  ) { super() }
}
```

### 4.2 带运行期参数的服务（`toParamsFactory`）

约定：**位置参数置于 `@inject(...)` 之前**。`Container` 会自动只把位置参数透传给工厂调用方，注入参数则从容器解析。

```ts
// src/services/process/pagelet-process/electron-main/PageletProcess.ts:27-57
export const PageletProcessFactoryId = createId('pagelet-process-factory')
export type IPageletProcessFactory = (
  projectName: string,
  windowManager: WindowManager,
) => PageletProcess

@injectable()
export default class PageletProcess extends Disposable {
  constructor(
    projectName: string,                               // 位置参数
    windowManager: WindowManager,                      // 位置参数
    @inject(FileAccessId)         private fileAccess: FileAccess,
    @inject(DaemonProcessMainId)  private daemonProcessMain: DaemonProcessMain,
    @inject(MainProcessId)        private mainProcess: MainProcess,
    @inject(SharedProcessMainId)  private sharedProcessMain: SharedProcessMain,
    @inject(UtilityProcessFactoryId)
    private utilityProcessFactory: IUtilityProcessFactory,
    @inject(AcquireProcessPortMainFactoryId)
    private acquireProcessPortMainFactory: IAcquireProcessPortMainFactory,
  ) { super() }
}
```

调用方只看到 `IPageletProcessFactory`：

```ts
this.pageletProcess = this.pageletProcessFactory(this.projectName, windowManager)
```

### 4.3 跨进程客户端代理（`toDynamicValue` + `ProxyRPCClient`）

这是**跨平台开发范式的核心**：消费者拿到的对象类型与服务端实现完全相同（共用 `common/` 中的接口），但本地是一个 RPC 代理，调用透明地走 `MessagePortMain` 转发到目标进程。

```ts
// src/services/process/daemon-process/node/DaemonProcessModule.ts:53-75
bind(WorkbenchClient).toDynamicValue(({ container }) => {
  const channelClient = container.get(ProcessClientChannelId)
  return new ProxyRPCClient(workspaceServicePath, {
    channel: channelClient.mainProcessChannelProtocol,
  }).createProxy<IWorkbenchProsify>()
})

bind(MonitorBridgeClient).toDynamicValue(({ container }) => {
  const channelClient = container.get(ProcessClientChannelId)
  return new ProxyRPCClient(monitorServicePath, {
    channel: channelClient.mainProcessChannelProtocol,
  }).createProxy() as unknown as IMonitorBridge
})
```

服务端注册（主进程 `prepareMainProcess()`，`telegraph-application.ts:164-171`）：

```ts
this.mainProcess.registerServiceHandler(monitorServicePath, this.monitorBridge)
this.mainProcess.registerServiceHandler(LogServicePath,     this.logService)
this.mainProcess.registerServiceHandler(workbenchServicePath, this.workbench)
// ...
```

**对调用代码而言，本地实例和远程代理实现的是同一个 `IXxx` 接口，可以无差别地依赖注入和切换部署位置。**

---

## 5. 多平台目录分层

`src/services/<name>/` 严格按宿主拆分四个子目录，决定了文件可以 `import` 什么、不能 `import` 什么：

| 子目录 | 运行环境 | 允许 import |
|---|---|---|
| `common/` | 任意 | 仅纯 TS / 跨平台库；**禁止 `electron`、Node 内置、DOM** |
| `node/` | 子 utility-process（纯 Node） | Node 内置；**禁止 `electron`** |
| `electron-main/` | Electron 主进程 | `electron` 主进程模块、Node 内置 |
| `browser/` | Renderer / WebContents | DOM、`window.telegraph` 桥接 API |

### 5.1 `common/config.ts`：服务契约的唯一来源

每一个跨进程服务都在 `common/config.ts` 导出三件事：服务路径字符串、客户端 Token、接口类型。

```ts
// src/services/storage/common/config.ts
import { createId } from '@x-oasis/di'

export const servicePath  = '/services/storage'
export const Handler      = Symbol(servicePath)
export const StorageClient = createId('storage-client')

export type StorageService = {
  getProfile(): any
  setProfile(value: any): any
}
```

### 5.2 实现摆放矩阵

| Service | common | node | electron-main | browser |
|---|---|---|---|---|
| `log` | ✅ 接口 + 常量 | ✅ `CommonNodeLogger` + Sentry + Tracker | ✅ 透传 `node/` | — |
| `storage` | ✅ 接口 | ✅ `StorageService` 真实实现 | ✅ 空 stub（避免主进程拉入 native） | — |
| `port-manager` | ✅ 类型 + `MessageChannelPair` | ✅ `ProcessClientChannel` | ✅ `AcquirePortMain` / `AcquireProcessPortMain` | ✅ `PageletClientChannel` |
| `monitor` | ✅ 类型 + 常量 | — | ✅ `MonitorBridge` | — |
| `diagnostics` | ✅ 类型 | ✅ `Diagnostics` | — | — |
| `main-process-util` | ✅ 接口 | — | ✅ `MainProcessUtils` | — |
| `window-manager` | ✅ 类型 | — | ✅ `WindowManager` / `BrowserWindow` / `BaseWindow` | — |
| `tabs` | ✅ 类型 | — | ✅ `Pagelet` / `Panel` / `Disposable*` | — |
| `application-info` | ✅ 类型 | ✅ 实现 | — | — |
| `workbench` | ✅ 类型 | — | ✅ `Workbench` | — |

### 5.3 平台切换不靠构建别名，而靠"绑定哪个实现"

Telegraph 没有用 Vite alias 在构建期替换实现。每个进程在自己的 `Registry` 里自行决定：

- **本地实现**：`bind(Id).to(<node 或 electron-main 中的类>)`；
- **远程消费**：`bind(IdClient).toDynamicValue(... new ProxyRPCClient(servicePath, { channel }) …)`。

因此，新增一个跨进程服务需要做的事情非常机械（见 §7 检查清单），不会出现"忘了切实现"的事故。

---

## 6. 通信与生命周期约定

- **RPC 层**：`@x-oasis/async-call-rpc` + `@x-oasis/async-call-rpc-electron`；服务端使用 `RPCServiceHost.registerServiceHandler(path, impl)`，客户端使用 `new ProxyRPCClient(path, { channel }).createProxy<I>()`。
- **接口命名**：客户端代理消费的接口统一以 `I` 前缀；存在异步包装时附加 `Promisify` 后缀（如 `IWorkbenchProsify`、`IAcquireProcessPortMainPromisify`）。
- **循环依赖破除**：当两个服务相互引用时，构造时不传引用，而是在外层调用 `serviceA.initialize(serviceB)` 完成绑定。`telegraph-application.ts:135-138` 的注释明确写道 "initialization to avoid circuit import"：
  ```ts
  this.sharedProcessMain.initialize(this.windowManager, this.daemonProcessMain)
  this.daemonProcessMain.initialize(this.windowManager, this.sharedProcessMain)
  ```
- **生命周期**：所有服务继承 `Disposable`（`@x-oasis/disposable`），通过 `registerDisposable()` / `toDisposable()` 收尾。`TelegraphApplication.dispose()` 不需要手动遍历，依赖解析顺序天然形成树。
- **事件**：`Emitter` / `Event` 来自 `@x-oasis/emitter`。约定：`private fooEvent = this._emitter.register('foo')`，对外暴露 `onFoo = this.fooEvent.subscribe`。

进程拓扑、端口握手与具体 IPC 通道见 [A-002 多进程拓扑](./20260504-multi-process-topology.md)。

---

## 7. 未来开发规范（检查清单）

> 新增一个跨进程服务时，按本清单逐项核对，可以保证与现有约定一致。

### 7.1 新增"纯本地"服务（只在一个进程使用）

1. 在 `src/services/<name>/electron-main/<Service>.ts`（或对应宿主目录）创建类。
2. 顶部导出 `export const <Service>Id = createId('<service>')`，类标注 `@injectable()`。
3. 构造函数仅通过 `@inject(...)` 注入依赖，继承 `Disposable`。
4. 在该进程的 `Registry` 中追加 `bind(<Service>Id).to(<Service>)` 或 `.toParamsFactory(<Service>)`（带运行期参数时）。
5. 在消费方构造函数中 `@inject(<Service>Id)` 即可。

### 7.2 新增"跨进程"服务

1. 在 `src/services/<name>/common/config.ts` 中定义：
   ```ts
   export const servicePath = '/services/<name>'
   export const <Service>Client = createId('<service>-client')
   export interface I<Service> { /* 仅声明纯 TS 类型 */ }
   ```
2. 在**实现侧**进程的目录（`node/` 或 `electron-main/`）写真正实现，导出 `<Service>Id`。
3. 在**实现侧**的 `Registry` 中 `bind(<Service>Id).to(<Service>)`，并在该进程的 RPC 服务宿主上 `serviceHost.registerServiceHandler(servicePath, instance)`。
4. 在**消费侧**的 `Registry` 中：
   ```ts
   bind(<Service>Client).toDynamicValue(({ container }) => {
     const channelClient = container.get(<相应进程通道 Id>)
     return new ProxyRPCClient(servicePath, {
       channel: channelClient.<对端 channelProtocol>,
     }).createProxy<I<Service>>()
   })
   ```
5. 消费方 `@inject(<Service>Client)` 拿到的对象与本地实现等价（接口同构）。

### 7.3 新增"带运行期参数"的对象（窗口、子进程、Tab 等）

1. 类用 `@injectable()` 装饰，构造函数**位置参数在前**、`@inject(...)` 在后。
2. 导出工厂类型与工厂 ID：
   ```ts
   export const <Class>FactoryId = createId('<class>-factory')
   export type I<Class>Factory = (a: A, b: B) => <Class>
   ```
3. `Registry` 中 `bind(<Class>FactoryId).toParamsFactory(<Class>)`。
4. 消费方 `@inject(<Class>FactoryId) private factory: I<Class>Factory`，按需 `factory(a, b)` 实例化。

### 7.4 服务路径与命名

- `servicePath` 形如 `/services/<name>`，全部小写连字符；不可重复。
- Token 字符串形如 `<name>` 或 `<name>-client`、`<name>-factory`，便于异常时定位。
- 实现文件名与类名一一对应；bootstrap 文件 `*-bootstrap.ts` 仅用于 `node/` 子进程入口。
- 跨平台共享类型放在 `common/types/`，其他跨平台常量（事件名、stage 名）放在 `common/constants/`。

### 7.5 禁止的做法

- ❌ 在 `common/` 中 `import` `electron`、Node 内置或 DOM 全局。
- ❌ 用 `.toFactory(...)` 替代 `.toParamsFactory(...)`。
- ❌ 跨进程服务直接依赖远端实现的具体类（应当依赖 `I<Service>` 接口）。
- ❌ 在子进程模块中复用主进程的 `Container` 实例（每个进程必须自起 `Container`）。
- ❌ 在构造函数里启动副作用（IO、定时器、IPC 监听）；放到显式的 `start()` / `initialize()` 中。
- ❌ 用 `console.log` 替代 `LogService`（破坏跨进程 trace 和 Sentry 上报）。

---

## 8. 小结

Telegraph 的依赖注入范式可以浓缩为三句话：

1. **每进程一个 `Container` + 一个 `Registry`**：所有服务在 Registry 里集中绑定，启动时只 `container.get(<Root>Id)` 一次。
2. **服务契约只在 `common/`**：服务路径、Token、接口、事件名都来自 `common/config.ts`，确保跨平台单一来源。
3. **本地实现与远程代理同接口**：通过 `bind(...Client).toDynamicValue(... new ProxyRPCClient(...))` 达成"同一份 `@inject` 既可拿到本地服务也可拿到跨进程代理"的效果，是多进程协作的核心机制。

后续扩展任何新平台（例如 Web 容器、CLI 模式）时，只要为该平台再开一个 `<host>/` 子目录、再写一份 `Registry`，即可重用全部 `common/` 契约和已有服务实现，几乎不需要修改业务层代码。
