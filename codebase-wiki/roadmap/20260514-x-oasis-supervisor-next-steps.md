# x-oasis Supervisor & 协议层 — 下一步路线图

> **Status**: 2026-05-14 起草，待执行
> **Owner**: 下一个接手的 AI / 工程师
> **前置阅读**: 本文档自包含；不需要先读其他文档即可开工
> **关联仓库**: `~/Documents/code/red/x-oasis`（主仓） + 本仓 example 入口

---

## 0. 30 秒上手

如果你（下一个 AI）刚接到任务，先做这三步：

1. 读完本文档 §1（已完成清单）和 §2（下一步选择），理解上下文
2. 跟用户确认要做哪一项（§2 已按 Recommended 排序）
3. 开始干活前，**必读对应小节的"动手前必看"**（§3 起每节都有）

> ⚠️ **不要重新探索整个代码库**。本文档已经把所有相关文件路径、行号、设计依据列全。

---

## 1. 已完成清单（截至 2026-05-14）

### 1.1 x-oasis 主仓 (`~/Documents/code/red/x-oasis`)

| Commit | 描述 | 涉及包 |
|--------|------|--------|
| `f679855` | G2: CircuitBreaker dead-code 清理 | async-call-rpc |
| `0e0460b` | G3: ConnectionStats.stateTransitions ring buffer | async-call-rpc |
| `43969fd` | D-004 §6: UtilityProcessSupervisor + manual restart + readiness probe + onStateChange + InspectorSnapshot | async-call-rpc-electron |
| `9146f33` | example: filter nullish pids before `ps` | example |
| `860d246` | example: pull supervisor snapshots via main-metrics（替换错误的 push 模型） | example |
| `f819527` | feat: add trace（含上述 G2/G3/Supervisor 的 changeset 汇总，patch bump） | async-call-rpc / async-call-rpc-electron |
| `ab44fdc` | [ci] release (#95) — 已发版 | async-call-rpc@0.13.2 / async-call-rpc-electron@0.11.2 / di@0.13.2 |

> 2026-05-14 后续：telegraph 主仓已经把所有 app + `packages/services` 的 `@x-oasis/async-call-rpc{,-electron,-web}` / `@x-oasis/di` 升级到 `^0.13.2` / `^0.11.2`，`pnpm -r typecheck` 全绿，无适配代价。

### 1.2 关键设计文档（已落地）

- **D-004** `~/Documents/code/red/x-oasis/codebase-wiki/discussion/20260514-utility-process-supervisor-rfc.md` — Supervisor 设计，§6 已 closed
- **D-005** `~/Documents/code/red/x-oasis/codebase-wiki/discussion/20260514-circuit-breaker-dead-code.md` — G2 决策
- **D-006** `~/Documents/code/modules/ai/telegraph/codebase-wiki/discussion/20260514-x-oasis-capability-gaps-v2.md` — Gap 1/2/3，G2/G3 已 closed，**Gap 1 待办**

### 1.3 已知 baseline（不要试图修，除非选了 §2.F）

- **async-call-rpc**: 6 个 pre-existing 测试失败
- **async-call-rpc-electron**: 9 个 IPCMainChannel.spec 失败
- **example multi-page-router-di typecheck baseline**（过滤这些 TS code 即视为干净）：
  - `TS1272` (decorator import type) × 多处
  - `TS7006` (implicit any in event handlers) × 多处
  - `TS5024` `tsconfig.json` `diagnostics` 选项
  - `TS2503` / `TS7016` (`react-dom/client` types)
  - `TS2352` `ServiceProxy` cast
  - `TS2339` `unsubscribe` / Setting indexer
  - `TS2420` `AppOrchestrator` 接口部分实现
  - `TS7053` Setting indexer
  - `TS2307: Cannot find module '@shared-ui/useOrchestratorDashboard'` (PageView.tsx:4)
- 验证脚本：
  ```bash
  cd ~/Documents/code/red/x-oasis/packages/async/async-call-rpc-electron/examples/orchestrator/multi-page-router-di
  pnpm exec tsc --noEmit 2>&1 | grep -v 'TS1272\|TS7006\|TS5024\|TS2503\|TS7016\|TS2352\|TS2339\|TS2420\|TS7053\|TS2307'
  ```
  输出应仅含 baseline 残留行（"Type 'AppOrchestrator' is missing..." 之类的 follow-up 行），**不应出现新文件路径**。

### 1.4 工作流约定（用户偏好，必须遵守）

- 输出语言：**中文**
- Commit：conventional commits + 多行 body 描述动机和验证
- x-oasis 主仓 **直推 main 分支**，不开 PR
- macOS case-insensitive 文件系统：跨仓 LSP casing 噪音可忽略
- lint-staged 会改文件——commit 后再编辑前要先 `read`
- 用 TodoWrite 维护进度
- 每次推进前先用 `question` 工具列选项让用户确认；选项 1 标 Recommended

---

## 2. 下一步候选（按价值排序）

> 用户已经看过这份清单，**不要重新罗列让用户挑**。直接问"要做哪一项"，并提示 §2.A 是 Recommended。

### A. ~~发 changesets release~~ ✅ 已完成（commit `f819527` + release `ab44fdc`，npm 已发 0.13.2/0.11.2/0.13.2；telegraph 已升级适配）

### B. D-006 Gap 1 — Forwarding Proxy

**为什么**：A-008 架构核心能力，pagelet 间直连 RPC（main 作为 hub 转发）。当前 pagelet 必须显式 connect daemon 中转。

**代价**：中等（1-2 天）。详细步骤见 §3.B。

### C. handleRequest 优先级契约文档化

**为什么**：本轮 commit `2d8648c` 的 bug 根因——`AbstractChannelProtocol` 同时持 `_service` 和 `_serviceHost`，但 `handleRequest` 中 host 优先且**无 fallback**（`packages/async/async-call-rpc/src/middlewares/handleRequest.ts:147-163`）。这个隐式契约必须写进 JSDoc，否则下个使用者必踩。

**代价**：小（1 小时）。详细步骤见 §3.C。

### D. Supervisor 健康度字段扩充

**为什么**：当前 `InspectorSnapshot` 只暴露 state/restartCount/lastError，无法诊断 zombie utility process（进程活着但 channel 不响应）。

补字段：`lastChannelReadyAt` / `lastReadinessProbeAt` / `consecutiveProbeFailures`

**代价**：小（半天）。详细步骤见 §3.D。

### E. Supervisor backoff jitter

**为什么**：当前 backoff 确定性，多 supervisor 同时崩会同步重启风暴。

**代价**：极小（几行）。详细步骤见 §3.E。

### F. 修 baseline failing tests

**为什么**：长期 release 心智负担。但**不紧急**，可延后。

**代价**：未知，需要先调查。

### G. Supervisor 集成测试

**为什么**：当前靠 example 手动验证。spawn → kill → restart → inspector 状态序列应自动化。

**代价**：中等（1 天）。

### I. SpawnInfo.pid 类型契约收紧（x-oasis 主仓）

**为什么**：当前 `SpawnInfo.pid: number`（`UtilityProcessSupervisor.ts:55-59`）但实际传的是
`Electron.UtilityProcess.pid`，后者是 `number | undefined`（Electron 类型声明）。下游
（telegraph `MainMetricsService` / x-oasis example `queryPsForPids`）必须重复做 nullish 兜底，
2026-05-14 已经在 example 修过一次（commit `9146f33a`），telegraph 主仓 5-14 又修一次。

**两个选项**：

- A. 收紧类型 + 在 supervisor 里只在 `child.pid != null` 才触发 `onSpawn`（pid 还没就绪就跳过本次回调），
     调用方拿到的 pid 100% 有效。下游全部去掉防御代码。
- B. 类型改成 `pid: number | null`，强制下游 narrow。语义更诚实但破坏性更大。

**推荐 A**：onSpawn 本来就语义"已成功 spawn"，pid 拿不到时本来就不该说"spawn 成功"。

**代价**：小（半天）。要更新：

- `SpawnInfo` / `ChannelReadyInfo` 两个类型
- `UtilityProcessSupervisor._spawn` 里 `child.pid` 的 guard
- example `queryPsForPids` 可以去掉 `validPids` 兜底（telegraph 同步去）
- changeset patch bump

---

### H. example 崩溃恢复演示按钮 + 历史曲线

**为什么**：演示更直观，但只对 demo 价值，不影响生产。

**代价**：中等（1 天）。

---

## 3. 各候选的"动手前必看"

### 3.A — changesets release

**前提**：本轮所有 commit 已 push 到 x-oasis main。

**步骤**：

1. 切到 x-oasis 仓 root：
   ```bash
   cd ~/Documents/code/red/x-oasis
   git pull --rebase origin main  # 拉一下，CI 可能已落 release commit
   ```
2. 检查现有 `.changeset/` 目录：
   ```bash
   ls .changeset/
   ```
   如果已有 changeset 文件覆盖本轮改动，跳到第 4 步。
3. 创建 changeset：
   ```bash
   pnpm changeset
   ```
   交互式选：
   - `@x-oasis/async-call-rpc` → **minor**（G3 stateTransitions 是新增 API）
   - `@x-oasis/async-call-rpc-electron` → **minor**（UtilityProcessSupervisor 是新增 API）
   - 其他包视情况（如果只跟随升级，选 patch）
   - Summary（粘贴下面两段）：

   **async-call-rpc minor changelog**：
   ```
   feat: ConnectionStats.stateTransitions ring buffer for connection state observability
   - Records last N (default 32) state transitions on each ConnectionStats instance
   - Surfaces via existing getStats()/getAllStats() return type as new field
   - Closes G3 capability gap (telegraph D-006)
   ```

   **async-call-rpc-electron minor changelog**：
   ```
   feat: UtilityProcessSupervisor for utility process lifecycle management
   - Crash detection + automatic restart with backoff
   - Manual restart() API
   - Readiness probe via configurable readinessCheck callback
   - onStateChange callback for state transition observability
   - getInspectorSnapshot() returns { state, restartCount, lastError, ... }
   - onSpawn callback exposes { pid, isRestart } for pid registry maintenance
   - Closes D-004 §6 supervisor RFC
   ```

4. Commit + push changeset：
   ```bash
   git add .changeset && git commit -m "chore: add changeset for supervisor + stateTransitions release"
   git push origin main
   ```
5. 等 CI（GitHub Actions changesets 机器人）自动开 release PR 并 merge——这步**不要**手动 merge，等机器人。
6. 验证：`pnpm view @x-oasis/async-call-rpc-electron version` 应该看到新 minor。

**注意**：CI 失败时（lint/test）需要修了再 push；不要 force push main。

---

### 3.B — D-006 Gap 1 Forwarding Proxy ✅ DONE (2026-05-14)

**Discovery**：本节最初描述「pagelet A 调 proxy.connect('B') 会报错或 hang」是**过时的**。
深入读 `BaseConnectionOrchestrator.connect()` (async-call-rpc/src/orchestrator/
BaseConnectionOrchestrator.ts:441-559) 和 `ParticipantOrchestratorProxy.requestConnect()`
(async-call-rpc-electron/src/electron-main/ParticipantOrchestratorProxy.ts) 后发现：

- `connect(fromId, toId)` 不限定 fromId 必须是 main，任何两个已注册 participant 都可
- ParticipantOrchestratorProxy.connect() 通过 `requestConnect(selfId, toId)` 委托给 main hub
- main 用 `MessageChannelMain` 创建 entangled port pair，分别 ship 给 A 和 B
- A↔B 直连后走自己的 channel，main 不在 RPC 转发路径上

**结论**：能力自 v0.10+ 就完整存在，本节实质工作是「补 demo + 补 spec + 文档化」，
**不需要写 ForwardingMiddleware**（本节最初的设想是误读）。

**已交付**（x-oasis main 上 2 个 commit）：

- `c13a88f3 test(orchestrator): cover P↔P direct connection in spec suite`
  - `ElectronConnectionOrchestrator.spec.ts` 新增 2 个用例（P↔P + 幂等）
  - `ParticipantOrchestratorProxy.spec.ts` 新文件 8 个用例（connect/disconnect/
    listParticipants/listConnections/selfId 传递/onConnection 回调）
  - 共 37 tests 全绿
- `9cc6789b feat(example): demonstrate pagelet ↔ pagelet direct RPC`
  - `PageletWorker` 基类加 `connectToPeer<T>()` + `onPeerConnection()` 扩展点 + peerClients 缓存
  - `setting` pagelet 暴露 `ISettingPageletPeerService`（peerInfo(fromId) → string）
  - `connection` pagelet handler `callSettingPeerInfo()` 触发 P↔P RPC，可在 inspector 看到 ConnectionStats

**红线兑现**：

- ✅ 没在转发路径加 `serviceHost.setServiceHost`——P↔P 是 entangled port，根本没有「转发路径」
- ✅ 控制平面（main 撮合）和业务平面（A↔B 直连）正交

---

### 3.C — handleRequest 优先级契约文档化 ✅ DONE (2026-05-14)

**已交付**（x-oasis main commit `0e8c010b`）：

- `RPCService.setChannel`：加 JSDoc 警告「与 setServiceHost 互斥，会被 silently override」
- `AbstractChannelProtocol.setService`：加完整 caveat（含 ParticipantOrchestratorProxy trap）
- `AbstractChannelProtocol.setServiceHost`：扩充已有 JSDoc，加入 asymmetric-priority 段 + 2d8648c 历史引用
- `handleRequest.ts`：内联注释升级为「routing priority contract」块，作为上游 JSDoc 的 anchor

无行为改动，纯文档；包级 typecheck/test 与基线一致（async-call-rpc transferable-args 1 个失败、async-call-rpc-electron 9 个失败均为 §3.F/§3.G 已记录的基线问题）。

---

### 3.C （原内容存档）— handleRequest 优先级契约文档化

**目标**：在 `RPCService.setChannel()` 和 `AbstractChannelProtocol.setService/setServiceHost` 的 JSDoc 加警告。

**关键文件 + 行号**：

- `~/Documents/code/red/x-oasis/packages/async/async-call-rpc/src/endpoint/RPCService.ts:22-26` — `setChannel` 内部调 `channel.setService(this)`
- `~/Documents/code/red/x-oasis/packages/async/async-call-rpc/src/protocol/AbstractChannelProtocol.ts:276-301` — `setService` / `setServiceHost` 实现
- `~/Documents/code/red/x-oasis/packages/async/async-call-rpc/src/middlewares/handleRequest.ts:140-163` — 路由优先级（host 优先，无 fallback）

**要写的 JSDoc 内容**（建议放 `setServiceHost` 上）：

```typescript
/**
 * Bind a serviceHost to this channel. Once set, the channel routes ALL
 * incoming RPC requests through `serviceHost.getHandler(servicePath)` and
 * NEVER falls back to the channel-bound `service` (set via setService /
 * RPCService.setChannel). This is asymmetric and intentional: a host is
 * the multi-service registry, a service is single-service convenience.
 *
 * ⚠️ Caveat: if you call setServiceHost on a channel that already has a
 * channel-bound service (e.g. one set by RPCService.setChannel), the
 * service becomes unreachable. Concretely, ParticipantOrchestratorProxy
 * binds RPCService(ORCHESTRATOR_SERVICE_PATH) to controlChannel via
 * service.setChannel(), so calling controlChannel.setServiceHost(...)
 * later silently breaks orchestrator handshakes. Bind serviceHost on a
 * separate channel (e.g. utility-process IPC channel) instead.
 *
 * See: handleRequest.ts:147-163 for the priority logic.
 */
setServiceHost(host: RPCServiceHost): void { ... }
```

**步骤**：

1. read 三个文件确认当前 JSDoc
2. edit 加注释（不改逻辑）
3. lint + typecheck
4. commit message：`docs(async-call-rpc): document setServiceHost vs setService priority caveat`
5. push x-oasis main

---

### 3.D — Supervisor 健康度字段扩充

**关键文件**：

- `~/Documents/code/red/x-oasis/packages/async/async-call-rpc-electron/src/electron-main/UtilityProcessSupervisor.ts` — 主实现
- 找 `getInspectorSnapshot()` 方法 + `InspectorSnapshot` type 定义

**新增字段语义**：

| 字段 | 类型 | 何时更新 |
|------|------|----------|
| `lastChannelReadyAt` | `number \| null` | `onChannelReady` 触发时 = `Date.now()` |
| `lastReadinessProbeAt` | `number \| null` | 每次 readiness probe 完成时 |
| `consecutiveProbeFailures` | `number` | probe 失败 +1，成功归 0 |

**测试**：扩 supervisor.spec.ts 验证字段单调更新。

**example 同步**：`apps/monitor/.../SupervisorsPanel.tsx` 加这三列展示。

---

### 3.E — Supervisor backoff jitter

**关键文件**：`UtilityProcessSupervisor.ts` 找 `_scheduleRestart` 或类似 backoff 计算位置。

**改动**：

```typescript
const baseDelay = Math.min(this.maxBackoffMs, this.baseBackoffMs * 2 ** this.restartCount);
const jitter = Math.random() * baseDelay * 0.3;  // ±30% jitter
const delay = baseDelay + jitter;
```

**测试**：spec 里只断言 delay 在 `[base, base*1.3]` 区间，不要断言精确值。

---

### 3.F — 修 baseline failing tests

**先调查**：

```bash
cd ~/Documents/code/red/x-oasis/packages/async/async-call-rpc
pnpm test 2>&1 | grep -E 'FAIL|✕' | head -20
cd ../async-call-rpc-electron
pnpm test 2>&1 | grep -E 'FAIL|✕' | head -20
```

按失败用例分类，每类一个 commit。**不要**一锅端。

---

### 3.G — Supervisor 集成测试

**思路**：用 vitest + 真实 spawn 一个 minimal utility-process entry script（fixture），断言：

- 第一次 spawn 后 state = `running`，restartCount = 0
- 强 kill 后等待，state 经过 `restarting` → `running`，restartCount = 1
- inspector snapshot 序列符合预期

**fixture 位置**：`packages/async/async-call-rpc-electron/test/fixtures/crashing-utility.ts`

---

### 3.H — example 崩溃恢复 UI

**位置**：`examples/orchestrator/multi-page-router-di/src/apps/monitor/application/browser/components/SupervisorsPanel.tsx`

**加按钮**：

- "Force Kill"（调一个 main 暴露的新 RPC `forceKillSupervisor(participantId)`，main 侧调 `supervisor.kill('user-triggered')`）
- "Manual Restart"（已有 API，UI 接一下）

**历史曲线**：用 recharts 画 stateTransitions 时间轴。

---

## 4. 关键文件路径速查

### x-oasis 主仓核心

```
~/Documents/code/red/x-oasis/
├── packages/async/
│   ├── async-call-rpc/src/
│   │   ├── endpoint/RPCService.ts                     # setChannel 入口
│   │   ├── protocol/AbstractChannelProtocol.ts        # setService / setServiceHost
│   │   ├── middlewares/handleRequest.ts:147-163       # 路由优先级（host 优先无 fallback）
│   │   └── stats/ConnectionStats.ts                   # G3 stateTransitions
│   └── async-call-rpc-electron/src/
│       ├── electron-main/
│       │   ├── ParticipantOrchestratorProxy.ts        # _setupOrchestratorHandler 占 controlChannel._service
│       │   └── UtilityProcessSupervisor.ts            # D-004 §6 supervisor
│       └── channels/ElectronUtilityProcessChannel.ts
└── packages/async/async-call-rpc-electron/examples/orchestrator/multi-page-router-di/
    └── src/
        ├── apps/
        │   ├── main/application/electron-main/AppApplication.ts        # MAIN_METRICS_SERVICE_PATH 注册
        │   ├── daemon/
        │   │   ├── application/
        │   │   │   ├── common/index.ts                                  # IDaemonService（已无 setSupervisorSnapshots）
        │   │   │   ├── electron-main/DaemonProcess.ts                   # supervisor + onChannelReady setServiceHost
        │   │   │   └── node/DaemonWorker.ts                             # daemon utility entry
        │   │   └── diagnostics/node/Diagnostics.ts                      # collectSnapshot pull 模型
        │   ├── monitor/application/browser/components/
        │   │   ├── MonitorPanel.tsx                                     # tabs
        │   │   └── SupervisorsPanel.tsx                                 # G3 + supervisor inspector UI
        │   ├── connection/application/browser/PageView.tsx              # StateTransitionsCard
        │   └── shared/application/electron-main/SharedProcess.ts        # supervisor + inspector
        └── services/
            ├── main-metrics/common/index.ts                             # IMainMetricsService.getSupervisorSnapshots
            └── pagelet-host/electron-main/
                ├── PageletProcess.ts                                    # supervisor + inspector
                └── AppOrchestrator.ts                                   # stateTransitions 序列化
```

### telegraph 仓相关文档

```
~/Documents/code/modules/ai/telegraph/
├── codebase-wiki/
│   ├── architecture/20260509-telegraph-final-process-architecture.md   # A-008（Forwarding Proxy 设计源头）
│   ├── discussion/
│   │   ├── 20260508-x-oasis-orchestrator-capability-gaps.md            # D-006 v1
│   │   └── 20260514-x-oasis-capability-gaps-v2.md                      # D-006 v2（G2/G3 closed，Gap 1 待办）
│   └── roadmap/
│       └── 20260514-x-oasis-supervisor-next-steps.md                   # 本文档
└── AGENTS.md                                                            # 仓库总入口（含两个 Guard 链接）
```

---

## 5. 决策上下文摘要（理解 why，不只是 what）

### 5.1 为什么 supervisor 在 x-oasis 而不是 telegraph

D-004 §1：supervisor 是 utility-process lifecycle 通用能力，不绑定 telegraph 业务，下沉到 async-call-rpc-electron 让所有 Electron 用户复用。

### 5.2 为什么 stateTransitions 在 ConnectionStats 而不是 ParticipantOrchestratorProxy

D-006 G3：transitions 是 connection 维度的属性（每个 A--B 连接独立），统计在 ConnectionStats 内聚最合理。

### 5.3 为什么 supervisor snapshot 用 pull 不用 push

本轮 commit `860d246` 的 message 已记录：push 模型把 mainServiceHost 绑到 daemon 的 controlChannel，触发 handleRequest 优先级 bug，吞掉 ORCHESTRATOR 路由。pull 模型让 daemon 走它已有的 mainMetricsClient（一条独立 channel），完全不碰 control 层。

### 5.4 为什么 example 是 "router-di" 风格

用 `@x-oasis/di` 让 supervisor / process / application 可注入，方便测试 + 模拟。AGENTS.md "Multi-Page (DI)" 一节说明。

---

## 6. 干完任何一项后

1. 更新本文档对应 §1.1 表格加 commit 行
2. 如果改的是设计契约（如 §3.C），同步更新对应 D-XXX 文档
3. 如果引入了新 baseline，更新 §1.3
4. commit + push
