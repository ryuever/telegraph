---
name: add-pagelet
description: "在 apps/ 下创建新 app 并将其连接到自己的 pagelet（utility process）的完整实践流程。适用于「新建 app / 添加 pagelet / 接入 ConnectionOrchestrator」等意图。"
---

# Add Pagelet — 新建 App 接入 Pagelet 实践手册

本 skill 描述在 `apps/` 下创建新 app 并将其连接为 pagelet（utility process）的完整步骤。
所有 IPC 走 x-oasis ConnectionOrchestrator，**绝不用** `ipcMain/ipcRenderer`。

> **前置阅读**：如果改动涉及拓扑/IPC 决策，先读 `.agents/architecture-guard.md` 的触发条件。

---

## 术语速查

| 术语 | 含义 |
|------|------|
| **pagelet** | 独立 utility process，承载业务逻辑，由 main process spawn |
| **Participant ID** | 进程在 ConnectionOrchestrator 中的唯一标识，如 `'chat'`、`'design'` |
| **Service Path** | pagelet 暴露的 RPC 端点名，如 `'chat-pagelet-api'` |
| **PageletWorker** | 基类，处理 orchestrator 连接、shared/daemon 代理；子类 override `onRendererConnection()` |
| **PageletProcess** | main 侧的 spawn 管理（创建 UtilityProcessSupervisor） |

---

## 完整步骤（11 步）

### Step 1: 添加 Participant ID 常量

**编辑** `packages/services/src/pagelet-host/src/common/index.ts`

```typescript
export const <APPNAME>_PARTICIPANT_ID = '<appname>';
```

> 例：`export const CHAT_PARTICIPANT_ID = 'chat';`

---

### Step 2: 创建 app 目录结构

```
apps/<appname>/
├── src/
│   └── application/
│       ├── node/          # Utility process 侧
│       │   ├── main.ts
│       │   └── <AppName>PageletWorker.ts
│       ├── electron-main/ # Main process 侧 spawner
│       │   └── <AppName>Application.ts
│       ├── browser/       # React UI（可选）
│       └── common/        # 跨层类型 + 常量
│           └── index.ts
├── package.json
└── tsconfig.json
```

---

### Step 3: 定义 Service Path + 接口

**创建** `apps/<appname>/src/application/common/index.ts`

```typescript
export const <APPNAME>_PAGELET_SERVICE_PATH = '<appname>-pagelet-api';

export interface I<AppName>PageletService {
  info(): Promise<string>;
  // 你的 RPC 方法签名
}
```

---

### Step 4: 创建 Node Entry（DI 设置）

**创建** `apps/<appname>/src/application/node/main.ts`

```typescript
import { Container, Registry } from '@x-oasis/di';
import {
  <AppName>PageletWorker,
  <AppName>PageletWorkerId,
} from './<AppName>PageletWorker';
import { PageletWorkerConfigId } from '@/packages/services/pagelet-host/node/PageletWorker';
import {
  <APPNAME>_PARTICIPANT_ID,
  RENDERER_PARTICIPANT_ID,
} from '@/packages/services/pagelet-host/common';

const container = new Container();
container.load(
  new Registry((bind) => {
    bind(PageletWorkerConfigId).toConstantValue({
      selfId: <APPNAME>_PARTICIPANT_ID,
      rendererParticipantId: RENDERER_PARTICIPANT_ID,
    });
    bind(<AppName>PageletWorkerId).to(<AppName>PageletWorker);
  })
);

const worker = container.get(<AppName>PageletWorkerId) as <AppName>PageletWorker;
worker
  .boot()
  .catch((err) => console.error('[<appname>-worker] boot failed:', err));
```

---

### Step 5: 创建 PageletWorker 子类

**创建** `apps/<appname>/src/application/node/<AppName>PageletWorker.ts`

#### 最小版（参照 design）

```typescript
import { createId, inject, injectable } from '@x-oasis/di';
import { serviceHost } from '@x-oasis/async-call-rpc';
import { PageletWorker, PageletWorkerConfigId } from '@/packages/services/pagelet-host/node/PageletWorker';
import type { IPageletWorkerConfig } from '@/packages/services/pagelet-host/node/PageletWorker';
import { <APPNAME>_PAGELET_SERVICE_PATH } from '@/apps/<appname>/application/common';

export const <AppName>PageletWorkerId = createId('<AppName>PageletWorker');

@injectable()
export class <AppName>PageletWorker extends PageletWorker {
  constructor(@inject(PageletWorkerConfigId) config: IPageletWorkerConfig) {
    super(config);
  }

  protected override onRendererConnection(channel: any): void {
    serviceHost.registerService(<APPNAME>_PAGELET_SERVICE_PATH, {
      channel,
      serviceHost,
      handlers: {
        info: (): string => `<appname>-pagelet ready (pid=${process.pid})`,
      },
    });
  }
}
```

#### 带 Shared/Daemon 类型版（参照 connection）

```typescript
import type { ISharedService } from '@/apps/shared/application/common';
import type { IDaemonService } from '@/apps/daemon/application/common';

@injectable()
export class <AppName>PageletWorker extends PageletWorker<ISharedService, IDaemonService> {
  // this.shared.echo(msg)  — forwarding proxy, 无 null check
  // this.daemon.echo(msg)  — 同理
  // this.main.mainPing(msg)
}
```

#### 关键扩展点

| 方法 | 何时调用 | 用途 |
|------|----------|------|
| `onRendererConnection(channel)` | renderer 连接时 | 注册 RPC service |
| `onSharedClientReady(channel)` | shared 连接就绪 | 订阅 push RPC、重连重订阅 |
| `onDaemonClientReady(channel)` | daemon 连接就绪 | 同上 |

---

### Step 6: 创建 Electron-Main Application

**创建** `apps/<appname>/src/application/electron-main/<AppName>Application.ts`

```typescript
import { createId, inject, injectable } from '@x-oasis/di';
import type { IPageletProcess } from '@/packages/services/pagelet-host/electron-main/PageletProcess';
import { PageletProcessId } from '@/packages/services/pagelet-host/electron-main/PageletProcess';
import { <APPNAME>_PARTICIPANT_ID } from '@/packages/services/pagelet-host/common';

export const <APPNAME>_WORKER_FILE = '<appname>-worker.js';

export interface I<AppName>Application {
  start(): Promise<void>;
}

export const <AppName>ApplicationId = createId('<AppName>Application');

@injectable()
export class <AppName>Application implements I<AppName>Application {
  constructor(
    @inject(PageletProcessId) private readonly pageletProcess: IPageletProcess,
  ) {}

  async start(): Promise<void> {
    await this.pageletProcess.spawn(
      <APPNAME>_PARTICIPANT_ID,
      <APPNAME>_WORKER_FILE
    );
  }
}
```

> 如果需要 eager 连接（debug/演示），可额外注入 `AppOrchestratorId` 并调用 `appOrchestrator.connect<AppName>()`，参照 `DesignApplication`。

---

### Step 7: 创建 Vite 构建配置

**创建** `apps/telegraph/vite.<appname>.config.ts`

```typescript
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const nodeBuiltins = [
  'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns',
  'domain', 'events', 'fs', 'http', 'https', 'net', 'os', 'path', 'process',
  'querystring', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls',
  'tty', 'url', 'util', 'v8', 'vm', 'zlib',
];

export default defineConfig({
  resolve: {
    mainFields: ['module', 'jsnext:main', 'jsnext'],
    alias: {
      '@/apps/<appname>': resolve(__dirname, '../<appname>/src'),
      '@/packages/services/pagelet-host': resolve(__dirname, '../../packages/services/src/pagelet-host/src'),
      '@/apps/daemon': resolve(__dirname, '../daemon/src'),
      '@/apps/shared': resolve(__dirname, '../shared/src'),
      '@/apps/telegraph': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: '.vite/preload',
    lib: {
      entry: resolve(__dirname, '../<appname>/src/application/node/main.ts'),
      formats: ['cjs'],
    },
    rollupOptions: {
      external: [...nodeBuiltins, ...nodeBuiltins.map(m => `node:${m}`), 'electron'],
      output: {
        entryFileNames: '<appname>-worker.js',
      },
    },
  },
});
```

**关键约束**：
- `entryFileNames` **必须**与 Step 6 的 `_WORKER_FILE` 一致
- 格式必须为 `cjs`（Electron utility process 要求）
- alias 要覆盖 worker 代码中所有 `@/` 跨模块 import

---

### Step 8: 更新 Forge Config

**编辑** `apps/telegraph/forge.config.ts`，在 `build` 数组末尾添加：

```typescript
{
  entry: '../<appname>/src/application/node/main.ts',
  config: 'vite.<appname>.config.ts',
},
```

---

### Step 9: 更新 TsConfig

**编辑** `apps/telegraph/tsconfig.json`，在 `paths` 中添加：

```json
"@/apps/<appname>/*": ["../<appname>/src/*"]
```

**创建** `apps/<appname>/tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "jsx": "react-jsx",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "baseUrl": ".",
    "paths": {
      "@/apps/<appname>/*": ["src/*"],
      "@/packages/services/pagelet-host/*": ["../../packages/services/src/pagelet-host/src/*"],
      "@/packages/services/main-metrics/*": ["../../packages/services/src/main-metrics/src/*"],
      "@/apps/daemon/*": ["../daemon/src/*"],
      "@/apps/shared/*": ["../shared/src/*"],
      "@/apps/telegraph/*": ["../telegraph/src/*"],
      "@/packages/ui/*": ["../../packages/ui/src/*"]
    }
  },
  "include": ["src/**/*"]
}
```

> 根据实际依赖增减 paths（不需要的就不加）。

---

### Step 10: 注册到 Main DI

**编辑** `apps/telegraph/src/application/electron-main/AppApplicationModule.ts`

添加 import 和 binding：

```typescript
import {
  <AppName>Application,
  <AppName>ApplicationId,
} from '@/apps/<appname>/application/electron-main/<AppName>Application';

// 在 Registry 内添加：
bind(<AppName>ApplicationId).to(<AppName>Application);
```

---

### Step 11: 加入启动序列

**编辑** `apps/telegraph/src/application/electron-main/AppApplication.ts`

添加 import 和注入：

```typescript
import type { I<AppName>Application } from '@/apps/<appname>/application/electron-main/<AppName>Application';
import { <AppName>ApplicationId } from '@/apps/<appname>/application/electron-main/<AppName>Application';

// constructor 中添加注入：
@inject(<AppName>ApplicationId)
private readonly <appname>App: I<AppName>Application,

// start() 中添加启动（注意启动顺序）：
await this.<appname>App.start();
```

**启动顺序规则**：
- `WindowManager` + `MainCpServer` 先行
- `sharedApp` + `daemonApp` 并行启动
- 其余 pagelet 按依赖顺序依次启动

---

## 额外: 创建 package.json

**创建** `apps/<appname>/package.json`

```json
{
  "name": "@telegraph/<appname>",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/application/node/main.ts",
  "types": "./src/application/common/index.ts",
  "exports": {
    "./application/common": "./src/application/common/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/"
  },
  "dependencies": {
    "@telegraph/daemon": "workspace:*",
    "@telegraph/services": "workspace:*",
    "@telegraph/shared": "workspace:*",
    "@telegraph/ui": "workspace:*",
    "@x-oasis/async-call-rpc": "^0.16.0",
    "@x-oasis/async-call-rpc-electron": "^0.13.0",
    "@x-oasis/di": "^0.13.2"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
```

> `pnpm-workspace.yaml` 已包含 `apps/*`，无需修改。

---

## 验证清单

```bash
pnpm install          # 安装新 workspace 包
pnpm -r typecheck     # 路径 alias 正确性
pnpm -r lint          # 代码规范
pnpm start            # 运行并检查日志
```

日志检查：
- `/tmp/telegraph-main.log` — 确认 `[<appname>-worker] boot complete`
- Browser DevTools — 确认 orchestrator 中出现新 participant

---

## 红线（Architecture Guard）

**绝不在业务代码中出现**：

```typescript
// ❌ 禁止
ipcMain.handle(...)     ipcRenderer.invoke(...)
webContents.send(...)   utilityProcess.postMessage(...)

// ✅ 唯一正确方式
serviceHost.registerService(path, { channel, handlers: {...} })
clientHost.registerClient(path, { channel }).createProxy()
```

---

## 文件总览

| 操作 | 文件 |
|------|------|
| **编辑** | `packages/services/src/pagelet-host/src/common/index.ts` — 添加 PARTICIPANT_ID |
| **创建** | `apps/<appname>/src/application/common/index.ts` |
| **创建** | `apps/<appname>/src/application/node/main.ts` |
| **创建** | `apps/<appname>/src/application/node/<AppName>PageletWorker.ts` |
| **创建** | `apps/<appname>/src/application/electron-main/<AppName>Application.ts` |
| **创建** | `apps/<appname>/package.json` |
| **创建** | `apps/<appname>/tsconfig.json` |
| **创建** | `apps/telegraph/vite.<appname>.config.ts` |
| **编辑** | `apps/telegraph/forge.config.ts` — 添加 build entry |
| **编辑** | `apps/telegraph/tsconfig.json` — 添加 path alias |
| **编辑** | `apps/telegraph/src/application/electron-main/AppApplicationModule.ts` — 添加 binding |
| **编辑** | `apps/telegraph/src/application/electron-main/AppApplication.ts` — 添加 injection + start() |

---

## 参考实例

| App | 复杂度 | 特点 |
|-----|--------|------|
| `apps/design/` | 最小 | 仅 ping/info，无 shared/daemon |
| `apps/connection/` | 中等 | 带 `PageletWorker<ISharedService, IDaemonService>` 泛型，演示跨进程调用 |
| `apps/chat/` | 复杂 | 有状态 streaming，streamListeners 回调模式 |

新建 app 建议从 `design` 复制起手，按需参照 `connection` 和 `chat` 增加功能。

---

## Bootstrap 流程图

```
AppApplication.start()
  └─ <AppName>Application.start()
       └─ pageletProcess.spawn('<appname>', '<appname>-worker.js')
            ├─ 创建 UtilityProcessSupervisor
            ├─ Spawn child process
            └─ 注册到 orchestrator

Child process 加载 <appname>-worker.js
  └─ main.ts: Container → <AppName>PageletWorker.boot()
       ├─ 创建 ElectronUtilityProcessChannel (parentPort → main)
       ├─ createParticipantProxy → 监听 onConnection
       ├─ 并行连接 shared + daemon（5s timeout，超时不阻塞）
       └─ 等待 renderer 连接

Renderer 连接
  └─ orchestrator.connect('renderer', '<appname>')
       └─ onRendererConnection(channel) 被调用
            └─ serviceHost.registerService(servicePath, { handlers })
                 └─ RPC 就绪 ✅
```
