---
id: A-003
title: Telegraph 性能与稳定性监控体系
description: >
  从崩溃捕获、进程性能采集、心跳/探活、日志管线、诊断快照、端口/连接健康度、
  错误边界 7 个维度展开 apps/telegraph 的可观测性设计，并标注代码层可见的稳定性差距，
  作为后续监控能力建设的清单。
category: architecture
created: 2026-05-04
updated: 2026-05-04
tags: [monitoring, observability, crash-report, sentry, diagnostics, ping, log]
status: superseded
references:
  - id: A-001
    rel: related-to
    file: ./20260504-di-and-cross-platform-paradigm.md
  - id: A-002
    rel: related-to
    file: ./20260504-multi-process-topology.md
---

# Telegraph 性能与稳定性监控体系

> 本文按七个维度展开 `apps/telegraph` 的性能与稳定性监控：(1) 崩溃捕获、(2) 进程性能采集、(3) 心跳/探活、(4) 日志管线、(5) 诊断快照、(6) 端口/连接健康、(7) 错误边界。每个维度同时给出代码层可见的差距，便于后续逐项补齐。

---

## 1. 崩溃捕获 (Crash Reporter)

### 1.1 实现：Electron 原生 `crashReporter` + Sentry 转发

`src/application/helper/crash.ts`（全文 22 行）：

```ts
import { app, crashReporter } from 'electron'

export function initCrashListener(logService: LogService) {
  app.setPath('crashDumps', path.join(app.getPath('logs'), 'crashes'))
  crashReporter.start({ uploadToServer: false })           // ← 仅本地落 dump
  app.on('render-process-gone', (_event, webContents, details) => {
    logService.fatal(CrashLog.RenderProcessGone, {
      ...details, url: webContents.getURL(),
    })
  })
  app.on('child-process-gone', (_event, details) => {
    logService.fatal(CrashLog.ChildProcessGone, details)
  })
}
```

- **本地 dump 路径**：`<userData>/logs/crashes/`
- **远端聚合路径**：`logService.fatal(...)` → `CommonNodeLogger.fatal` → `SentryReport.fatal`（详见 §4）
- 在 `TelegraphApplication.start()`（`telegraph-application.ts:122`）启动期间被调用一次。

### 1.2 BaseWindow 级窗口异常事件

`src/services/window-manager/electron-main/BaseWindow.ts:105-134` 在每个窗口实例上监听三类异常：

| 事件 | 上报 |
|---|---|
| `webContents.unresponsive` | `onWindowError(WindowError.UNRESPONSIVE)` → `logService.error` |
| `webContents.did-fail-load` | `onWindowError(WindowError.CONTENT_FAIL_LOAD, { errorCode, errorDesc })` |
| `webContents.render-process-gone` | `onWindowError(WindowError.RENDER_PROCESS_GONE, details)` |

### 1.3 主进程顶层异常处理

`src/application/main.ts:12-14`：

```ts
process.on('uncaughtException',  (e) => dlog(`UNCAUGHT: ${(e as Error)?.stack || e}`))
process.on('unhandledRejection', (e) => dlog(`UNHANDLED: ${(e as Error)?.stack || e}`))
process.on('exit',               (code) => dlog(`EXIT code=${code}`))
```

`dlog`（lines 4-9）使用 `appendFileSync` 写到硬编码路径 `/tmp/telegraph-main.log`。

### 1.4 差距

1. **`crashReporter.uploadToServer` 强制为 `false`**：原生 native crash 仅留本地 dump，未上送任何服务（Sentry 只覆盖了 JS 异常路径）。
2. **`/tmp/telegraph-main.log` 硬编码路径**：Windows 不存在 `/tmp`；macOS/Linux 重启后会被清理。
3. **utility-process 内部无 `uncaughtException` 处理**：shared / daemon / pagelet bootstraps 均未注册任何顶层异常处理，崩溃只能由主进程的 `child-process-gone` 兜底。
4. **`render-process-gone` 仅日志、无窗口恢复**：未尝试重新打开页面或弹出错误页。

---

## 2. 进程性能采集 (App Metrics)

### 2.1 main 端暴露原生数据

`src/services/main-process-util/electron-main/index.ts:18-20`：

```ts
getAppMetrics: IMainProcessUtils['getAppMetrics'] = async () => app.getAppMetrics()
```

`AppMetric` 字段（`main-process-util/common/types.ts:1-13`）：`pid` / `type` / `name` / `cpu.{percentCPUUsage,idleWakeupsPerSecond}` / `memory.{workingSetSize,peakWorkingSetSize}`。

### 2.2 daemon 端聚合 + 上报

`src/services/diagnostics/node/Diagnostics.ts:44-79`，`getPerformanceInfo()`：

1. 通过 `MainProcessUtilsClient.getAppMetrics()` 跨进程拉取（daemon → main RPC）
2. 过滤 GPU 与 Network Service 行（`appMetric.name === NetworkServiceProcess`，**locale 敏感**）
3. 重组为 `ProcessRow[]`，求和 totals
4. 触发两条 trace：
   ```ts
   logService.trace(TrackerEvent.TelegraphStabilityValues, TrackerScene.AppUsedMemory, totalMemory)
   logService.trace(TrackerEvent.TelegraphStabilityValues, TrackerScene.AppUsedCPU,    totalCpu)
   ```

### 2.3 阶段性能埋点

`src/services/log/common/performance.ts` 提供 `PerformanceTracker`，按 stage 记录耗时；上报通道为 `pc_telegraph_performance`。stage 枚举见 `src/services/log/common/constants/tracker.ts:7-16`：

```ts
export enum PerformanceStage {
  AppLaunch        = 'appLaunch',
  GetProfile       = 'getProfile',
  ValidAuth        = 'validAuth',
  LoadMainPage     = 'loadMainPage',
  LoadAppPage      = 'loadAppPage',
  WaitAppReady     = 'waitAppReady',
  CreateMainWindow = 'createMainWindow',
  CreateBrowserView = 'createBrowserView',
}
```

调用方：`TelegraphApplication.start()` / `Workbench.createMainWindow()` / `Pagelet.createBrowserView()`。

### 2.4 差距

1. **内存单位换算 bug**（`Diagnostics.ts:54`）：`(item.memory.workingSetSize / 1024).toFixed(2)`，电子文档明确 `workingSetSize` 单位是 **bytes**，结果应除以 `1024 * 1024` 才是 MB；现状报告的是 **KB 但被标记为 MB**，CPU/Memory 看板会偏低 1024 倍。
2. **未采集 `process.getProcessMemoryInfo()`**：缺乏 V8 堆/常驻内存细分。
3. **未采集 FPS / 渲染帧率**：`webContents.getFrameRate()` 等接口未使用。
4. **未抓 V8 heap snapshot**：缺少长时间运行的内存泄漏定位手段。
5. **5 秒周期硬编码**（`Diagnostics.ts:121-125`），不可配置。

---

## 3. 心跳与探活 (Ping)

### 3.1 实现：每个 utility-process 每 10 秒心跳到主进程

`src/services/ping/node/ProcessPingClient.ts:39-68`：

```ts
this.pingInterval = 10 * 1000

setupReporter() {
  this._processReporter = new ElectronUtilityProcessChannel({
    parentPort: process.parentPort as any,
    description: `${this._processName}-xxxx-process`,
  })
  this._processReporter.setServiceHost(this.serviceHost)

  setInterval(() => { this.onPingEvent.fire(this._processName) }, this.pingInterval)

  this._rpcClient = new ProxyRPCClient(PingMainServicePath, {
    channel: this._processReporter,
  }).createProxy<IProcessPingMain>()
  this._rpcClient.connect()
}
```

主进程侧 `ProcessPingMain.ping()`（`ping/electron-main/ProcessPingMain.ts:56-58`）每收到一次心跳就更新 `_updateTime = Date.now()`。

### 3.2 差距

1. **心跳数据无消费者**：没有任何代码读取 `_updateTime`，因此**没有 stall watchdog、没有自动重启、没有告警**——心跳事实上只起到"日志可见"的效果。
2. **TODO 已记**（`ProcessPingMain.ts:69-70`）："这么做现在有问题，比如shared process相当于有两个地方接受 process client 发来的消息"——已知的 message 路由竞态。
3. **processName 硬编码**（`AcquireProcessPortMain.ts:116, :139` 都写死 `'shared-process'`），即便服务的是 daemon 进程也会传 `shared-process`，看起来是 copy-paste bug。

---

## 4. 日志管线 (Logging Pipeline)

### 4.1 三层抽象

| 层 | 文件 | 角色 |
|---|---|---|
| 抽象基类 | `services/log/common/Logger.ts` | `setLevel/getLevel/checkLogLevel`；`LogLevel` 见 `common/types/log.ts:3-10`（10/20/30/40/50/60 = trace/debug/info/warn/error/fatal） |
| 服务包装 | `services/log/common/log.ts` | `LogService`（DI Token = `LogServiceId`）；service path = `LogServicePath = '/services/log'` |
| Console 实现 | `services/log/common/consoleLogger.ts` | `@x-oasis/ansi-colors`；`trace()` 是 no-op |
| 生产实现 | `services/log/node/nodeLogger.ts` | `CommonNodeLogger`：`electron-log` + Sentry + DataTracker |

### 4.2 三个 Transport

`src/services/log/node/nodeLogger.ts:12-50`：

```ts
const maxLogFileSize = 500 * 1024 ** 2  // 500MB（注释：磁盘最多 maxLogFileSize * 2）
const IS_DEV = process.env.NODE_ENV === 'development'

constructor(options: NodeLogParams) {
  const { bizName, rootTraceId, appVersion } = options
  this.logger = this.initLogInfo(bizName)
  if (!IS_DEV) {
    this.reporter = new SentryReport(bizName, rootTraceId, appVersion)
    this.tracker  = new DataTracker({ rootTraceId, appVersion })
  }
}

private initLogInfo(bizName: string) {
  const curLoggerInstance = nodeLogger.create({ logId: bizName })
  const fileTransport = curLoggerInstance.transports.file
  fileTransport.fileName = `${bizName}.log`
  fileTransport.sync = false
  fileTransport.maxSize = maxLogFileSize
  if (IS_DEV) fileTransport.level = false
  else        curLoggerInstance.transports.console.level = false
  return curLoggerInstance.scope(bizName)
}
```

| Transport | 文件 | 行为 |
|---|---|---|
| `electron-log` 文件/控制台 | `electron-log` 默认 `<userData>/logs/` | `<bizName>.log` 500MB 滚动；prod 关闭 console / dev 关闭 file |
| Sentry | `services/log/node/sentry.ts` | `dsn: 'https://6dfd3c8f45104e178fb159956adb94b8@new-sentry-relay.xiaohongshu.com/177'`；`tracesSampleRate: 1.0`；tag = `app_version` / `biz_name` / `root_trace_id`；`info` 单组 fingerprint = `pc_telegraph_log_group` 防刷 |
| DataTracker（APM） | `services/log/node/tracker.ts` | URL 见 `log/common/constants/url.ts:1`：`https://apm-fe.xiaohongshu.com/api/data`；批量 5 条或 2s 触发；headers `'biz-type': 'apm_fe'` + `batch: 'true'`；payload 含 `context_platform/context_artifactVersion/context_userId/custom_c1=rootTraceId/measurement_name/measurement_data` |

`getLogPath()`（`nodeLogger.ts:102-104`）：返回 `<userData>/logs/`。`TelegraphMenu` 提供"打开日志文件"菜单项。

### 4.3 每进程独立 bizName

| 进程 | bizName | 文件 |
|---|---|---|
| main | `main` | `telegraph-application-module.ts:97` |
| shared | `share-process`（拼写差异） | `SharedProcessModule.ts:30` |
| daemon | `daemon-process` | `DaemonProcessModule.ts` |
| pagelet | `<projectName>` | `PageletProcessModule.ts:33` |

### 4.4 日志事件常量

集中在 `src/services/log/common/constants/log.ts`，按子系统切分 8 个 enum：`ClientLaunchLog` / `WorkBenchLog` / `BaseWindowLog` / `PanelLog` / `PageletLog` / `PortManagerLog` / `CrashLog` / `ChatNodeLog` / `AccountLog` / `FileSystemManagerLog`——**调用日志时必须使用枚举值，不允许传字面量**，是项目的硬性约定。

### 4.5 差距

1. **renderer → main 日志未桥接**：preload 的 `window.telegraph` 不暴露 LogService，renderer 自身的错误只能落在 DevTools；项目方需要在自己的 `initApplication` 里手动桥接 `LogServicePath`。
2. **dev 关闭文件输出**：`if (IS_DEV) fileTransport.level = false`，开发期崩溃无持久化日志。
3. **无敏感信息脱敏**：日志直接拼接对象 `JSON.stringify`，存在 token / cookie 泄露风险。
4. **bizName "share-process" 拼写**与目录名 "shared-process" 不一致，Sentry / 文件名以错误拼写为准。
5. **DataTracker URL/DSN 硬编码**：未走配置中心，环境切换不便。

---

## 5. 诊断快照 (Diagnostics Snapshot)

### 5.1 唯一实现：daemon 内的 `Diagnostics`

DI 绑定 `DaemonProcessModule.ts:37`，注册 `DiagnosticsServicePath`（`DaemonProcessNode.ts:43`）。核心循环（`Diagnostics.ts:121-125`）：

```ts
diagnosticRoutine() {
  setInterval(() => { this.tick() }, 5000)
}
```

`tick()`（lines 102-119）每次：

1. `getPerformanceInfo()`：daemon → main RPC 取 `app.getAppMetrics()`，重组并发 `pc_telegraph_stability_values` trace
2. `onPerformanceInfoEvent.fire(...)`
3. `getPidTree()`：调 `getUsageInfo(String(pid))`（`core/node/process/process-utils.ts`），exec `ps -ax -o pid=,ppid=,pcpu=,pmem=,command=`，喂给 `PidTree`（`core/node/process/PidTree.ts`）
4. `monitorBridgeClient.pushSnapshot(snapshot)`：daemon → main RPC 推到 `MonitorBridge`

### 5.2 main 端中转：`MonitorBridge`

`src/services/monitor/electron-main/MonitorBridge.ts`：

```ts
@injectable()
export class MonitorBridge implements IMonitorBridge {
  pushSnapshot: IMonitorBridge['pushSnapshot'] = async snapshot => {
    const monitor = this.windowManager.getMonitorWindow()
    monitor?.window?.webContents?.send(MONITOR_SNAPSHOT_CHANNEL, snapshot)
  }
  getMainPid:  IMonitorBridge['getMainPid'] = async () => process.pid
  toggleMonitorWindow = () => { this.windowManager.toggleMonitorWindow() }
}
```

将 snapshot 转发到 IPC 通道 `MONITOR_SNAPSHOT_CHANNEL = 'telegraph:monitor-snapshot'`（`monitor/common/config.ts:9`），由 Monitor `BrowserWindow`（`/monitor?TELEGRAPH_PAGELET_RENDERER_PROCESS_ID=monitor-window-app`，`WindowManager.ts:93-133`，默认 620×760）渲染。

### 5.3 Snapshot 数据结构

`monitor/common/types.ts:18-23`：

```ts
export interface MonitorSnapshot {
  timestamp: number
  totals:    { cpu: number; memory: number }
  processes: ProcessRow[]
  pidTree:   PidTreeJson | null
}
```

### 5.4 差距

1. **PidTree 平台局限**：`ps -ax` 仅 macOS / Linux 可用，**Windows 调用会报错**。
2. **快照不落盘**：仅在 IPC 通道里传送，关闭 Monitor 窗口后无任何持久化。
3. **5 秒周期硬编码**，无 sample-on-demand。
4. **Monitor 窗口需手动 toggle**：用户不主动开窗时，daemon 仍每 5 秒做一次完整采集 + RPC，这是无效计算。
5. **未导出 dump 命令**：缺少 "telegraph diagnostics dump > file" 之类的支持线下复现的能力。

---

## 6. 端口/连接健康 (Port Manager)

### 6.1 端口 ≠ TCP

整个 `apps/telegraph/src` 没有任何 `http.createServer` / `Server(` 调用——"port manager"操作的是 Electron 的 `MessagePortMain`，不是 TCP/WS。

### 6.2 三段健康度

- **握手**：`MessageChannelPair.sayHelloOptionsRequest`（`MessageChannelPair.ts:62-87`），双方任一发起 → 翻转 `peerEntry.isConnected = true`。
- **断连**：`AcquiredPortRequestEntry.toDispose / toReverse / toReconnect`（`port-manager/common/types.ts:16-35`）三种回调，`AcquirePortMain.acquirePageletRendererPort()`（`AcquirePortMain.ts:261-403`）按 `connectId` 路由。任意一端断 → 对端通过对称回调清理 → 必要时由 `resumeConnection` 重建。
- **重连**：`isConsumer` 标记区分发起方；`handleResumeConnection` 已实现但当前调用站点都被注释掉（`telegraph-application.ts:240-256` 的 `setupSharedProcessMain` / `setupDaemonProcessMain` 留有 `handleProcessDisposed` / `handleResumeConnection` 测试切换器）。

### 6.3 差距

1. **重连入口未启用**：上面的注释意味着工程上还没有真正打开端口断后自动重连。
2. **无端口耗尽指标**：`AcquirePortMain` 无对外 metric，无法回答"目前有多少活跃端口、最大并发是多少"。
3. **无握手超时**：`sayHelloOptionsRequest` 是 `await peer.client.sayHelloOptionsRequest(...)`，对端不应答会无限等。

---

## 7. 错误边界 (Error Boundaries) 全表

| 维度 | 位置 | 行为 | 评估 |
|---|---|---|---|
| `process.uncaughtException` (main) | `application/main.ts:12` | append `/tmp/telegraph-main.log` | 路径硬编码、Windows 失败 |
| `process.unhandledRejection` (main) | `application/main.ts:13` | append `/tmp/telegraph-main.log` | 同上 |
| `process.exit` (main) | `application/main.ts:14` | append exit code | 同上 |
| `app.render-process-gone` | `helper/crash.ts:12-17` | `logService.fatal(CrashLog.RenderProcessGone)` → Sentry | 无窗口重建 |
| `app.child-process-gone` | `helper/crash.ts:18-20` | `logService.fatal(CrashLog.ChildProcessGone)` | 无 utility-process 重启 |
| `crashReporter` | `helper/crash.ts:9-11` | 本地 dump | `uploadToServer: false` |
| `webContents.unresponsive` | `BaseWindow.ts:105-112` | `onWindowError(UNRESPONSIVE)` | 无主动 reload |
| `webContents.did-fail-load` | `BaseWindow.ts:114-125` | `onWindowError(CONTENT_FAIL_LOAD, …)` | 无错误页 |
| `webContents.render-process-gone` | `BaseWindow.ts:127-134` | `onWindowError(RENDER_PROCESS_GONE, details)` | 无重建 |
| `UtilityProcess.spawn` | `core/electron-main/utility-process/utilityProcess.ts:131-143` | `onSpawnEvent.fire(...)` + `info` 日志 | 仅监听 `'spawn'`、未监听 `'exit'` |
| `MainProcess.registerProcess` | `MainProcess.ts:57-63` | 子进程 `onExit` 时从 map 删除 | 无重启 |
| `Pagelet.loadURL` 失败 | `tabs/electron-main/Pagelet.ts:177-178` | `logService.error(PageletLog.LoadPageletPageFail)` | 无重试 |
| `Pagelet.startupPageletProcess` 失败 | `tabs/electron-main/Pagelet.ts:225-227` | `logService.error(PageletLog.PageletProcessError)` | 无重启 |
| `app.will-quit` | `telegraph-application.ts:236, 258-260` | `ClientLaunchLog.AppWillQuit` | 仅日志 |
| `app.window-all-closed` | `main.ts:43`, `telegraph-application.ts:262-264` | `app.quit()`（main.ts 仅 non-darwin；TelegraphApplication 无条件） | 行为差异需关注 |

---

## 7. 代码层可见的稳定性差距与改进项

按优先级整理（来自前述各章的"差距"小节）：

### P0（影响数据正确性）

1. **内存单位换算 bug**：`Diagnostics.ts:54` 把 bytes 当 KB 换算后又当 MB 上报，看板偏低 1024 倍。修复：`/ 1024 / 1024`。
2. **shared/daemon utility-process 缺顶层异常处理**：bootstrap 里加一组 `process.on('uncaughtException')` + `LogService.fatal`。

### P1（影响线上诊断能力）

3. **`crashReporter.uploadToServer = false`**：开启远端聚合或自实现上传到 Sentry/Crashpad 服务。
4. **renderer 日志未桥接到 main**：在 `preload/px.ts` 暴露受限的 `log.{trace,info,warn,error}`，桥到主进程 `LogService`。
5. **PidTree 仅 Unix 可用**：Windows 走 `wmic process get` / `tasklist` 或 `pidusage` 库。
6. **`/tmp/telegraph-main.log` 跨平台路径**：换成 `app.getPath('logs')` 或 `os.tmpdir()` + 路径拼接。

### P2（影响自愈和可运维）

7. **utility-process 崩溃自动重启**：`MainProcess.registerProcess` 的 `onExit` 路径接 `SharedProcessMain/DaemonProcessMain.handleProcessDisposed` + `handleResumeConnection`（代码已有，调用站点被注释）。
8. **心跳数据消费**：在主进程开 watchdog，`Date.now() - _updateTime > 30s` 时打日志/重启该子进程。
9. **端口断连重连开关**：去掉 `setupSharedProcessMain` 中被注释的 `handleResumeConnection` 测试切换器，做成默认行为。
10. **`AcquireProcessPortMain.ts:116/:139` 的 processName 硬编码 'shared-process'**：改为传入参数。

### P3（开发体验与扩展性）

11. **`--inspect=4255` 三类 utility-process 共用**：按角色偏移到 4256/4257/4258，避免冲突。
12. **`Diagnostics` 周期可配置 + Monitor 窗口未开启时降频或暂停**。
13. **`bizName: 'share-process'` 拼写更正**为 `shared-process`（影响 Sentry 看板分类）。
14. **renderer 仍用 `BrowserView`**（`Pagelet.createBrowserView()`，Electron 已废弃）：迁移到 `WebContentsView`。
15. **`Diagnostics` 过滤 `appMetric.name === 'Network Service'`** 是 locale 敏感判断，应用 `type === 'Service Worker'` 或 `name.includes('Network')` 的多语言安全形式。
16. **DataTracker / Sentry DSN 硬编码**：抽到 ENV / 配置中心。

---

## 8. 监控维度对照速查

| 维度 | 进程归属 | 周期 | 上报通道 | 持久化 | 是否消费 |
|---|---|---|---|---|---|
| 崩溃捕获（native） | main | 事件 | crashReporter local dump | 本地 dump | 仅本地 |
| 崩溃捕获（JS） | main | 事件 | Sentry | electron-log file + Sentry | Sentry 看板 |
| 窗口异常 | main | 事件 | Sentry / log | electron-log file | Sentry 看板 |
| App Metrics | daemon | 5s | DataTracker `pc_telegraph_stability_values` | electron-log + APM | APM 看板 |
| Stage 性能 | main / pagelet | 阶段触发 | DataTracker `pc_telegraph_performance` | electron-log + APM | APM 看板 |
| 心跳 | 每 utility | 10s | 主进程 `ProcessPingMain.ping` | 仅内存 | **未消费** |
| 诊断快照 | daemon → main | 5s | IPC `telegraph:monitor-snapshot` | **不落盘** | Monitor 窗口（按需开） |
| 端口断连 | port-manager | 事件 | log | electron-log | 已有重连代码（**未启用**） |

---

## 9. 小结

Telegraph 现阶段的可观测性建设可以概括为"**采得多，用得少**"：
- **采集面已经很广**：crashReporter / `app.getAppMetrics` / 心跳 / PidTree / 阶段埋点 / Sentry / APM 全部就位。
- **闭环消费偏弱**：心跳无消费者、监控快照不落盘、端口重连未启用、utility-process 崩溃无自动重启、native crash 不上送。

下一阶段的稳定性建设建议按 §7 的 P0→P3 顺序推进，**先把数据正确性和顶层异常兜底做完**，再把心跳/端口的"自愈闭环"打通，最后做开发体验和扩展性的优化。所有改造都可以在不改动 `common/` 接口的前提下完成（详见 [A-001 §7 开发规范](./20260504-di-and-cross-platform-paradigm.md#7-未来开发规范检查清单)），不会影响业务侧代码。
