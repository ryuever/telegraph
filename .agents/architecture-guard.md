# Architecture Guard — AI 执行任务前的强制检查清单

> **本文档是 AI agent 在 telegraph 仓库执行任何任务前的必经哨兵。**
> 它的唯一目的：在你动手写代码 / 重构 / 设计模块**之前**，
> 强制你判断是否需要打开 [A-008 最终进程架构](../codebase-wiki/architecture/20260509-telegraph-final-process-architecture.md)，
> 并按其中的不变量约束你的方案。
>
> 不读 A-008 而触碰下文 §1 的红线领域 = **方案必然返工**。

---

## 1. 触发条件 — 出现以下任一情况，必须先读 A-008

| # | 触发场景 | 必读章节 |
|---|----------|----------|
| T1 | 新增 / 修改任何 IPC、RPC、MessagePort、UtilityProcess、BrowserWindow、BrowserView 相关代码 | A-008 §4（通信层）+ §5（重连） |
| T2 | 新增一个 utility process（pagelet 或基础设施进程） | A-008 §3（进程职责）+ §7（代码组织） |
| T3 | 在 main / shared / daemon / pagelet 任一进程内**新增/移动一个 service** | A-008 §3 对应小节（确认服务归属哪个进程） |
| T4 | 涉及 spawn / kill / restart 任何 process | A-008 §3.1 + §5.1（治理流） |
| T5 | 涉及 renderer 与后端的连接（建联、重连、断开） | A-008 §3.5 + §4.2（Forwarding Proxy） |
| T6 | 涉及 ConnectionOrchestrator / participant / channel 概念 | A-008 §1（不变量）+ §4 + §5.6 |
| T7 | 调整 apps/* 目录结构、tsconfig paths、vite alias | A-008 §7（代码组织） |
| T8 | 设计「跨 pagelet 共享」的功能 | A-008 §3.4 禁止条款 + §3.2 Shared 职责 |
| T9 | 引入新的 Agent runtime / Extension 机制 | A-008 §8 + 联读 [A-005](../codebase-wiki/architecture/20260505-telegraph-agent-runtime-extension-host-theory.md) |
| T10 | 用户的需求中出现"我想让 X 进程直接调用 Y 进程"、"renderer 直接拿 shared 的服务" 等绕开拓扑的描述 | 整篇 §1-§5（这是常见的反模式陷阱） |

**安全场景**（无需读 A-008，可直接动手）：

- 修 UI 样式 / Tailwind class
- 修 README / 文档 typo
- 修 lint / format 错误
- 在已有 service 内部加一个**纯计算**方法（不涉及 IPC、不跨进程）
- 修 test 用例的断言

---

## 2. 红线 — 绝对禁止的代码模式（不需要读完 A-008 也必须遵守）

### 2.1 IPC / RPC 红线（A-008 §4.3）

```typescript
// ❌ 全仓库禁止出现以下裸 API 调用（仅 x-oasis 内部除外）
ipcMain.handle(...)
ipcMain.on(...)
ipcRenderer.invoke(...)
ipcRenderer.send(...)
ipcRenderer.on(...)
webContents.postMessage(...)
webContents.send(...)
utilityProcess.postMessage(...)
parentPort.postMessage(...)        // 业务代码禁用，仅 PageletBootstrap 用一次

// ✅ 必须用 ConnectionOrchestrator + RPC
const channel = orchestrator.getChannel(peerId)
registerRPCService({ channel, servicePath, service })
const client = createRPCClient<IFoo>({ channel, servicePath })
```

**碰到现有代码用了这些**：不要"顺便修"，先问用户是否纳入本次 PR 范围；
否则属于隐藏的架构改造，会污染 commit 边界。

### 2.2 进程职责红线（A-008 §3）

| 红线 | 触发动作 |
|------|----------|
| Daemon 内出现 `utilityProcess.kill()` 或任何 process handle 操作 | 立即停手，违反 capability boundary。Daemon 只能 RPC 调用 `main.processSupervisor.killParticipant()` |
| Main 内出现业务状态（聊天历史、登录态、设置等） | 应该放 Shared，不是 Main |
| Main 内 `import` 了任何 agent runtime（Pi / LangGraph / AI SDK 等） | runtime 只在 Pagelet 内；Main 不感知 |
| Pagelet A 直接 `connect(myId, 'pagelet:B:1')` | 禁止 P2P。先走 Shared 中转，性能不够再开 issue 讨论 |
| Renderer 同时持有 ≥ 2 条到后端 utility 的 channel | 违反 I1。Renderer 只与一个 Pagelet 直连，其他能力走 Forwarding Proxy |
| 把 main 注册为 ConnectionOrchestrator 的 participant | Main 是 orchestrator 宿主，不是 participant。Main 的能力通过 `MainServiceHost` 暴露 |

### 2.3 命名 / 拓扑红线

- **participantId** 必须按 A-008 §2 的格式：`shared` / `daemon` / `pagelet:<app>:<n>` / `renderer:<windowKey>`
- **servicePath** 必须以 `/services/` 开头；转发服务用约定路径（`/services/shared`、`/services/daemon`、`/services/main`），业务服务用 app 名称（`/services/chat`、`/services/design`）
- 跨 app 的 import **仅允许 type-only**：`import type { ... } from '@chat/services/...'`

---

## 3. 决策树 — 怎么判断你的任务该读 A-008 哪节

```
你接到的任务是？
│
├── 修 UI / 文案 / 样式
│   └── 直接动手，无需读 A-008
│
├── 改 IPC / 进程间通信
│   ├── 是不是裸 ipcMain/ipcRenderer/webContents.postMessage？
│   │   ├── 是 → 红线 §2.1，必须改成 ConnectionOrchestrator + RPC，先读 A-008 §4
│   │   └── 否，已经在 RPC 框架内
│   │       ├── 加新 service？→ 读 §3 对应进程小节确认归属
│   │       ├── 改 channel 建联流程？→ 读 §4.1 + §5
│   │       └── 改 servicePath？→ 读 §4.2 + §2.3 命名约定
│   │
├── 加新 utility process
│   └── 必读 A-008 §3 + §7；同时确认是不是真的需要新进程
│      （加新能力 ≠ 加新进程；先考虑放进 Shared 或新 Pagelet）
│
├── 改 daemon 监控逻辑
│   └── 必读 §3.3。Daemon 决策、Main 执行；任何想让 daemon 直接动手的方案都是红线
│
├── 改进程崩溃恢复 / resume / 重连
│   └── 必读 §5（全章）+ §5.6（依赖的 x-oasis 能力）
│
├── 加 / 改 Pagelet（chat / design / monitor 内部）
│   ├── 改 UI / domain service 内部？→ 不需要读 A-008
│   ├── 改 ForwardingProxy / orchestrator 接入？→ 读 §3.4 + §4.2 + 附录 A.2
│   └── 改 spawn 时机 / 生命周期？→ 读 §3.4 生命周期段
│
├── 设计跨 pagelet 协作
│   └── 必读 §3.4 禁止条款；默认走 Shared 中转
│
└── 引入新 Agent runtime 或扩展机制
    └── A-008 §8 + A-005 全文
```

---

## 4. 输出前自检清单（提交方案前对照）

在你给出代码方案、写完代码、或开 PR 前，自答以下问题：

- [ ] 我的改动是否触发了 §1 的任意一条触发条件？如是，我**真的**读了对应的 A-008 章节？
- [ ] 我是否引入了 §2.1 的任何红线 API？
- [ ] 我修改的 service 是否归属于正确的进程（§3）？
- [ ] 如果我新增了进程间通信，对端是否有崩溃重连预案（§5）？
- [ ] 我的 participantId / servicePath 命名是否符合 §2.3 约定？
- [ ] 我是否有"为了图方便"在跨进程边界做了 value import？

任意一项答 "不确定" → **重新打开 A-008 对应章节**，不要靠记忆。

---

## 5. 与用户沟通的标准话术

### 5.1 用户提出可能违反不变量的需求时

不要直接接需求实现。先**回放架构含义**，给用户两个选项：

**示例 A**：用户说「让 renderer 直接调用 shared 的 LoginService」

> 你这个需求触及 A-008 §I1（Renderer 永远只与一个 Pagelet 直连）。
> 推荐做法：在当前 pagelet 里通过 `/services/shared` ForwardingProxy 暴露 LoginService 给 renderer，
> 业务代码体感等同于直连，但不会破坏单 channel 故障域。
>
> 如果你确实需要 renderer 与 shared 直连（比如登录页还没有 pagelet），
> 这是一个架构例外，需要先在 codebase-wiki 立个 discussion 讨论清楚利弊。
>
> 你倾向哪种？

**示例 B**：用户说「daemon 检测到 chat 内存超了就直接 kill 它」

> A-008 §3.3 明确：Daemon 是策略决策者，不持有 process handle。
> 正确链路：Daemon `KillPolicy` 决策 → RPC 调用 `main.processSupervisor.killParticipant({...})` → Main 校验后执行。
> 我按这个链路实现可以吗？

### 5.2 用户要求"快速绕过"时

如果用户说"先简单实现，后面再迁移"，**必须明确 trade-off**：

> 短路实现可以做，但会引入两笔技术债：
> 1. 留在仓库里的裸 IPC 调用会成为新人模仿的反例
> 2. A-008 §1 的不变量被破坏后，故障注入用例（§9.2）无法通过
>
> 我建议要么按 A-008 实现，要么显式开一个 issue 标记「临时方案，须在 X 时间前迁移」。
> 你想走哪条？

---

## 6. 文档地图

| 文档 | 作用 | 何时读 |
|------|------|--------|
| **本文档** (`architecture-guard.md`) | 决策树 + 红线清单 | 每次任务开始前扫一眼 §1 触发条件 |
| [`AGENTS.md`](../AGENTS.md) | 仓库基础信息 + 触发条件摘要 | 每次对话自动加载 |
| [`A-008`](../codebase-wiki/architecture/20260509-telegraph-final-process-architecture.md) | 最终架构权威定义 | §1 触发条件命中时按章节读 |
| [`A-005`](../codebase-wiki/architecture/20260505-telegraph-agent-runtime-extension-host-theory.md) | Runtime / Extension Host 理论 | T9 触发或处理 agent runtime / extension 时 |
| [`D-005`](../codebase-wiki/discussion/20260508-renderer-pagelet-channel-convergence.md) | Forwarding Proxy 决策推导 | 想理解"为什么 renderer 只连 pagelet"时 |
| [`D-006`](../codebase-wiki/discussion/20260508-x-oasis-orchestrator-capability-gaps.md) | x-oasis 能力缺口 | 实现重连 / `replaceParticipantChannel` 遇到问题时 |
| [`P-003`](../codebase-wiki/roadmap/20260508-port-management-orchestrator-migration-plan.md) | Orchestrator 迁移分阶段路线 | 不确定当前 phase 该做什么时 |
| [`A-007`](../codebase-wiki/architecture/20260506-pagelet-process-communication.md) | **历史**架构（已被 A-008 替代） | **默认不读**；只在排查"为什么旧代码这么写"时参考 |

---

## 7. 维护本文档

本文档与 A-008 同步演进：

- A-008 §1 不变量调整 → 本文档 §1 / §2 同步更新
- A-008 新增章节 → 本文档 §1 触发条件表新增映射
- A-008 章节重命名 → 全局搜索"A-008 §X"并更新

**任何对本文档的修改都属于"架构变更"，必须在 codebase-wiki 留痕**（discussion 或 architecture 文档），不能只改本文。
