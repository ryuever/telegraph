---
id: A-010
title: VS Code Contribution 模型对 Telegraph 可扩展架构的启示与落地路径
description: >
  以 VS Code extension 的 `contributes` 声明式贡献点机制为参照，分析 apps-v2
  中已出现的隐式 contribution 模式（participant ID / service path / PageConfig / DI Registry），
  提出 Telegraph 的贡献点分层模型与 `TelegraphManifest` 声明式契约设计，
  使新 Pagelet / Extension 的接入从"改 6 处代码"收敛到"写 1 份 manifest"。
category: architecture
created: 2026-05-13
updated: 2026-05-13
tags:
  - contribution-points
  - manifest
  - extensibility
  - pagelet
  - extension-host
  - vscode-pattern
  - service-registration
status: draft
references:
  - id: A-008
    rel: related-to
    file: ./20260509-telegraph-final-process-architecture.md
  - id: A-009
    rel: related-to
    file: ./20260512-runtime-directory-convention-and-file-structure.md
  - id: A-005
    rel: extends
    file: ./20260505-telegraph-agent-runtime-extension-host-theory.md
  - id: A-001
    rel: related-to
    file: ./20260504-di-and-cross-platform-paradigm.md
---

# VS Code Contribution 模型对 Telegraph 可扩展架构的启示与落地路径

> 本文从 VS Code extension 的 `contributes` 声明式贡献点机制出发，
> 对照 apps-v2 中已存在的隐式 registration 模式，提出 Telegraph 的
> 贡献点分层模型与 `TelegraphManifest` 声明式契约设计。

---

## 1 VS Code Contribution 机制核心回顾

### 1.1 声明式贡献点（`contributes`）

VS Code extension 在 `package.json` 中通过 `contributes` 字段**声明式地**注册能力：

```json
{
  "contributes": {
    "commands": [{ "command": "ext.hello", "title": "Hello" }],
    "views": { "explorer": [{ "id": "ext.tree", "name": "My Tree" }] },
    "configuration": { "properties": { "ext.debug": { "type": "boolean" } } }
  }
}
```

核心原则：**声明先于实现**。VS Code 在 extension 代码未加载时就能解析 manifest，
将 commands 注册到 Command Palette、views 注册到 Sidebar——UI shell 先出现，
用户触发时才激活 extension 的 `activate()` 执行命令式绑定。

### 1.2 三阶段生命周期

```
┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐
│ Phase 1: Discovery  │     │ Phase 2: Activation │     │ Phase 3: Runtime    │
│                     │     │                     │     │                     │
│ 解析 package.json   │────▶│ 触发 activationEvent│────▶│ activate() 注册     │
│ 注册 UI shell       │     │ 加载 extension 代码  │     │ runtime 实现        │
│ (无需加载代码)       │     │                     │     │                     │
└─────────────────────┘     └─────────────────────┘     └─────────────────────┘
  声明式贡献点                  懒激活                       命令式绑定
  (contributes)               (onCommand/onView)          (registerCommand)
```

1. **Discovery**：扫描 extension 目录，解析 `contributes`，注册所有 UI 表面
2. **Activation**：用户触发 `onCommand` / `onView` / `onLanguage` 等 event 时加载代码
3. **Runtime**：`activate()` 内用 `vscode.commands.registerCommand()` 等 API 绑定实现

### 1.3 合并模型

多个 extension 的 contributions 被合并到全局注册表：
- Commands 按 ID 全局唯一（约定前缀 `publisher.name`）
- Menus 按 `group` + `when` 子句排序和过滤
- Configuration 按 scope 合并到统一 Settings Schema

### 1.4 跨 Extension 通信

- **声明式**：`contributes` 定义 UI 表面
- **API 式**：`activate()` 的 `return` 值作为 `exports`，其他 extension 通过 `vscode.extensions.getExtension(id).exports` 调用
- 不直接 import 对方代码——能力边界 = 进程边界（extension host 隔离）

---

## 2 apps-v2 已有的隐式 Contribution 模式

apps-v2 虽然没有显式的 `contributes` 声明，但已存在**四套散落的贡献机制**，
每一套都部分地解决了"一个新 app 如何向系统注册自身能力"的问题。

### 2.1 Participant ID 注册

**位置**：各 app 的 `common/index.ts`

```typescript
// apps-v2/connection/src/application/common/index.ts
export const CONNECTION_PARTICIPANT_ID = 'connection';

// apps-v2/daemon/src/application/common/index.ts
export const DAEMON_PARTICIPANT_ID = 'daemon';

// apps-v2/shared/src/application/common/index.ts
export const SHARED_PARTICIPANT_ID = 'shared';
```

**对应 VS Code**：类似 extension ID（`publisher.name`），标识一个进程级参与者。

**问题**：ID 是散落在各 app 中的常量，Main 进程的 `AppApplicationModule.ts` 需要显式 import
每个 app 的 ID 来组装 DI 容器——**新增 app 必须改 Main 代码**。

### 2.2 Service Path 注册

**位置**：各 app 的 `common/index.ts`

```typescript
export const CONNECTION_PAGELET_SERVICE_PATH = 'pagelet-api';
export const DAEMON_SERVICE_PATH = 'daemon-rpc';
export const SHARED_SERVICE_PATH = 'shared-rpc';
```

**对应 VS Code**：类似 `contributes.commands` 的 command ID，标识一个 RPC 服务端点。

**问题**：Service path 与 participant ID 是两套独立的注册系统，
没有统一的 manifest 描述"哪个 participant 暴露了哪些 service paths"。

### 2.3 Service Interface 契约

**位置**：各 app 的 `common/index.ts`

```typescript
export interface IConnectionPageletService {
  info(): Promise<string>;
  callSharedEcho(msg: string): Promise<string>;
  callDaemonEcho(msg: string): Promise<string>;
  callMainPing(msg: string): Promise<string>;
}
```

**对应 VS Code**：类似 `contributes.commands` 的 `title` + `when` 描述——声明了"我能做什么"。

**问题**：Interface 与 Service Path 是分开放置的，消费方（renderer 的 `rpc-clients.ts`）
需要同时知道两者才能创建代理，且没有 schema 校验。

### 2.4 PageConfig UI 注册

**位置**：`main/src/application/common/cp-config.ts`

```typescript
export const CONNECTION_PAGE = {
  id: 'connection',
  label: 'Connection',
  color: '#3b82f6',
  description: 'Connection Management',
} as const;

export const ALL_PAGES: PageConfig[] = [CONNECTION_PAGE, MONITOR_PAGE];
```

**对应 VS Code**：类似 `contributes.views` + `contributes.viewsContainers`——声明 UI 表面。

**问题**：`ALL_PAGES` 是一个手工维护的数组，新增 app 必须手动添加条目。
这与 VS Code 的"extension 自带 contributes"模式相反——VS Code 的注册是去中心的，
Telegraph 是中心的。

### 2.5 DI Registry 组装

**位置**：`main/src/application/electron-main/AppApplicationModule.ts`

```typescript
export default new Registry((bind) => {
  bind(DaemonProcessId).to(DaemonProcess);
  bind(DaemonApplicationId).to(DaemonApplication);
  bind(SharedProcessId).to(SharedProcess);
  bind(SharedApplicationId).to(SharedApplication);
  bind(ConnectionApplicationId).to(ConnectionApplication);
  bind(MonitorApplicationId).to(MonitorApplication);
  bind(SettingApplicationId).to(SettingApplication);
  bind(AppApplicationId).to(AppApplication);
});
```

**对应 VS Code**：类似 VS Code 的 `ExtensionHost` 扫描 extension 目录并加载所有 extensions——
但 VS Code 是自动发现，Telegraph 是手工 import + 手工 bind。

**核心痛点**：**新增一个 Pagelet app 需要改 6 处代码**：

| # | 改动位置 | 改什么 |
|---|----------|--------|
| 1 | `apps/<new-app>/src/application/common/index.ts` | 定义 PARTICIPANT_ID + SERVICE_PATH + Interface |
| 2 | `apps/<new-app>/src/application/node/` | 实现 Worker + Application |
| 3 | `main/src/application/common/cp-config.ts` | 添加 PageConfig 到 `ALL_PAGES` |
| 4 | `main/src/application/electron-main/AppApplicationModule.ts` | import + bind |
| 5 | `main/src/application/electron-main/AppApplication.ts` | `@inject` 新 app，在 `start()` 中调用 |
| 6 | `main/src/application/browser/rpc-clients.ts` | import interface + `client.getProxy()` |

VS Code 新增 extension 只需写 `package.json` + 代码，**不需要改 VS Code 主仓库任何文件**。

---

## 3 Telegraph Contribution 分层模型

### 3.1 与 VS Code 的架构差异

| 维度 | VS Code | Telegraph |
|------|---------|-----------|
| 扩展载体 | 独立 NPM 包 / VSIX | 子应用目录（`apps/<name>/`） |
| 发现机制 | 扫描 `~/.vscode/extensions/` | 编译时已知（monorepo 内） |
| 声明格式 | `package.json#contributes` (JSON Schema) | **待设计**：`manifest.ts` 或 `manifest.json` |
| 激活时机 | 懒激活（onCommand / onView / onLanguage） | Pagelet 已是 lazy spawn（A-008 I2） |
| 进程模型 | 单一 Extension Host 进程 | 每个 Pagelet 独立 UtilityProcess |
| 跨扩展通信 | `exports` API | RPC proxy（ForwardingProxy） |
| UI 注册 | `contributes.views` / `viewsContainers` | Sidebar tab / BrowserView 路由 |

### 3.2 Telegraph 特有的 Contribution 维度

VS Code 的 contributions 主要面向 **UI 表面 + 语言能力**。
Telegraph 的 contributions 还需覆盖**进程拓扑 + RPC 服务**层面：

```
VS Code contribution 维度:       Telegraph contribution 维度:
├── commands                     ├── commands (RPC methods)
├── views / viewsContainers      ├── views (sidebar panels / BrowserView routes)
├── configuration                ├── configuration (SettingsService schema)
├── languages / grammars         ├── runtime (AgentRuntime adapter type)
├── menus / keybindings          ├── menus / keybindings
├── customEditors                ├── customEditors (CanvasService, etc.)
├── authentication               ├── authentication (LoginService provider)
│                                ├── participant (进程角色 + 生命周期)
│                                ├── services (RPC service path + interface)
│                                ├── forwarding (ForwardingProxy 规则)
│                                └── extensions (ToolDefinition / HookDefinition)
```

新增的四个维度（participant / services / forwarding / extensions）是 Telegraph
多进程架构特有的，VS Code 不需要因为它是单 extension host。

### 3.3 三层贡献模型

```
┌───────────────────────────────────────────────────────────────┐
│ Layer 1: Static Manifest (声明式，编译时可解析)                   │
│                                                               │
│ TelegraphManifest {                                           │
│   id: 'pagelet:chat:1'                                       │
│   participant: { role, lifecycle }                            │
│   services: [{ path, interface, direction }]                  │
│   views: [{ panelId, container, route }]                      │
│   configuration: { schema }                                   │
│   commands: [{ id, title, when }]                             │
│   forwarding: [{ from, to, servicePath, lazy }]               │
│   extensions: [{ toolId, hookEvent, permissions }]            │
│ }                                                             │
└───────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────┐
│ Layer 2: DI Registration (命令式，运行时组装)                    │
│                                                               │
│ AppApplicationModule.ts (或自动生成的 Registry)                 │
│   bind(WorkerId).to(Worker)                                   │
│   bind(ApplicationId).to(Application)                         │
│   bind(ParticipantId).to(ProcessSpawner)                      │
└───────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌───────────────────────────────────────────────────────────────┐
│ Layer 3: Runtime Binding (命令式，进程启动后注册)                │
│                                                               │
│ PageletWorker.onRendererConnection()                          │
│   serviceHost.registerService(path, handlers)                 │
│   exposeRemoteService({ servicePath, remoteClient })          │
│   ExtensionHost.registerTool(toolDef)                         │
└───────────────────────────────────────────────────────────────┘
```

**Layer 1** 对应 VS Code 的 `contributes`——纯数据，编译时可校验、可合并、可生成代码。
**Layer 2** 对应当前 `AppApplicationModule.ts`——DI 容器绑定。
**Layer 3** 对应当前 Worker 的 `onRendererConnection()`——运行时 handler 注册。

---

## 4 `TelegraphManifest` 设计草案

### 4.1 Manifest 结构

```typescript
interface TelegraphManifest {
  id: string;
  version: string;
  display: {
    label: string;
    icon?: string;
    color: string;
    description: string;
  };
  participant: {
    role: 'pagelet' | 'shared' | 'daemon';
    lifecycle: 'lazy' | 'eager';
    singleton: boolean;
  };
  services: ServiceContribution[];
  views: ViewContribution[];
  commands: CommandContribution[];
  configuration?: ConfigurationContribution;
  forwarding: ForwardingContribution[];
  extensions?: ExtensionContribution[];
}

interface ServiceContribution {
  path: string;
  interfaceToken: string;
  direction: 'provide' | 'consume' | 'both';
  methods: string[];
}

interface ViewContribution {
  panelId: string;
  container: 'sidebar' | 'main' | 'standalone';
  route: string;
  component: string;
  order: number;
}

interface CommandContribution {
  id: string;
  title: string;
  when?: string;
  keybinding?: string;
}

interface ConfigurationContribution {
  title: string;
  properties: Record<string, {
    type: string;
    default?: unknown;
    description: string;
    scope: 'application' | 'window' | 'resource';
  }>;
}

interface ForwardingContribution {
  servicePath: string;
  targetParticipant: string;
  lazy: boolean;
}

interface ExtensionContribution {
  toolId: string;
  hookEvents: string[];
  permissions: string[];
}
```

### 4.2 Connection Pagelet 的 Manifest 示例

当前 apps-v2 中 `connection` app 的隐式信息，用 Manifest 显式表达：

```typescript
const connectionManifest: TelegraphManifest = {
  id: 'connection',
  version: '0.1.0',
  display: {
    label: 'Connection',
    color: '#3b82f6',
    description: 'Connection Management',
  },
  participant: {
    role: 'pagelet',
    lifecycle: 'lazy',
    singleton: false,
  },
  services: [
    {
      path: 'pagelet-api',
      interfaceToken: 'IConnectionPageletService',
      direction: 'provide',
      methods: ['info', 'callSharedEcho', 'callSharedGetConfig', 'callSharedSetConfig', 'callDaemonEcho', 'callDaemonSystemStatus', 'callMainPing'],
    },
  ],
  views: [
    {
      panelId: 'connection',
      container: 'sidebar',
      route: '/connection',
      component: 'ConnectionPageView',
      order: 1,
    },
  ],
  commands: [],
  forwarding: [
    { servicePath: 'shared-rpc', targetParticipant: 'shared', lazy: false },
    { servicePath: 'daemon-rpc', targetParticipant: 'daemon', lazy: true },
    { servicePath: 'main-rpc-service', targetParticipant: 'main', lazy: false },
  ],
};
```

**对照现有散落信息**：

| Manifest 字段 | 现有位置 |
|---------------|----------|
| `id` | `common/index.ts` → `CONNECTION_PARTICIPANT_ID` |
| `display` | `main/common/cp-config.ts` → `CONNECTION_PAGE` |
| `participant` | `electron-main/AppApplication.ts` → `PageletProcess.spawn()` 参数 |
| `services[0].path` | `common/index.ts` → `CONNECTION_PAGELET_SERVICE_PATH` |
| `services[0].methods` | `common/index.ts` → `IConnectionPageletService` 方法名 |
| `views[0]` | `main/common/cp-config.ts` → `CONNECTION_PAGE` + `ALL_PAGES` |
| `forwarding` | `node/ConnectionWorker.ts` → `this.sharedClient` / `this.daemonClient` / `this.mainClient` 使用 |

### 4.3 文件放置

```
apps/<name>/src/
├── manifest.ts              # ← 新增：TelegraphManifest 声明
├── application/
│   ├── common/
│   │   └── index.ts         # 保留：interface + ID（可从 manifest 生成）
│   ├── node/                # Layer 3 实现
│   └── browser/             # View 组件
```

`manifest.ts` 与 `common/index.ts` 的关系：
- **短期**：`manifest.ts` 是新增文件，`common/index.ts` 保持不变，manifest 中的 `interfaceToken` 引用 `common/index.ts` 导出的 interface
- **长期**：从 manifest 生成 `common/index.ts` 的 ID + SERVICE_PATH 常量，interface 手写（因为 TypeScript 类型无法运行时描述）

---

## 5 Manifest 驱动的自动注册流程

### 5.1 编译时：Manifest 扫描 → DI Registry 生成

```
apps/*/src/manifest.ts
        │
        ▼
  [scan-manifests.ts]          ← 构建脚本
        │
        ├─→ main/common/cp-config.ts   (ALL_PAGES 自动生成)
        ├─→ main/electron-main/AppApplicationModule.ts  (DI bind 自动生成)
        └─→ main/browser/rpc-clients.ts  (client.getProxy 自动生成)
```

核心思路：**一份 manifest 驱动三处代码生成**，消除手工维护的 6 处改动。

```typescript
// scripts/scan-manifests.ts（概念草图）
import { globSync } from 'glob';
import { TelegraphManifest } from '@telegraph/contracts';

const manifests: TelegraphManifest[] = globSync('apps/*/src/manifest.ts')
  .map(p => require(p).default);

// 生成 cp-config.ts
const allPages = manifests
  .filter(m => m.views.length > 0)
  .map(m => ({
    id: m.id,
    label: m.display.label,
    color: m.display.color,
    description: m.display.description,
  }));

// 生成 AppApplicationModule.ts 的 bind 列表
const bindings = manifests.map(m => {
  const workerId = `${capitalize(m.id)}WorkerId`;
  const appId = `${capitalize(m.id)}ApplicationId`;
  return `bind(${workerId}).to(${capitalize(m.id)}Worker);\nbind(${appId}).to(${capitalize(m.id)}Application);`;
});

// 生成 rpc-clients.ts 的 proxy 列表
const proxies = manifests
  .filter(m => m.services.some(s => s.direction === 'provide'))
  .flatMap(m => m.services
    .filter(s => s.direction === 'provide')
    .map(s => `export const ${m.id}Client = client.getProxy('${s.path}') as I${capitalize(m.id)}Service;`)
  );
```

### 5.2 运行时：Manifest → PageletWorker 自动配置

`PageletWorker` 基类可从 manifest 读取 forwarding 规则，自动调用 `exposeRemoteService`：

```typescript
abstract class PageletWorker {
  protected manifest: TelegraphManifest;

  protected onRendererConnection(channel: RPCMessageChannel): void {
    for (const fwd of this.manifest.forwarding) {
      exposeRemoteService({
        channel,
        servicePath: fwd.servicePath,
        remoteClient: fwd.lazy
          ? () => this.orchestrator.connect(this.id, fwd.targetParticipant)
          : this.getClient(fwd.targetParticipant),
      });
    }
  }
}
```

子类只需覆盖 `registerDomainServices(channel)` 注册自有服务：

```typescript
class ConnectionWorker extends PageletWorker {
  protected override registerDomainServices(channel: RPCMessageChannel): void {
    serviceHost.registerService(CONNECTION_PAGELET_SERVICE_PATH, {
      channel,
      serviceHost,
      handlers: {
        info: () => `${this.config.selfId} ready`,
        callSharedEcho: (msg) => (this.sharedClient as ISharedService).echo(msg),
      },
    });
  }
}
```

---

## 6 与 A-005 Extension Host 的衔接

A-005 定义了 AgentRuntime / ToolDefinition / ExtensionManifest 等概念。
TelegraphManifest 的 `extensions` 字段是 A-005 ExtensionManifest 在 Pagelet 层的投影：

```
┌──────────────────────────────────────────────────────────┐
│ TelegraphManifest (Pagelet 级)                             │
│                                                           │
│ extensions: [{                                            │
│   toolId: 'web-search',                                  │
│   hookEvents: ['beforeRun', 'afterRun'],                 │
│   permissions: ['network:outbound', 'fs:read']           │
│ }]                                                        │
│                                                           │
│  ── 运行时映射到 ──▶                                       │
│                                                           │
│ Pagelet 内的 ExtensionHost:                               │
│   ToolRegistry.register(toolDef)                          │
│   HookBus.subscribe('beforeRun', hook)                    │
│   PermissionChecker.check(['network:outbound'])           │
└──────────────────────────────────────────────────────────┘
```

**分层原则**：
- **TelegraphManifest.extensions**：声明式，描述"本 Pagelet 需要哪些 extension 能力"
- **ExtensionHost.registerTool()**：命令式，在 Pagelet 启动时绑定 runtime 实现
- 类比 VS Code：`contributes.commands`（声明）→ `vscode.commands.registerCommand()`（绑定）

### 6.1 两级 Manifest 的关系

```
TelegraphManifest (app 级)         A-005 ExtensionManifest (extension 级)
├── id: 'pagelet:chat:1'           ├── id: 'web-search-tool'
├── services: [...]                ├── tools: [...]
├── views: [...]                   ├── hooks: [...]
├── forwarding: [...]              ├── permissions: [...]
└── extensions: [                  └── activationEvents: [...]
     { toolId: 'web-search' }         ↑
   ]                                  │
     │                                │ 运行时解析
     └──────── 引用 ──────────────────┘
```

App 级 manifest 声明**需求**（"我需要 web-search 工具"），
Extension 级 manifest 声明**供给**（"web-search 工具提供这些能力"）。
运行时由 ExtensionHost 做供需匹配。

---

## 7 落地路线（初版，优先级已修订，见 §9）

### Phase 1：Manifest 声明 + 手工消费（最小闭环）

**目标**：将 apps-v2 中散落的 4 套注册信息收敛为 `manifest.ts`，但 DI / RPC 客户端仍手工维护。

| 步骤 | 动作 |
|------|------|
| 1 | 在 `packages/runtime-contracts/` 定义 `TelegraphManifest` 类型 |
| 2 | 每个 app 新增 `manifest.ts`，显式声明 participant / services / views / forwarding |
| 3 | `cp-config.ts` 的 `ALL_PAGES` 改为从 manifest 数组推导 |
| 4 | 验证：manifest 与手工代码的语义等价（typecheck 通过） |

### Phase 2：构建时代码生成

**目标**：从 manifest 自动生成 DI Registry 和 RPC 客户端。

| 步骤 | 动作 |
|------|------|
| 1 | 编写 `scripts/scan-manifests.ts`，扫描所有 `manifest.ts` |
| 2 | 生成 `AppApplicationModule.ts`（DI bind） |
| 3 | 生成 `rpc-clients.ts`（renderer 侧 proxy） |
| 4 | CI 校验：生成结果与实际文件 diff = 0 |

### Phase 3：PageletWorker 自动化

**目标**：`PageletWorker` 基类从 manifest 读取 forwarding 规则，子类只注册 domain services。

| 步骤 | 动作 |
|------|------|
| 1 | `PageletWorker` 增加 `manifest` 参数，自动执行 `exposeRemoteService` |
| 2 | 子类 `onRendererConnection()` 简化为 `registerDomainServices()` |
| 3 | manifest 校验：forwarding 引用的 targetParticipant 必须存在 |

### Phase 4：Extension Manifest 集成

**目标**：A-005 ExtensionManifest 与 TelegraphManifest `extensions` 字段对接。

| 步骤 | 动作 |
|------|------|
| 1 | 定义 `ExtensionManifest` schema（独立于 `TelegraphManifest`） |
| 2 | Pagelet 启动时，ExtensionHost 根据 `manifest.extensions` 加载并绑定 tools |
| 3 | 权限检查：`manifest.extensions[].permissions` → PermissionChecker |

---

## 8 开放问题

1. **Manifest 格式：`.ts` vs `.json`**
   - `.ts` 优势：类型安全，可直接 import interface token
   - `.json` 优势：无需编译即可解析，与 VS Code 的 `package.json#contributes` 一致
   - 倾向：短期 `.ts`（减少工具链成本），长期可引入 JSON Schema + 代码生成

2. **动态 vs 静态发现**
   - 当前是 monorepo 编译时已知所有 apps
   - 未来是否支持"第三方 app 动态安装"（类似 VS Code extension marketplace）？
   - 倾向：短期静态发现足够；架构上预留动态扫描接口

3. **Manifest 版本兼容**
   - 当 `TelegraphManifest` schema 变更时，已发布的 apps 如何兼容？
   - 倾向：`version` 字段 + `semver` 兼容性校验

4. **跨 Pagelet 协作的声明**
   - A-008 §11 开放问题 1：Pagelet 之间 0 直连是否绝对？
   - Manifest 是否需要声明"我需要与 X pagelet 通信"？
   - 倾向：先通过 `forwarding` 走 Shared 中转，后续按需放开 P2P

5. **与 VS Code `when` 子句的等价物**
   - VS Code 用 `when` 表达式控制 contribution 的条件可见性
   - Telegraph 是否需要类似机制？（如"只在 dev 模式显示 Monitor"）
   - 倾向：先硬编码在 manifest 中，后续引入 `when` DSL

---

## 9 投资回报评估：App 级 Manifest vs Extension 级 Manifest

### 9.1 核心判断

本文 §4–§7 描述的 `TelegraphManifest` 及其落地路线，**对核心 Pagelet 的 ROI 偏低**，但对 A-005 Extension Host 场景意义显著。

**原因**：

1. **VS Code 做 `contributes` 的前提是开放生态**——成千上万第三方 extension 动态安装，编译时根本不知道会装什么。Telegraph 的 pagelet 是核心团队在 monorepo 里写的，数量有限且已知（当前 5-6 个），"改 6 处代码"的成本几个月才发生一次。

2. **Manifest 系统自身的维护成本不低**——新抽象层（`TelegraphManifest` 类型 + schema）、代码生成脚本（`scan-manifests.ts`）、schema 版本兼容、CI 校验……这些复杂度要由日常开发持续承担，换来的是极低频的新增 pagelet 体验优化。

3. **当前隐式注册虽然"丑"但实用**——participant ID / service path / PageConfig / DI Registry 四套机制散落但**清晰、可调试、无魔法**。对一个 5-6 个 app 的系统完全够用。

4. **A-005 的 Extension Host 才是真正需要 contribution 的地方**——第三方 tool/hook 动态注册、权限声明、懒激活，这些场景和 VS Code extension 高度同构。但那应该是一个 **extension 级的 manifest**（A-005 `ExtensionManifest`），不是 app 级的 `TelegraphManifest`。

### 9.2 修订后的优先级建议

| 阶段 | 原计划 | 修订建议 |
|------|--------|----------|
| Phase 1：Manifest 声明 | 收敛 4 套注册为 `manifest.ts` | ✅ 保留——作为概念对齐和文档化有价值，但不急迫 |
| Phase 2：构建时代码生成 | 自动生成 DI Registry + RPC 客户端 | ⏸ 暂缓——5-6 个 app 手工维护的成本远低于维护代码生成器 |
| Phase 3：PageletWorker 自动化 | 基类读 manifest 自动 forwarding | ⏸ 暂缓——同理，pagelet 数量有限 |
| Phase 4：Extension Manifest 集成 | 与 A-005 对接 | ✅ **优先**——这才是 contribution 模型真正发挥威力的场景 |

**结论**：本文作为 VS Code contribution 模型的概念映射文档保留价值（理解 VS Code 为什么这么设计、Telegraph 的隐式模式对应 VS Code 的哪个概念），但 **Phase 2-3 的实施建议暂缓**。精力应优先投入 A-005 Extension Manifest 的设计——第三方 extension 的动态注册、权限声明、懒激活才是 contribution 机制的核心战场。

### 9.3 App 级 Manifest 的适用时机

当以下条件**同时满足**时，重新评估 Phase 2-3 的优先级：

- Pagelet 数量 > 10，且新增频率 ≥ 每月 1 个
- 存在非核心团队开发的 Pagelet（如内部其他业务线接入）
- `AppApplicationModule.ts` 的手工 bind 导致过合并冲突

在此之前，保持现状是最务实的选择。

---

## 10 附录：apps-v2 现有 Registration 信息汇总

| App | Participant ID | Service Path(s) | Interface | DI ID | Views |
|-----|---------------|-----------------|-----------|-------|-------|
| connection | `'connection'` | `'pagelet-api'` | `IConnectionPageletService` | `ConnectionApplicationId` | ConnectionPage |
| monitor | `'monitor'` | `'monitor-pagelet-api'` | `IMonitorPageletService` | `MonitorApplicationId` | MonitorPage |
| setting | `'setting'` | `'setting-pagelet-api'` | `ISettingPageletService` | `SettingApplicationId` | SettingApp (standalone window) |
| shared | `'shared'` | `'shared-rpc'` | `ISharedService` | `SharedApplicationId` | — |
| daemon | `'daemon'` | `'daemon-rpc'` | `IDaemonService` | `DaemonApplicationId` | — |
| main | (orchestrator) | `'main-rpc-service'`, `'main-metrics-service'` | `IMainRpcService`, `IMainMetricsService` | `AppApplicationId` | Sidebar + HomePage |
