---
id: P-003
title: Port Management → ConnectionOrchestrator 迁移计划（design 先行）
description: >
  将 telegraph 现有手工 port 编排（services/port-manager + services/process）
  迁移到 @x-oasis/async-call-rpc-electron 的 ConnectionOrchestrator 能力，
  第一阶段仅适配 apps/design 链路并提供 Connections Tab 可视化验证，
  跑通后再推广到 chat / monitor。
category: roadmap
created: 2026-05-08
updated: 2026-05-08
tags: [port-management, orchestrator, async-call-rpc, electron, design, refactor, roadmap]
status: draft
references:
  - id: A-002
    rel: related-to
    file: ../architecture/20260504-multi-process-topology.md
  - id: A-007
    rel: related-to
    file: ../architecture/20260506-pagelet-process-communication.md
  - id: D-005
    rel: extended-by
    file: ../discussion/20260508-renderer-pagelet-channel-convergence.md
  - id: D-006
    rel: extended-by
    file: ../discussion/20260508-x-oasis-orchestrator-capability-gaps.md
  - id: R-001
    rel: extended-by
    file: ../reference/20260508-x-oasis-link-to-source-setup.md
---

# Port Management → ConnectionOrchestrator 迁移计划（design 先行）

> 把 telegraph 当前散落在 `apps/telegraph/src/services/port-manager/` 与
> `apps/telegraph/src/services/process/` 的手工 port 编排，迁移到
> `@x-oasis/async-call-rpc-electron` 新引入的 `ConnectionOrchestrator`。
> **第一阶段范围只覆盖 design 链路**；chat / monitor 维持旧通路并行运行，
> 跑通后再推广。本文是 Plan v2，承载完整 9 个 Phase + 决策与依赖清单。

## 来源

- 用户原始需求：`codebase-wiki/architecture/refactor-port-management.md`
- x-oasis 设计方案：`/Users/ryu/Documents/code/red/x-oasis/ASYNC_CALL_RPC_CONNECTION_ORCHESTRATOR.md`
- x-oasis 场景文档：`/Users/ryu/Documents/code/red/x-oasis/packages/async/async-call-rpc-electron/docs/scenario-orchestration.md`

## 1. 目标与非目标

### 目标

- design 链路 (renderer ↔ pagelet ↔ shared / daemon / main) 全部走 `ConnectionOrchestrator`
- renderer 只持有 1 条到 pagelet 的 direct port；shared / daemon / main 能力由 pagelet **透明转发**（详见 D-005）
- 在 design panel 内提供 **Connections Tab + Ping** 按钮，可视化拓扑与连通性
- 进程崩溃 / 重启场景能自动重连（依赖 x-oasis 几个补强能力，详见 D-006）
- design 跑通后规范化目录（`browser` / `node` / `electron-main`），UI 从 `packages/ui/src/components/design/` 迁回 `apps/design/src/application/browser/`

### 非目标

- 本阶段不动 chat / monitor 的 port 通路
- 不改变 `services/window-manager` 中 BrowserWindow / panel 切换逻辑
- 不引入新的进程类型；只重组现有 4 类（main / shared / daemon / pagelet）的握手方式

## 2. 关键决策（已与用户确认）

| 决策 | 选择 | 理由 |
|------|------|------|
| 第一阶段范围 | 仅 design | 风险面小、有完整 4 边链路代表性 |
| renderer 通信收敛 | 1 条 direct port + Forwarding Proxy（选项 A） | renderer 业务无感、pagelet 是天然 BFF 边界、可加缓存/拦截。详见 D-005 |
| x-oasis 依赖处理 | 全 4 个 app 通过 `pnpm.overrides` link 到本地 source | 需要边迁移边补强 x-oasis 能力，避免发版来回弹跳。详见 R-001 |
| vite external | 移除 `vite.main.config.ts` / `vite.fork.config.ts` 中的 `/@x-oasis\/async-call-rpc\/.*/` external | 让 x-oasis 被打进 main / fork bundle，配合 link to source |
| 目录结构 | apps/design 完整重构为 `browser/node/electron-main` 三段 | 与 chat 对齐；UI 迁回 app 内 |
| 可视化 | design panel 内 Connections Tab + Ping | 验收物 |

## 3. Phase-Gate 总览

```
Phase 0  (依赖准备)        ─┐
Phase 1  (apps/design 重构) │
Phase 2  (AppOrchestrator)  │  并行
Phase 3  (各 process 暴露)  ─┘
   ↓
Phase 4  (design utility 端接 port)
   ↓
Phase 5  (renderer 改造 + Forwarding Proxy)
   ↓
Phase 6  (OrchestratorInspectorService)
   ↓
Phase 7  (Connections Tab UI)
   ↓
Phase 8  (联调 + 故障注入)
   ↓
Phase 9  (Wiki / 文档同步)
```

---

## Phase 0 — 依赖准备 & link 验证

**目标**：让 telegraph workspace 能够直接消费 x-oasis 本地 source，且 main / fork bundle 能正确打包。

| Step | 动作 | 涉及文件 |
|------|------|----------|
| 0.1 | 修改 x-oasis 上游 12 个包的 `package.json` 的 `main` / `module` / `typings` 指向 `src/index.ts` | `red/x-oasis/packages/{async,promise,event,misc,assertion}/**/package.json` |
| 0.2 | telegraph 顶层 `package.json` 加 `pnpm.overrides`（12 个 link 协议） | `package.json` |
| 0.3 | `pnpm install`，验证 4 个 app 的 `node_modules/@x-oasis/*` 都是 symlink | — |
| 0.4 | 移除 vite external 规则 | `apps/telegraph/vite.main.config.ts` / `vite.fork.config.ts` |
| 0.5 | 在 `apps/{telegraph,chat,design,monitor}/tsconfig.json` 的 `paths` 加 source 路径（IDE 跳转用） | 各 app 的 `tsconfig.json` |
| 0.6 | `pnpm start` 烟雾测试，确认现有功能不退化 | — |

详细步骤见 **R-001**。

**Exit Gate**：旧通路（chat / design / monitor）功能 0 退化；x-oasis 任何 src 改动 telegraph 即时生效（带 sourcemap）。

---

## Phase 1 — apps/design 目录重构

**目标**：把 design 改成与 chat 对齐的标准结构，UI 迁回 app 内。

```
apps/design/
├── src/
│   ├── application/
│   │   ├── browser/
│   │   │   ├── DesignEntry.tsx          ← 从 packages/ui 迁入
│   │   │   ├── DesignPanel.tsx          ← 从 packages/ui 迁入
│   │   │   ├── DesignWorkspace.tsx      ← 从 packages/ui 迁入
│   │   │   └── connections/             ← 新增（Phase 7）
│   │   │       └── ConnectionsTab.tsx
│   │   ├── node/                        ← 新增
│   │   │   └── DesignPageletNode.ts
│   │   ├── electron-main/               ← 新增（仅放 main 侧适配）
│   │   └── design-application.ts        ← 保留
│   └── main.ts                          ← 保留 amdEntry wrapper
├── package.json                          ← 加 exports map
└── ...
```

**Tasks**：

1.1 把 `packages/ui/src/components/design/{DesignEntry,DesignPanel,DesignWorkspace}.tsx` 迁入 `apps/design/src/application/browser/`
1.2 在 `apps/design/package.json` 加 exports map，让 `apps/telegraph/src/index.tsx` 通过 `@design/browser/*` 导入
1.3 检查并更新 `apps/telegraph/src/services/window-manager/electron-main/BrowserWindow.ts:34-37` 的 `INLINE_AMD_ENTRIES`
1.4 `pnpm dev` 验证 design panel 正常渲染

**Exit Gate**：design panel UI 表现与重构前完全一致；`packages/ui/src/components/design/` 目录消失。

---

## Phase 2 — 引入 AppOrchestrator（main 进程侧）

**目标**：在 main 进程中创建一个 **全局唯一** 的 `ElectronConnectionOrchestrator`，所有 participant 在它这里注册。

**Tasks**：

2.1 新建 `apps/telegraph/src/services/connection-orchestrator/electron-main/AppOrchestrator.ts`
  - 持有一个 `ElectronConnectionOrchestrator` 实例
  - 暴露 `registerParticipant(id, channel, role)` / `connect(a, b)` / `getTopology()` API
  - DI 注册到 `Container`（参考 A-001）
2.2 配置默认重连策略（指数退避，maxAttempts: 5）和心跳（5s 间隔）
2.3 订阅所有事件 (`onStateChange/onReady/onDisconnected/...`) 输出到 logger
2.4 暴露事件给 renderer（通过 `OrchestratorInspectorService`，见 Phase 6）

**Exit Gate**：单元自测 — 手动注册 2 个 mock participant，`connect` 后能收到 `READY`。

---

## Phase 3 — 各 process 暴露 participant channel

**目标**：让 shared / daemon / pagelet 都把自己注册成 orchestrator 的 participant。

**Tasks**：

3.1 `apps/telegraph/src/services/process/shared-process/electron-main/SharedProcessMain.ts`
  - 进程启动后向 `AppOrchestrator.registerParticipant('shared', channel, 'utility')`
3.2 `daemon-process/electron-main/DaemonProcessMain.ts` 同 3.1，id = `'daemon'`
3.3 `pagelet-process/electron-main/PageletProcess.ts`
  - 每次 spawn pagelet 时注册 `participantId = 'pagelet:<appName>:<instanceId>'`
3.4 main 进程自己注册 `id = 'main'`
3.5 删除 / 标记废弃 `services/port-manager/electron-main/AcquireProcessPortMain.ts` 中 design 相关分支

**Exit Gate**：启动 telegraph 后 `AppOrchestrator.getTopology()` 能列出 main / shared / daemon / pagelet:design:* 4 个节点。

---

## Phase 4 — design utility 端接 port + 内部 client

**目标**：design pagelet utility 进程内主动 `connect` 到 shared / daemon / main，并各持一个 RPC client。

**Tasks**：

4.1 在 `apps/design/src/application/node/DesignPageletNode.ts` 启动时
  - 通过 IPC 向 main 申请 `connect('pagelet:design:<id>', 'shared' | 'daemon' | 'main')`
  - 等待 `READY` 事件
  - 包装成 `SharedClient` / `DaemonClient` / `MainClient`
4.2 在 design utility 内通过 DI 注册这 3 个 client
4.3 测试：在 design utility 中调用 `sharedClient.appInfo.getVersion()` 能拿到结果

**Exit Gate**：design utility ↔ shared/daemon/main 三条链路均 READY 且能调用 RPC。

---

## Phase 5 — renderer 改造（1 条 direct + Forwarding Proxy）

**目标**：renderer 只持有 1 条到 pagelet 的 direct port；shared/daemon/main 能力通过 pagelet 转发。

**Tasks**：

5.1 preload 改造：去掉 `PageletClientChannel` 中 4 条 channel 的逻辑，只保留 1 条到 pagelet 的 channel acquire
5.2 新建工具函数 `exposeRemoteService({ servicePath, remoteClient, exposeOn, serviceHost, interceptors? })`，放置在 `apps/telegraph/src/services/connection-orchestrator/common/exposeRemoteService.ts`
5.3 在 design pagelet utility 内调用：
  ```ts
  exposeRemoteService({ servicePath: '/services/shared', remoteClient: sharedClient, exposeOn: rendererChannel })
  exposeRemoteService({ servicePath: '/services/daemon', remoteClient: daemonClient, exposeOn: rendererChannel })
  exposeRemoteService({ servicePath: '/services/main',   remoteClient: mainClient,   exposeOn: rendererChannel })
  ```
5.4 renderer 端通过 `createRPCClient({ channel, servicePath: '/services/shared' })` 拿到 SharedService 代理
5.5 design renderer 业务代码（DesignWorkspace 等）切换到新 client；旧 InlinePanelChannelManager 走读

**Exit Gate**：renderer 只创建 1 个 `RPCMessageChannel`；通过 4 个 servicePath（pagelet 自身 + 3 个转发）都能拿到响应。

设计依据见 **D-005**。

---

## Phase 6 — OrchestratorInspectorService

**目标**：把 orchestrator 的拓扑、状态、事件流暴露给 renderer，供 Connections Tab 消费。

**Tasks**：

6.1 新建 `apps/telegraph/src/services/connection-orchestrator/{common,electron-main,browser}/OrchestratorInspectorService.ts`
  - `common`：接口定义 `IOrchestratorInspectorService`、事件载荷类型
  - `electron-main`：实现，wrap `AppOrchestrator`
  - `browser`：RPC 代理（按 A-001 范式）
6.2 暴露的 API：
  - `getTopology(): Topology`
  - `getStats(participantId): ConnectionStats`
  - `subscribeStateChange(cb)`
  - `ping(participantId): Promise<{ rtt: number }>` — 通过 orchestrator 发心跳
6.3 在 main 进程的 RPC 路由表注册

**Exit Gate**：renderer 能调用 `inspector.getTopology()` 拿到 4+ 个节点的当前状态。

---

## Phase 7 — Connections Tab UI

**目标**：在 design panel 内嵌入 Connections Tab，实时展示拓扑 + 提供 Ping 按钮。

**Tasks**：

7.1 新建 `apps/design/src/application/browser/connections/ConnectionsTab.tsx`
7.2 用 shadcn `Card` + `Table` 渲染：
  - 列：participantId / role / state / lastReadyAt / reconnectCount / RTT
  - 行操作：Ping 按钮（调用 `inspector.ping(id)`）
7.3 在 `DesignPanel.tsx` 加入 Tabs（Workspace / Connections）
7.4 订阅 `inspector.subscribeStateChange` 实时刷新
7.5 视觉：READY = 绿、TRANSIENT_FAILURE = 黄、CLOSED = 红

**Exit Gate**：开发者点开 design panel → Connections Tab → 看到 4 行连接 → 点 Ping → RTT < 50ms。

---

## Phase 8 — 联调 + 故障注入

**目标**：验证重连、跨进程 RPC、性能不退化。

**测试矩阵**：

| 场景 | 操作 | 预期 |
|------|------|------|
| pagelet 崩溃 | `process.kill('pagelet:design:*')` | renderer 自动重连，Connections Tab 显示 TRANSIENT_FAILURE → READY |
| shared 崩溃 | `process.kill('shared')` | design 通过 pagelet 转发的 shared 调用先失败、shared 恢复后自动恢复（依赖 D-006 Gap 1） |
| daemon kill 重启 | daemon kill | design / monitor 重连成功 |
| renderer 刷新 | DevTools Reload | direct port 重建 + 4 个 servicePath 可调用 |
| 大 payload | 1MB JSON 通过 forwarding | < 50ms RTT、内存无泄漏 |

**Exit Gate**：上述 5 个用例全 pass。

---

## Phase 9 — 文档 / Wiki 更新

9.1 在 `architecture/` 新写 A-008 反映新通路（设计完成后）
9.2 把 `refactor-port-management.md` 标注为 **历史 brief**（不删除）
9.3 在 `A-002` / `A-007` 中追加 "design 已迁移到 ConnectionOrchestrator" 备注

---

## 4. 依赖与风险

### 强依赖（必须先解锁）

| 依赖 | 来源 | 影响 Phase |
|------|------|------------|
| x-oasis Gap 1: `replaceParticipantChannel(id, channel)` | x-oasis 上游 | Phase 8 进程重启重连 |
| x-oasis Gap 2: `activateTimeoutMs` + 首连重试 | x-oasis 上游 | Phase 4 启动时序 |
| x-oasis Gap 3: channel 自动桥接 `handleParticipantLost` | x-oasis 上游 | Phase 8 故障注入 |

详见 **D-006**。

### 风险

- **link to source 之后类型不一致**：若 x-oasis src/dist 的 `.d.ts` 有 drift，TS 报错。**缓解**：CI 加 `pnpm -r typecheck`。
- **Forwarding Proxy 性能开销**：多一跳序列化。**缓解**：Phase 8 实测，必要时引入 transferable / passthrough 模式。
- **Forge 打包**：移除 vite external 后 main bundle 体积变大。**缓解**：评估 tree-shaking，必要时只 inline async-call-rpc 自身、保留 utility 包 external。

## 5. 验收物（与 refactor-port-management.md 对齐）

- ✅ design panel 内可视化入口（Connections Tab）
- ✅ 列出 design pagelet 当前连接的所有 process
- ✅ 同时显示这些 process 之间的建联（拓扑图）
- ✅ 实例验证 renderer ↔ process 通信正常（Ping RTT）

## 6. 后续推广

design 跑通后：

1. chat 复制 Phase 1 / 4 / 5（结构已是标准，工作量更小）
2. monitor 是单独 BrowserView，可只做 Phase 4 / 5（preload 共用）
3. 删除 `services/port-manager/` 全部代码
4. `services/process/` 中只保留进程生命周期管理（spawn / kill），握手逻辑全部下沉到 orchestrator
