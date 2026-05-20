# Agent Runtime Guard — 写 agent / runtime / extension / trace 代码前必读

> 本文档与 [`architecture-guard.md`](./architecture-guard.md) **正交**：
> - architecture-guard 管"进程之间怎么对话"（IPC 拓扑、participant、channel）
> - 本文档管"agent run 内部协议"（RuntimeEvent、Tool、Extension、Trace 语义）
>
> 同时触发两者时（例如"renderer 怎么消费 RuntimeEvent"）= 两份都要读。
>
> 权威长文：[A-005 Agent Runtime / Extension Host 理论](../codebase-wiki/architecture/20260505-telegraph-agent-runtime-extension-host-theory.md)。
> 设计哲学速查：[`agent-runtime-design.md`](./agent-runtime-design.md)。

---

## 1. 触发条件 — 出现以下任一情况，必须先读 A-005 / design

| # | 触发场景 | 必读 |
|---|----------|------|
| AT1 | 新增 / 修改 `RuntimeEvent` 类型或字段 | A-005 §4.2 + §4.2.1 + §15.2 |
| AT2 | 新增 / 修改 runtime adapter（pi-ai / pi-cli / langgraph / ai-sdk / mastra / 自研） | A-005 §4.1 + §6.3；design §"先抽象运行事实再抽象编排表达" |
| AT3 | 新增 tool / 工具适配（pi extension tool / MCP server / native tool） | A-005 §4.4 + §12.7 |
| AT4 | 新增 / 修改 Extension manifest / installer / registry / resolver | A-005 §4.5 + §7 |
| AT5 | 新增 / 修改 hook（beforeRun / afterToolResult / 等） | A-005 §4.6 |
| AT6 | 改 trace 通道、TracePanel、trace 事件分发 | A-005 §4.3 + §8.3 + §12.4 + §12.8 |
| AT7 | 设计 workflow / pattern / DSL（chain / parallel / orchestrator / evaluator …） | A-005 §3 + §6；design §"不要先做 Telegraph workflow DSL" |
| AT8 | 涉及 runtime 错误分类、重试、fallback 策略 | A-005 §12.6 + §11.5 |
| AT9 | 涉及 permission / sandbox / extension 安全边界 | A-005 §4.4 + §7.4 + §12.7 |
| AT10 | 用户描述类似"让模型直接调用 X 工具"、"trace 太慢简化一下"、"先 spawn pi 用着" | 整篇 A-005 §11 + 本文 §2 |

**安全场景**（无需读 A-005）：
- 改 ChatPanel UI 样式
- 改 trace 显示的 label / 颜色 / 排序，不动事件结构
- 在已有 runtime adapter 内部修 bug（不增减事件类型、不改字段语义）

---

## 2. 红线 — 绝对禁止

### 2.1 进程归属红线（与 A-008 联动）

```typescript
// ❌ 禁止：在 main / daemon / shared 进程 import runtime 实现
import { PiAiRuntime } from '@telegraph/agent-runtime'  // 在 apps/telegraph/src/services/... 内

// ❌ 禁止：在 main / daemon 内调用 runtime.run()
runtime.run(input)  // 这一行只能在 pagelet utility process 内出现

// ✅ 正确：runtime 在 pagelet 内执行，main / 其他 pagelet 通过 RPC 调用
// pagelet 内：
const events = runtime.run(input)
for await (const ev of events) yield ev  // 通过 IChatPageletService.runTurn 暴露
```

**判定**：动 runtime 实现 = 必须落在 `apps/<pagelet-app>/src/...` 下；落到 `apps/telegraph/src/services/` 或 daemon 下 = 红线。

### 2.2 RuntimeEvent 协议红线（A-005 §4.2 / §15.2）

```typescript
// ❌ 禁止：把 framework-specific 类型直接做成事件类型
type Event = { type: 'pi_json_line'; ... } | { type: 'langgraph_node_event'; ... }

// ❌ 禁止：raw 字段塞函数 / class instance / 循环引用
{ type: 'model_event', raw: someClassInstance }  // 跨 RPC 边界会炸

// ❌ 禁止：raw payload 无上限直传
{ type: 'model_event', raw: hugeBase64Image }  // 走 rawRef 外置

// ✅ 正确：framework 差异封装在 raw + origin
{ type: 'model_event', requestId, raw: serializableJSON, origin: { framework: 'pi' }, ts }
```

**RuntimeEvent 类型新增 / 字段语义变更 = 破坏性契约变更**。必须：
1. bump `schemaVersion`（A-005 §4.2.1）
2. 在 `packages/runtime-contracts/src/fixtures/` 加 golden file
3. renderer / extension 对未知事件类型必须降级为 `runtime_log + raw`，不得抛错

### 2.4 Trace / 背压红线（A-005 §8.3 + §12.4 + §12.8）

```typescript
// ❌ 禁止：trace 阻塞主 RPC 流
await traceSink.push(event)  // 同步等 trace ack 再继续推 model_event = I-002 死锁

// ❌ 禁止：用 trace 通道传业务关键状态
// trace 必须默认非阻塞、可降级丢弃；run lifecycle 走业务 RPC
```

**规则**：trace 与业务 RPC 同 channel 但分级——`run_started/completed/failed/cancelled` 不可丢，`model_event/assistant_delta/tool_*` 可降级丢弃并在 TracePanel 标 `[degraded]`。

### 2.5 External CLI Runtime 红线（A-005 §11.5 + D-015）

```text
❌ 把 PiCliRuntime 当架构中心：在 ChatPanel / TracePanel / ExtensionRegistry 里写 if (backend === 'pi-cli')
❌ 把 pi-subagents 做成 Telegraph embedded adapter，默认扫描/复刻 .pi 目录语义
✅ PiCliRuntime / Codex CLI / Claude Code CLI 属于 External Agent Runtime；UI 与 registry 永远只看 RuntimeEvent / ToolDefinition / AgentProfile / CapabilityProfile
✅ Telegraph 自己的 subagents 属于 Native Harness；Embedded Execution Kernel 只是它的底层 model/tool loop
```

---

## 3. 实现现状提醒（极容易踩的坑）

`from-zero` 重写后，新仓库的 agent runtime 体系**只剩类型骨架**：

| 看起来"应该有"的东西 | 实际状态 |
|----------------------|----------|
| `packages/runtime-contracts/` | ✅ 类型在，**但新仓库 0 消费者** |
| `packages/agent-runtime/`（PiAiRuntime / PiCliRuntime / ...） | ❌ 尚未实现 |
| `AgentStreamService` / `RuntimeEventForwarder` | ❌ 尚未实现 |
| `LlmTracePanel` / `RuntimeTimeline` | ❌ 尚未实现 |
| Telegraph Native Subagent Harness | 方向见 D-015；不要再按 `pi-subagents adapter` 定位 |

**判定**：动手前先 `ls packages/` 和 `ls apps/<pagelet>/src/` 确认依赖类型/服务**实际存在**，不要凭 A-005 §10 "Phase 0 完成"的描述假设它已就绪。需要的话先在新仓库重新接 contracts 消费者。

---

## 4. 输出前自检清单

在你给出 agent / runtime / extension 相关方案前，自答：

- [ ] 触发了 §1 哪几条？对应章节真的读了？
- [ ] 我新加 / 修改的代码是不是在 pagelet 内？还是错放到 main / daemon？
- [ ] 如果新增了 RuntimeEvent 类型 → schemaVersion 升了吗？fixture 加了吗？renderer 降级路径有吗？
- [ ] 如果改了 trace 通道 → 有没有让 trace 阻塞业务 RPC？关键 lifecycle 事件可丢吗？
- [ ] 如果引入了新 framework（langgraph 等）→ 是不是把它的概念漏到了核心类型里？
- [ ] runtime-contracts 里我引用的类型**真的存在**吗（不是凭 A-005 §10 假设）？

任意一项答 "不确定" → 重新打开 A-005 对应章节，必要时查 `packages/runtime-contracts/src/`。

---

## 5. 文档地图

| 文档 | 作用 | 何时读 |
|------|------|--------|
| **本文档** | red lines + 触发条件 + 现状提醒 | 写 agent 代码前扫一眼 §1 |
| [`agent-runtime-design.md`](./agent-runtime-design.md) | 5–8 条核心设计原则的浓缩版 | 设计新 runtime / extension 形态前 |
| [`A-005`](../codebase-wiki/architecture/20260505-telegraph-agent-runtime-extension-host-theory.md) | 完整理论 + 路线图 | §1 触发命中且需要细节时 |
| [`A-008 §3.4 + §4 + §8`](../codebase-wiki/architecture/20260509-telegraph-final-process-architecture.md) | runtime 在进程拓扑中的承载边界 | 涉及跨进程时 |
| [`I-002`](../codebase-wiki/issue/20260505-pi-ai-llm-trace-await-sink-deadlock.md) | trace / IPC 死锁案例 | 改 trace 通道前必读 |
| `packages/runtime-contracts/src/` | 类型源代码 | 引用任何 contracts 类型前确认存在 |

---

## 6. 维护

本文档随 A-005 / A-008 演进：
- A-005 §4.2 字段集合调整 → 本文 §2.3 同步
- A-008 §3.4 pagelet 边界调整 → 本文 §2.1 同步
- 新仓库内开始有 runtime 实现进入 → 本文 §3 表格更新

任何对本文档的修改属于"agent 协议层变更"，必须先在 A-005 / wiki 留痕，不能只改本文。
