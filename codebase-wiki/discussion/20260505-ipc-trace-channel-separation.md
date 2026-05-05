---
id: D-002
title: IPC 与 Trace 通道分离策略
description: >
  解决 I-002 (deadlock) 问题的通道设计方案。分离关键生命周期事件通道和调试 Trace 通道，
  实现背压管理和事件优先级分级。
category: discussion
created: 2026-05-05
updated: 2026-05-05
tags:
  - ipc
  - trace
  - backpressure
  - deadlock
  - architecture
status: draft
related:
  - I-002
  - A-005
  - P-002
---

# IPC 与 Trace 通道分离策略

## 问题背景

见 I-002 文档：当 RuntimeEvent 流和主 IPC 通道没有清晰分离时，会出现：
- Trace 推送阻塞模型流消费
- 主流程等待 trace ACK，同时 renderer 等待主流程回复，形成互等
- 事件丢失或乱序

## 解决方案

### 核心思想

**分离两条通道**：
1. **主流程通道**：关键生命周期事件（run_started/run_completed/run_failed），必须 ACK
2. **异步 Trace 通道**：调试事件（model_request/model_event/tool_call），火即忘

```
AgentStreamService
    ├─ [Push Channel] → sink.push() with ACK
    │   ├─ run_queued
    │   ├─ run_started
    │   ├─ run_completed
    │   ├─ run_failed
    │   └─ error
    │
    └─ [Trace Channel] → async emit, no ACK
        ├─ runtime_event
        ├─ llm_trace
        ├─ text_delta
        └─ debug logs
```

### 事件分类

| 事件类型 | 通道 | 阻塞 | 优先级 | 说明 |
|---------|------|------|--------|------|
| run_queued | Main | 否 | 低 | 状态标记 |
| run_started | Main | 否 | 低 | 状态标记 |
| run_completed | Main | 是 | 高 | 必须有 ACK，确保完成 |
| run_failed | Main | 是 | 高 | 必须有 ACK，确保失败记录 |
| error | Main | 否 | 中 | 补充错误信息 |
| runtime_event | Trace | 否 | 低 | 异步转发，可丢弃 |
| llm_trace | Trace | 否 | 低 | 异步转发，用于调试 |
| text_delta | Main | 否 | 中 | 用户看得到，但丢失无伤 |

### 实现细节

#### 当前 AgentStreamService 的改进

```typescript
// 关键生命周期走同步通道（带 await）
const flushPush = async (chunk) => {
  try {
    await push(chunk)  // 等待 ACK
  } catch (error) {
    console.error('[AgentStreamService] critical event push failed:', error)
  }
}

// Trace 事件走异步通道（无等待）
const safePushTrace = (chunk) => {
  void push(chunk).catch(error => {
    console.warn('[trace] push failed, continuing:', error.message)
  })
}

// 在 runtime 循环中
for await (const ev of runtime.run(input)) {
  // 关键事件
  if (ev.type === 'run_completed' || ev.type === 'run_failed') {
    await flushPush(ev)  // 阻塞等待 ACK
  }
  
  // 调试事件
  if (ev.type === 'model_request' || ev.type === 'model_event') {
    safePushTrace(ev)  // 异步，不阻塞
  }
}
```

### 背压预算

定义每个通道的容量约束：

```typescript
interface ChannelBackpressure {
  // 主通道：关键事件必须进行
  mainChannel: {
    timeoutMs: 30000,          // 等待 ACK 的最长时间
    retries: 3,                 // 失败重试次数
    failFast: true,             // 失败立即停止运行
  }
  
  // Trace 通道：可以丢弃
  traceChannel: {
    queueDepth: 1000,           // 内存队列深度
    flushIntervalMs: 5000,      // 定期 flush
    onQueueFull: 'drop_oldest', // 超出时策略
    ignorePushErrors: true,     // 推送失败不影响主流程
  }
}
```

## 与现有代码的关系

### 已实现

Phase 1/2 改造后的 AgentStreamService：
- ✅ 使用 `createRuntime()` 从 runtime adapter 获取统一事件流
- ✅ 使用 `RunLifecycleManager` 管理终态，保证幂等性
- ✅ `flushPush()` 用于关键事件（虽然没有真正分离，但至少明确标记了）

### 需要进一步优化

- ⚠️ 当前仍有部分非关键事件用 `flushPush`（例如 text_delta）
- ⚠️ 没有明确的 Trace 通道实现（目前全部用 `safePush`）
- ⚠️ 没有背压队列管理
- ⚠️ 没有 Trace 事件丢弃降级策略

## 后续改进计划

### Phase 2（短期，1 周）

- [ ] IPC sink 接口分化为 `pushEvent()` 和 `pushTrace()`
- [ ] AgentStreamService 调整为明确的两个通道调用
- [ ] 添加背压日志

### Phase 3（中期，2 周）

- [ ] TraceChannel 实现为异步队列
- [ ] 添加队列溢出时的降级策略
- [ ] 添加 Trace 事件采样（高频事件）

### Phase 4（长期）

- [ ] 在 daemon-main 之间实现背压信号
- [ ] 根据 main 进程压力动态调整 trace 采样率
- [ ] 添加可观测性指标（事件吞吐、丢弃率等）

## 验证方案

### 回归测试

对标 I-002，构造测试用例：
- 长时间流式输出（>60s）
- 高频 trace 推送（>1000 events/s）
- 主进程偶发响应缓慢（模拟 electron 渲染卡顿）
- 验证：no deadlock, no event loss on critical path, trace events acceptable loss <5%

### 性能基线

- TTFT (Time To First Token): <2s
- Throughput: >100 tokens/s
- Trace latency: <100ms (p95)
- No memory growth over 10min streams

## 参考

- A-005 § 8.3 与 I-002 的经验连接
- I-002 详细的问题分析与死锁复现步骤
