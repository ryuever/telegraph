---
id: I-003
title: Renderer ↔ Design Utility RPC Ping 全链路调试复盘（Phase 4–5）
description: >
  记录 Telegraph Phase 4/5 期间 renderer 调用 design utility ping() 无响应的完整排查过程。
  共定位三个独立 Bug：port 提前到达被丢弃、MessagePort 无法跨 contextBridge 传递、
  RPCServiceHost 空数组误判导致 handler 注册失效。每个 Bug 附根因分析、修复位置与验证结论。
category: issue
created: 2026-05-08
updated: 2026-05-08
tags: [rpc, electron, ipc, messageport, renderer, utility-process, x-oasis, ping, phase4, phase5]
status: final
references:
  - id: D-006
    rel: related-to
    file: ../discussion/20260508-x-oasis-orchestrator-capability-gaps.md
  - id: R-001
    rel: related-to
    file: ../reference/20260508-x-oasis-link-to-source-setup.md
---

# Renderer ↔ Design Utility RPC Ping 全链路调试复盘（Phase 4–5）

> 记录 Telegraph Phase 4/5 期间 renderer 调用 design utility `ping()` 无响应的完整排查过程。
> 共定位三个独立 Bug：port 提前到达被丢弃、MessagePort 无法跨 contextBridge 传递、
> RPCServiceHost 空数组误判导致 handler 注册失效。

---

## 背景

Phase 4 实现了 `ConnectionsTab`，用户点 **Connect** 后可通过 direct MessagePort channel
调用 design utility 的 `/services/design.ping(now)` 并显示 RTT。Phase 5 开始烟囱测试时，
点 Ping 按钮无任何返回（请求静默超时或 reject）。

链路涉及三个进程：

```
renderer (BrowserWindow)
  │  direct MessagePort channel（由 orchestrator 推送）
  ▼
design utility (utilityProcess)
  │  RPCServiceHost → /services/design → DesignApplication.ping()
  ▼
renderer 收到 pong + serverTime，显示 RTT
```

---

## Bug 1 — Port 提前到达被丢弃

### 现象

renderer 侧 `awaitDirectChannelClient<IDesignService>(DESIGN_SERVICE_PATH)` 返回的
Promise 永不 resolve；utility 侧日志显示 activate 事件已触发。

### 根因

`directChannelClient.ts` 中 `registerOrchestratorHandler(cpChannel, onPort)` 注册回调时，
存在一个时序窗口：若 main 推送的 `activateConnection` 消息在回调注册之前已经到达
（冷启动时 utility 进程 ready 比 renderer 挂载快），port 消息会被静默丢弃。

```
main 推 port  ──► cpChannel 消息队列
                        │
                        ▼  (早于 onPort 注册)
                   [丢弃，无处消费]

稍后 onPort 注册  ──► 永远等不到 port
```

### 修复

`directChannelClient.ts`：在 `installHandlerOnce()` 内引入 `earlyPorts` FIFO 队列，
先到的 port 缓存起来；回调注册后立即 drain 队列。

```typescript
// apps/telegraph/src/services/connection-orchestrator/browser/directChannelClient.ts
const earlyPorts: MessagePort[] = [];

registerOrchestratorHandler(cpChannel, (port) => {
  if (pendingResolvers.size > 0) {
    dispatchActivatedPort(port);
  } else {
    earlyPorts.push(port);   // 缓存提前到达的 port
  }
});

// 注册 pendingResolver 后立即 drain
function drainEarlyPorts() {
  while (earlyPorts.length > 0 && pendingResolvers.size > 0) {
    dispatchActivatedPort(earlyPorts.shift()!);
  }
}
```

### 验证

加日志确认 `earlyPorts` drain 路径被命中，Promise resolve，ping 请求发出。

---

## Bug 2 — MessagePort 无法跨 contextBridge 传递

### 现象

fix Bug 1 后，ping 请求发出但 utility 侧收不到任何消息。
renderer 控制台报 `Cannot transfer non-transferable object` 或相关 contextBridge 限制错误。

### 根因

Electron contextBridge 对 `MessagePort` 有严格限制：不能把 `MessagePort` 对象本身
通过 `contextBridge.exposeInMainWorld` 暴露给 renderer 的 JS 沙盒，也不能让
renderer 侧代码直接持有 `MessagePort` 实例再手动 `postMessage`。

原设计在 preload 里把 port 通过 bridge 传出去，renderer 自己建 `RPCMessageChannel`，
这条路在 Electron 的安全模型下行不通。

### 修复

把所有 port 处理逻辑**完全收进 preload**：

- preload 监听 `activateConnection` 事件，拿到 port 后在 preload 进程内建
  `RPCMessageChannel` + `ProxyRPCClient`；
- 通过 contextBridge **只暴露普通函数** `window.telegraph.designService.ping(now: number)`；
- renderer 侧代码不再接触任何 `MessagePort` 对象。

```typescript
// apps/telegraph/src/application/preload/preload.ts
registerOrchestratorHandler(cpChannel, (port: MessagePort) => {
  const directChannel = new RPCMessageChannel({ port, description: 'design-direct' });
  const client = new ProxyRPCClient(DESIGN_SERVICE_PATH, { channel: directChannel })
    .createProxy<IDesignService>();
  designServiceProxy = client;
});

contextBridge.exposeInMainWorld('telegraph', {
  ipcRenderer: { /* ... */ },
  designService: {
    ping: (now: number) => designServiceProxy?.ping(now),
  },
});
```

### 验证

ping 请求成功发出，utility 侧 RAW port listener 确认收到消息帧。

---

## Bug 3 — RPCServiceHost 空数组误判（核心 Bug）

### 现象

utility 侧日志显示：
- port 收到 ✅
- `ElectronMessagePortMainChannel` 绑定完成 ✅
- RAW port listener 收到 ping 消息帧 ✅
- `handleRequest` middleware 日志：`handlerFound=false, serviceMapKeys=["/services/design"]`

请求被 `handleRequest` 静默丢弃（`if (!handler) return message`），无任何错误抛出。

### 根因

`RPCServiceHost.registerServiceHandler` 用以下逻辑区分「handler map」vs「类实例」：

```typescript
// 修复前（x-oasis 原代码）
const isHandlerMap = Object.values(instanceOrHandlers).every(v => typeof v === 'function');
```

`DesignApplication` 是**类实例**，所有方法定义在 **prototype** 上，
`Object.values(instance)` 返回 `[]`（空数组，因为没有可枚举的自身属性）。

`[].every(predicate)` 在 JavaScript 中**永远返回 `true`**（空集的全称命题为真）。

因此：
1. `isHandlerMap = true`（误判）
2. 走 `handlers: instanceOrHandlers` 分支 → `Object.entries({})` = `[]` → 没有任何 handler 注册
3. `service.getHandler('ping')` 返回 `undefined`
4. `handleRequest` middleware 检测到 `!handler`，直接 `return message` 不作响应

整个过程无任何错误日志，请求被静默丢弃。

### 修复

**修复位置**：`/Users/ryuyutyo/Documents/code/red/x-oasis/packages/async/async-call-rpc/src/endpoint/RPCServiceHost.ts`

```typescript
// 修复后
const ownValues = Object.values(instanceOrHandlers);
const isHandlerMap =
  ownValues.length > 0 && ownValues.every((v) => typeof v === 'function');
```

加了 `ownValues.length > 0` 前置条件：
- 空数组 → `false`，走 instance 路径，通过 prototype 查找方法 ✅
- 有自身可枚举属性且全是函数 → `true`，走 handler map 路径 ✅
- 混有非函数属性 → `false`，走 instance 路径 ✅

修复后 `RPCService.setInstance(instanceOrHandlers)` 被调用，`getHandler` 走：

```typescript
// RPCService.ts:43-51
getHandler(methodName: string) {
  const explicit = this.handlersMap.get(methodName);
  if (explicit) return explicit;
  if (this._instance) {
    const fn = (this._instance as any)[methodName];
    if (typeof fn === 'function') return fn.bind(this._instance);
  }
  return undefined;
}
```

prototype 上的 `ping` 方法通过 `this._instance` 正确找到并 bind。

修复后需在 x-oasis 仓执行 `pnpm compile`（`async-call-rpc` + `async-call-rpc-electron`）以刷新 dist，telegraph 通过 link-to-source 立即生效（参见 [R-001](../reference/20260508-x-oasis-link-to-source-setup.md)）。

### 验证

utility 侧 `handlerFound=true`，`DesignApplication.ping()` 被调用，
renderer 收到 `{pong, serverTime}`，RTT 数字正常显示。

---

## 诊断方法记录

### forge 吞 stdout 问题

forge 在非 TTY 模式（nohup / CI）下会吞掉 utility 进程的所有 `console.log`/`console.error`。
解决方案：utility 进程中改用 `appendFileSync` 直接写文件：

```typescript
// apps/design/src/application/node/DesignBootstrap.ts
import { appendFileSync } from 'node:fs';
const dlog = (msg: string) =>
  appendFileSync('/tmp/telegraph-design.log', `[design] ${msg}\n`);
```

同样适用于 preload（写 `/tmp/telegraph-preload.log`）和 x-oasis 内部中间件（临时诊断）。

### 逐层追踪顺序

有效的分层诊断顺序（从 "消息是否发出" 到 "消息是否被处理"）：

1. renderer：`channel.connected` 是否 `true`，`postMessage` 是否执行
2. preload：port 是否绑定，`bindPort` 完成日志
3. utility：RAW `port.on('message')` 是否收到原始帧（绕过 x-oasis 中间件）
4. `handleRequest` middleware：`handlerFound` 是否 `true`
5. `RPCService.getHandler`：是否走到 prototype 查找

---

## 时间线

| 节点 | 事项 |
|------|------|
| Phase 4 完成 | `ConnectionsTab` + `awaitDirectChannelClient` 实现完毕，typecheck 全绿 |
| Phase 5 烟囱测试 | 点 Ping 无响应，开始排查 |
| Bug 1 定位 & 修复 | `earlyPorts` 队列，port 提前到达不丢失 |
| Bug 2 定位 & 修复 | preload 完全持有 port，contextBridge 只暴露普通函数 |
| Bug 3 定位 & 修复 | `RPCServiceHost.isHandlerMap` 加 `length > 0` 前置条件 |
| x-oasis `pnpm compile` | `async-call-rpc` + `async-call-rpc-electron` dist 刷新 |
| 烟囱通过 | 点 Connect → READY，点 Ping → RTT 数字正常显示 |

---

## 修复变更清单

| 文件 | 改动 | 原因 |
|------|------|------|
| `x-oasis/.../RPCServiceHost.ts` | `isHandlerMap` 加 `ownValues.length > 0` | Bug 3：空数组误判 |
| `apps/telegraph/.../preload/preload.ts` | port 处理移入 preload，bridge 只暴露函数 | Bug 2：contextBridge 限制 |
| `apps/telegraph/.../browser/directChannelClient.ts` | `earlyPorts` FIFO 队列 | Bug 1：port 提前到达 |

---

## 复发排查 Runbook

点 Ping 无响应时，按以下顺序检查：

1. **`/tmp/telegraph-design.log`** 中是否有 `direct channel activated`
   - 无 → Connect 未建立，检查 orchestrator / port 推送链路
   - 有 → 继续

2. **utility RAW listener** 是否收到消息帧（临时加 `port.on('message', ...)` 诊断）
   - 无 → renderer 侧 channel 未 connected，检查 preload port 绑定
   - 有 → 继续

3. **`handleRequest` middleware** 中 `handlerFound` 是否 `true`
   - `false` → 检查 `RPCServiceHost.registerServiceHandler` 调用，确认 `isHandlerMap` 判断正确
   - `true` → handler 执行中报错，检查 `DesignApplication.ping` 实现

4. **x-oasis dist 是否最新**
   - 改完 x-oasis 源码后未跑 `pnpm compile`，dist 不更新，link-to-source 仍用旧版本
