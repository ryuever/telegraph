---
id: D-005
title: Renderer ↔ Pagelet 通道收敛设计（Forwarding Proxy）
description: >
  讨论在 design 链路下 renderer 应否同时持有 4 条 channel（pagelet/shared/daemon/main），
  对比三种方案，最终选定 "1 条 direct port + pagelet Forwarding Proxy" 方案 A，
  并给出 exposeRemoteService 工具函数的设计草稿。
category: discussion
created: 2026-05-08
updated: 2026-05-08
tags: [orchestrator, rpc, renderer, pagelet, design, forwarding-proxy, async-call-rpc]
status: draft
references:
  - id: P-003
    rel: derived-from
    file: ../roadmap/20260508-port-management-orchestrator-migration-plan.md
  - id: A-007
    rel: related-to
    file: ../architecture/20260506-pagelet-process-communication.md
  - id: D-006
    rel: related-to
    file: ./20260508-x-oasis-orchestrator-capability-gaps.md
  - id: A-008
    rel: extended-by
    file: ../architecture/20260509-telegraph-final-process-architecture.md
    note: 本文的 Forwarding Proxy 决策被 A-008 §4.2 落地为最终架构
---

# Renderer ↔ Pagelet 通道收敛设计（Forwarding Proxy）

> 在迁移到 `ConnectionOrchestrator` 的过程中，需要回答一个核心问题：
> renderer 应该和后端几条 channel 直连？本文给出三种方案的对比与最终决策。

## 1. 问题描述

当前 design renderer 通过 `PageletClientChannel`
（`apps/telegraph/src/services/port-manager/browser/PageletClientChannel.ts`）
**同时持有 4 条 `RPCMessageChannel`**：

```
renderer ──┬── pagelet (direct)
           ├── shared  (direct, 经由 main 的 port broker)
           ├── daemon  (direct, 经由 main 的 port broker)
           └── main    (ipcRenderer)
```

问题：

1. renderer 需要知道 4 个进程的存在 → 业务代码耦合后端拓扑
2. 任一进程崩溃 → renderer 端要单独处理重连（4 套）
3. ConnectionOrchestrator 模型下，renderer 注册成 4 个 participant 与 "renderer 仅是 pagelet 的前端" 的语义冲突
4. shared / daemon 的能力是单例的；多个 renderer 各自直连容易出现 stale state

## 2. 候选方案

### 方案 A — Forwarding Proxy（推荐 ✅）

**核心**：renderer 只与 pagelet 建立 1 条 direct port；shared / daemon / main 的能力由 pagelet 进程**透明转发**。

```
renderer ──direct port── pagelet ─┬──→ shared
                                  ├──→ daemon
                                  └──→ main
```

实现方式：在同一条 `RPCMessageChannel` 上注册多个 servicePath，handler 使用 `Proxy` 透明转发到 pagelet 进程内已建立的 client：

```typescript
// 在 design pagelet utility 进程内：

// 已通过 orchestrator 拿到的远端 client
const sharedClient: SharedService = await orchestrator.connect('pagelet:design:1', 'shared')
const daemonClient: DaemonService = await orchestrator.connect('pagelet:design:1', 'daemon')
const mainClient:   MainService   = await orchestrator.connect('pagelet:design:1', 'main')

// 在 renderer↔pagelet 这条 channel 上暴露 3 个 forwarding service
exposeRemoteService({ servicePath: '/services/shared', remoteClient: sharedClient, exposeOn: rendererChannel })
exposeRemoteService({ servicePath: '/services/daemon', remoteClient: daemonClient, exposeOn: rendererChannel })
exposeRemoteService({ servicePath: '/services/main',   remoteClient: mainClient,   exposeOn: rendererChannel })

// renderer 端：
const shared = createRPCClient<SharedService>({ channel: pageletChannel, servicePath: '/services/shared' })
await shared.appInfo.getVersion()  // 透明经过 pagelet 转发到 shared
```

#### `exposeRemoteService` 工具函数设计草稿

```typescript
// apps/telegraph/src/services/connection-orchestrator/common/exposeRemoteService.ts

export interface ExposeRemoteServiceOptions<TService> {
  /** 暴露给上游的 service path，如 '/services/shared' */
  servicePath: string
  /** 已建立的远端 RPC client */
  remoteClient: TService
  /** 暴露在哪条 channel 上 */
  exposeOn: RPCMessageChannel
  /** 可选：自定义 host（默认用 Proxy 自动转发所有 method） */
  serviceHost?: TService
  /** 可选：拦截器，用于加日志 / 缓存 / 降级 */
  interceptors?: {
    before?: (method: string, args: unknown[]) => void | Promise<void>
    after?:  (method: string, result: unknown) => void | Promise<void>
    onError?: (method: string, err: unknown) => unknown // 返回 fallback
  }
}

export function exposeRemoteService<TService extends object>(
  opts: ExposeRemoteServiceOptions<TService>,
): Disposable {
  const host = opts.serviceHost ?? new Proxy({} as TService, {
    get(_, methodName: string) {
      return async (...args: unknown[]) => {
        await opts.interceptors?.before?.(methodName, args)
        try {
          const result = await (opts.remoteClient as any)[methodName](...args)
          await opts.interceptors?.after?.(methodName, result)
          return result
        } catch (err) {
          if (opts.interceptors?.onError) return opts.interceptors.onError(methodName, err)
          throw err
        }
      }
    },
  })

  return registerRPCService({
    channel: opts.exposeOn,
    servicePath: opts.servicePath,
    service: host,
  })
}
```

**优点**：

- ✅ renderer 业务**完全无感**，import 路径都是 `from '@telegraph/services/shared/common'`
- ✅ pagelet 是天然的 BFF 边界，可加缓存 / 降级 / 限流 / 拦截
- ✅ ConnectionOrchestrator 的 participant 模型自然映射（renderer 只是 pagelet 的 1 条 channel）
- ✅ 重连只需关心 1 条 channel；pagelet 内部重连对 renderer 透明
- ✅ 多个 design pagelet 实例各自有独立的 forwarding，符合 "pagelet 隔离" 语义

**缺点**：

- ⚠️ 多一跳序列化，延迟约 +1ms（同机 IPC，可接受）
- ⚠️ 大 payload（>1MB）双倍序列化开销 → Phase 8 实测，必要时 ArrayBuffer transferable
- ⚠️ pagelet 进程死了 → 所有间接调用都死。但这本来就是 pagelet 进程的设计语义

### 方案 B — 把能力下沉到 pagelet（❌ 否决）

让 pagelet 自己实现 SharedService / DaemonService 的能力，不再依赖 shared / daemon 进程。

**问题**：

- ❌ 与 A-002 / A-007 描述的 "shared / daemon 是全局单例" 语义冲突
- ❌ 4 个 pagelet 各自维护一份 LoginState 等共享状态 → 状态分裂
- ❌ daemon 的资源监控本来就是跨进程的，不能下沉

**结论**：违反系统设计原则，否决。

### 方案 C — Channel piping（协议级转发，❌ 否决）

由 x-oasis 在协议层面提供 "把 channel A 的某个 servicePath 透明 pipe 到 channel B" 的原语，无需用户态写 forwarding handler。

**问题**：

- ❌ x-oasis 当前**不支持**这种原语
- ❌ 加这个原语需要在 RPC 协议层引入新的 frame 类型（passthrough），影响面大
- ❌ 即使加了，业务侧也无法在中间插拦截器

**结论**：成本与收益不匹配，至少本阶段不做。

## 3. 决策

**采用方案 A（Forwarding Proxy）**。理由：

1. 修改面最小（renderer 业务代码不动）
2. 符合 pagelet "BFF" 设计哲学
3. 拦截 / 缓存 / 降级能力天然就位
4. 不依赖 x-oasis 新原语，可立即开始

## 4. 实施清单（详见 P-003 Phase 5）

- 5.1 preload 删除 4 条 channel acquire 逻辑，只保留 pagelet 1 条
- 5.2 实现 `exposeRemoteService` 工具函数
- 5.3 在 design pagelet utility 启动时注册 3 个 forwarding service
- 5.4 renderer 端用 servicePath 区分 4 个 service 代理
- 5.5 走读 `InlinePanelChannelManager` / `PortAwareIPCRendererChannel`，标注废弃

## 5. 后续考虑

- chat / monitor 推广时同样使用本方案
- 监控埋点：`exposeRemoteService` 的 `interceptors.before/after` 自动埋点 RPC 调用次数 + 延迟
- 对 streaming RPC（如 chat 的 token stream）需单独验证，避免 pagelet 进程成为瓶颈
- 长期可考虑给 x-oasis 提一个 "Forwarding helper" PR，把 `exposeRemoteService` 模式标准化
