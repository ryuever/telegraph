# Agent Runtime Design Principles — 设计 / 讨论 agent 子系统前先读

> 本文档是 [A-005](../codebase-wiki/architecture/20260505-telegraph-agent-runtime-extension-host-theory.md)（1500+ 行理论）的**战略浓缩版**，
> 用于在你**讨论方案、做设计选型、评审 PR**时给出 5–8 条"不可跨越的设计直觉"。
>
> 不是红线（红线见 [`agent-runtime-guard.md`](./agent-runtime-guard.md)），是**判断方向是否走偏**的标尺。
>
> 触发场景：用户提"做个新 runtime / 接入新 framework / 改 trace 形态 / 设计 extension 系统 / 加 workflow DSL"等**设计性**问题时。

---

## 核心定位（一句话）

> **Telegraph 是一个框架无关、可扩展、可观测、可安装能力的本地 agent host —— 不是任何单一 agent framework（包括 Pi）的 UI 包装。**

如果某个方案让 Telegraph 的核心代码"必须知道 Pi 的 JSON 格式"或"必须按 LangGraph 的 graph 思维走"，方案错了。

---

## 原则 1：先抽象"运行事实"，后抽象"编排表达"

**做什么**：第一阶段统一 `RuntimeEvent`（model_request / model_event / tool_call / tool_result / step_started / edge_taken / run_completed），让所有 framework 都向它映射。

**不做什么**：不要先定义 Telegraph 自己的 graph / node / edge / DSL。

**为什么**：

- 不同 framework 的编排范式差异巨大：LangGraph 是 graph、AI SDK 是 chain、Mastra 是 workflow step、Pi 是 extension+subagent。强行统一编排 = adapter 变成"语义损失转换器"。
- 但**运行时事实**（模型被调了、工具被调了、step 开始/结束、流被取消）是可统一的，因为这是物理事件。

**判定信号**：

- ✅ 新方案先扩展 RuntimeEvent → 大概率方向对
- ❌ 新方案先定义 `interface Workflow { nodes; edges }` → 方向错；让用户先回答"为什么不能用 RuntimeEvent 表达？"

**详见**：A-005 §3.1 + §6.1 + §6.2。

---

## 原则 2：核心类型不绑定任何 framework

**做什么**：

```typescript
// ✅ framework 差异封进 raw + origin
type RuntimeEvent = { type: 'model_event', requestId, raw, origin: { framework: 'pi' | ... }, ts }
```

**不做什么**：

```typescript
// ❌ 把 framework 类型抬到 union 顶层
type TelegraphEvent = PiJsonLine | LangGraphNodeEvent | AiSdkStreamPart
```

**为什么**：核心类型一旦绑定，"接入新 framework" = "扩展核心类型" = 全仓库 import 链断裂。Telegraph 的承诺是"今天 Pi、明天 LangGraph、后天自研"，这条承诺通过 adapter 层兑现，不是通过给核心类型加 case。

**判定信号**：

- ✅ Pi / LangGraph 的内部概念只出现在 `packages/agent-runtime/src/<framework>/` 下 → 对
- ❌ Pi 的概念名（`PiContext`、`PiSubagent`、`PiToolCall`）出现在 contracts / UI / extension registry 里 → 错

**详见**：A-005 §1.2 + §11.1。

---

## 原则 3：Pi 是第一生态，不是架构天花板

**做什么**：

- 短期保留 `PiCliRuntime` 吃 Pi CLI 已有 extension loader 的红利
- 中期建设 `PiEmbeddedRuntime`（不 spawn CLI，直接用 `pi-ai` SDK + 自己实现 tool loop）
- 长期接入 LangGraph / AI SDK / Mastra / OpenAI Agents SDK / MCP

**不做什么**：

- 不要让 ChatPanel / TracePanel / ExtensionRegistry **任何**地方写 `if (backend === 'pi-cli')`
- 不要把 `~/.pi` 目录结构当成 Telegraph extension 安装的标准
- 不要在长期主线上依赖 `spawn pi`——它生命周期复杂、stdout JSON 是旁路协议、安全/权限粒度粗

**为什么**：Pi 是**当下最快的产品验证路径**，但它的扩展机制、CLI 行为、目录约定都是 Pi 团队的工程权衡，未必符合 Telegraph 的长期定位。把它沉淀进核心 = 锁死。

**判定信号**：

- ✅ "我加一个 PiXxxRuntime / PiXxxAdapter" → 方向对
- ❌ "我把 Pi 的 X 概念升级成 Telegraph 通用 Y" → 危险信号，先讨论是否真的通用

**详见**：A-005 §1.2 + §5 + §11.5。

---

## 原则 4：Trace 是协议的一等投影，不是 console.log

**做什么**：右侧 LLM Trace 必须能展示：

1. 真实发给模型的 `Context` / request body（不是 UI 自己拼的版本）
2. 模型流式返回的 raw event（不是 SDK 抽象后的简化版）
3. tool call 的 input
4. tool result 的 output（同时含 machine-readable + UI display）
5. tool result 追加后**下一次** model request 的完整 context（验证 multi-turn 上下文一致性）
6. workflow step / routing edge / parallel child run / evaluator feedback

**不做什么**：

- 不要让 trace 只显示"AI: <text>"——这等于没 trace
- 不要让 trace 通道阻塞业务 RPC（I-002 的死锁根因）
- 不要让 framework 把 prompt / response 藏在 SDK 内部不暴露——选 framework 时这是否决项

**为什么**：

- agent 出 bug 时 99% 是"模型实际收到的上下文 ≠ 你以为它收到的"。没有真实 raw context 展示，调试 = 猜。
- Trace 也是"这个 framework 是否值得长期接入"的评估窗口——黑盒 framework 直接淘汰。

**判定信号**：

- ✅ 新 runtime adapter 主动暴露 model_request 的完整 raw payload → 对
- ❌ 新 runtime adapter "为了简洁"只 emit assistant_delta，不 emit model_request/model_event → 错，反对

**详见**：A-005 §4.3 + §8.2 + §8.3。

---

## 原则 5：Extension 注册能力，不直接控制宿主

**做什么**：Extension 通过 `ExtensionContext` 注册 `tools / commands / hooks / panels / runtimes`：

```typescript
export interface TelegraphExtension {
  manifest: ExtensionManifest
  activate(ctx: ExtensionContext): Promise<void>  // 只能通过 ctx 暴露能力
}
```

**不做什么**：

- Extension 不能直接 `import { chatStore } from '@telegraph/...'` 然后改全局状态
- Extension 不能直接挂 UI 组件到 ChatPanel 任意位置
- Extension 不能跳过 ToolRegistry 直接给模型加工具

**为什么**：

- 安全：本地 agent extension 可能执行 shell / 读写文件 / 联网。能力必须经过 manifest 声明 + 用户授权 + ToolRegistry 审计。
- 可演进：Telegraph UI / 状态管理换实现时，extension 不应该一起崩。`ExtensionContext` 是稳定边界。
- 可观测：所有 extension 行为通过 hooks / tools 流入 RuntimeEvent → 进入 trace → 可调试。

**判定信号**：

- ✅ Extension 通过 `ctx.tools.register(toolDef)` 加能力 → 对
- ❌ Extension 在 `activate` 里写 `window.telegraph.foo = ...` 或直接 patch 内部 service → 红线

**详见**：A-005 §4.5 + §4.6 + §7 + §12.7。

---

## 原则 6：Run 是第一概念，一切围绕它生命周期化

**做什么**：把每次 agent 执行抽象成 `Run`——可观测、可取消、可持久化、可恢复。

```typescript
export interface AgentRuntime {
  run(input: RunInput): AsyncIterable<RuntimeEvent>
}
```

所有 UI 状态、trace、session 持久化、extension 启用、hook 触发、错误归类、permission 检查都围绕 `runId` 组织。

**为什么**：

- ChatPanel 不需要知道底层 framework，只消费 RuntimeEvent stream
- TracePanel 按 runId 分组就是天然 timeline
- 后台任务、重试、并发控制、recovery 都有统一实体
- 取消 = `signal.abort()`；不需要给每个 framework 各发明一套取消机制

**判定信号**：

- ✅ 新设计把交互建模为 "start a run / stream events / complete or cancel" → 对
- ❌ 新设计走 fire-and-forget callback / 不可取消的 Promise / 没有 runId 关联 → 错

**详见**：A-005 §4.1。

---

## 原则 7：Permission 与 Trace 从第一天就占位

即使第一版实现简单，协议字段必须保留：

| 字段 | 为什么 first-day 就要 |
|------|----------------------|
| `permissions: PermissionRequest[]` (manifest) | 后补 = 全部 extension 要重新声明 |
| `raw: unknown` (RuntimeEvent) | 后补 = trace 永远缺历史数据 |
| `origin: RuntimeOrigin` (RuntimeEvent) | 后补 = 不知道是哪个 framework 出的事 |
| `runId / sessionId / ts` (所有事件) | 后补 = trace 无法关联 |
| `schemaVersion` (RuntimeEvent envelope) | 后补 = 跨版本兼容无法兜底 |

**判定信号**：

- ✅ 提议加新事件类型时，6 个字段都齐 → 对
- ❌ "先简单，字段以后再加" → 拒绝；要么齐，要么不加

**详见**：A-005 §11.4 + §4.2.1 + §12.6。

---

## 原则 8：演进顺序 contracts → adapter → trace → registry → marketplace

**做什么**：按依赖顺序推进：

```
P0: Contracts MVP（类型骨架，已部分完成在 packages/runtime-contracts）
P0: Runtime Adapter Wrapper（PiAi/PiCli 包成 RuntimeEvent producer）
P0: Trace Model v2（按 run 分组、展示 raw）
P1: ExtensionRegistry MVP（自管 install / enable / permissions）
P1: Tool Adapter Layer（统一 ToolDefinition）
P1: PiEmbeddedRuntime MVP（不 spawn CLI 跑通 tool loop）
P2: pi-subagents Embedded Adapter（第一个复杂生态验证）
P2: Extension Install UI
P3: Telegraph Native Workflow DSL（最后再考虑）
```

**不做什么**：

- 不要先做 marketplace（registry/permission 没稳定时 marketplace 是空中楼阁）
- 不要先做 workflow DSL（编排范式锁死）
- 不要先做 PiEmbeddedRuntime（contracts 没稳定时 embedded 实现会带框架偏向）

**为什么**：A-005 §10.11 的依赖图 = 这个顺序。倒着做 = 上层抽象被下层杂质污染。

**详见**：A-005 §10。

---

## 决策快速反射

| 用户说 | 你应该说 |
|--------|----------|
| "我们做个 graph 编排器吧" | 先看原则 1 + 8。Telegraph 还没到 P3，先把 RuntimeEvent 跑通。 |
| "Pi 的 PiContext 直接当核心类型" | 原则 2 拒绝。Pi 类型只在 PiAdapter 内。 |
| "trace 太慢，先简化只发 assistant_delta" | 原则 4 拒绝。Trace 是评估 framework 的窗口，不能阉割。 |
| "extension 直接 patch ChatPanel 加按钮" | 原则 5 拒绝。走 `ctx.contributes.panels`。 |
| "RuntimeEvent 加个 type 但 raw 字段先空着" | 原则 7 拒绝。要么齐，要么不加。 |
| "先做个 marketplace 吸引开发者" | 原则 8 反对。registry / permission 都没稳定，marketplace 没法兑现承诺。 |
| "spawn pi 太烦，我直接重写 Pi 的 extension loader" | 原则 3 提醒。先 PiCliRuntime fallback，再渐进 PiEmbeddedRuntime；不要在 contracts 没稳定时就重写。 |

---

## 文档地图

| 何时打开 | 文档 |
|----------|------|
| 写代码前红线检查 | [`agent-runtime-guard.md`](./agent-runtime-guard.md) |
| 看完整理论推导 | [`A-005`](../codebase-wiki/architecture/20260505-telegraph-agent-runtime-extension-host-theory.md) |
| 看 runtime 在进程里跑哪 | [`A-008 §3.4 + §8 + §15`](../codebase-wiki/architecture/20260509-telegraph-final-process-architecture.md) |
| 看 trace 死锁案例 | [`I-002`](../codebase-wiki/issue/20260505-pi-ai-llm-trace-await-sink-deadlock.md) |
| 看 Pi / Multica 能力对比 | [`D-001`](../codebase-wiki/discussion/20260504-multica-vs-pi-multi-agent-for-telegraph.md) |

---

## 维护

本文档是 A-005 战略层的精简投影：

- A-005 §1 / §11 改 → 本文原则 1–7 同步
- A-005 §10 路线图改 → 本文原则 8 同步
- 新增长期原则 → 先在 A-005 立论，再回流到本文

任何修改都不能只动本文，必须先在 A-005 / 新 wiki 文档留痕。
