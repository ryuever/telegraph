# Event Mapping: Pi-AI → RuntimeEvent

**Document ID**: R-001  
**Created**: 2026-05-05  
**Status**: Reference  
**Scope**: Phase 1 validation (pi-ai runtime only)

## Overview

This document defines the mapping between pi-ai's internal event stream and the unified `RuntimeEvent` contract defined in `@telegraph/runtime-contracts`. It ensures that all runtime events follow the standardized schema for multi-framework support.

---

## Event Mapping Table

### 1. Run Lifecycle Events

| Pi-AI Event | RuntimeEvent | Mapping Details |
|-------------|-------------|-----------------|
| (synthetic) | `run_started` | **Created by**: PiAiRuntime.run() at start<br>**Timestamp**: `Date.now()`<br>**Origin**: `{framework: 'pi', runtimeId: 'pi-ai'}`<br>**Pattern**: `'single_llm'` (pi-ai always single-turn within a run)<br>**Schema Version**: `RUNTIME_CONTRACT_SCHEMA_VERSION`<br>**Producer Version**: `TELEGRAPH_PI_AI_PRODUCER_VERSION` |
| (from stream) | `run_completed` | **Source**: Pi-AI's terminal event with success<br>**Timestamp**: From pi-ai event<br>**Result**: Extracted from pi-ai's completion payload<br>**Terminal**: YES — stops stream iteration |
| (from stream) | `run_failed` | **Source**: Pi-AI's terminal event with error OR exception caught in catch block<br>**Timestamp**: From pi-ai event or `Date.now()`<br>**Error**: Includes code, message, details<br>**Terminal**: YES — stops stream iteration<br>**Note**: If pi-ai throws after `run_started`, wrapped in this event |
| (synthetic) | `run_failed` | **Created by**: RunLifecycleManager.ensureTerminal() on timeout/unexpected end<br>**Error Code**: `'stream_timeout'` or `'stream_ended_early'`<br>**Synthetic Flag**: `true` (marks as system-generated)<br>**Terminal**: YES |
| (not used) | `run_cancelled` | **Current**: Not emitted by pi-ai (no abort support yet)<br>**Future**: When AbortSignal support is added |

---

### 2. Model Interaction Events

| Pi-AI Event | RuntimeEvent | Mapping Details |
|-------------|-------------|-----------------|
| `model_request` | `model_request` | **Source**: From pi-ai's streaming events<br>**Payload**: Includes prompt/context passed to model<br>**Timestamp**: From pi-ai<br>**Terminal**: NO |
| `model_event` (streaming) | `model_event` | **Source**: Streamed chunks from pi-ai model<br>**Data**: Partial or complete token chunks<br>**Role**: Usually `'assistant'`<br>**Terminal**: NO |
| `model_response_complete` | (absorbed into `model_event`) | Pi-ai signals completion via stream end<br>**Note**: Not a separate event in current impl |

---

### 3. Tool Execution Events

#### Pi-Embedded Only (Phase 2)

| Pi-Embedded Event | RuntimeEvent | Mapping Details |
|------------------|--------------|-----------------|
| (detected) | `tool_call` | **Source**: Parsed from LLM response (tool_use tokens)<br>**callId**: Unique identifier per tool invocation<br>**toolName**: Display name from definition<br>**input**: Tool arguments from LLM<br>**Terminal**: NO<br>**Note**: Pi-AI core doesn't expose tool_use; detection via pattern matching |
| (execution result) | `tool_result` | **Source**: After tool execution<br>**callId**: Back-reference to tool_call<br>**toolName**: Same as tool_call<br>**output**: Tool execution result (serializable)<br>**Terminal**: NO<br>**Alternative**: `tool_error` if execution fails |

#### Pi-CLI Compatibility (Future)

| Pi-CLI Event | RuntimeEvent | Status |
|-------------|-------------|--------|
| `tool_call` | `tool_call` | **Current**: pi-cli spawn removed in Phase 1<br>**Future**: If pi-cli is re-added, map directly |
| `tool_result` | `tool_result` | **Current**: Deferred<br>**Future**: Map from cli stdout |

---

### 4. Trace/Debug Events

| Pi-AI Event | RuntimeEvent | Mapping Details |
|-------------|-------------|-----------------|
| (all above) | Various | **Channel**: Forwarded via `agentStreamSink.safePush()` (async, non-blocking)<br>**Handling**: If trace channel is busy, events may be dropped (accepted tradeoff)<br>**Storage**: Aggregated under run ID in trace backend |

---

## Event Flow Diagram

```
┌──────────────────────────────────────────────────────────┐
│ AgentStreamService.runStreamInternal                     │
└──────────────────────────────────────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────────┐
        │ createRuntime(req.settings)        │
        │ ➜ new PiAiRuntime()                │
        └────────────────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────────┐
        │ runtime.run(input)                 │
        │ [AsyncGenerator]                   │
        └────────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          ▼                             ▼
    ┌─────────────────┐          ┌──────────────────┐
    │ run_started     │          │ streamPiAi       │
    │ (synthetic)     │          │ RuntimeEvents    │
    └─────────────────┘          │ [pi-ai stream]   │
          │                       └──────────────────┘
          │                             │
          │                  ┌──────────┴──────────┐
          │                  ▼                     ▼
          │            ┌──────────────┐   ┌──────────────┐
          │            │model_request │   │ model_event  │
          │            │model_event   │   │(streaming)   │
          │            └──────────────┘   └──────────────┘
          │                  │                     │
          ▼                  ▼                     ▼
    ┌─────────────────────────────────────────────────────┐
    │ RunLifecycleManager                                 │
    │ .processRuntimeEvent(ev)                            │
    │ • Check if terminal (run_completed/failed/cancelled)│
    │ • Return ev if valid, null if duplicate             │
    └─────────────────────────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          ▼                             ▼
     (pass-through)         (terminal: stop iteration)
       Non-terminal          run_completed/failed
          │                             │
          ▼                             ▼
    ┌─────────────────┐         ┌──────────────────┐
    │sink.safePush()  │         │sink.flushPush()  │
    │(fire-and-forget)│         │(await, critical) │
    │Trace channel    │         │Main channel      │
    └─────────────────┘         └──────────────────┘
          │                             │
          ▼                             ▼
    ┌─────────────────────────────────────────────────────┐
    │ agentStreamSinkServicePath                          │
    │ (IPC to renderer/main for tracing & UI updates)     │
    └─────────────────────────────────────────────────────┘
```

---

## Event Idempotency & Backpressure

### Terminal Event Idempotency

The `RunLifecycleManager` ensures:
- **Only one** terminal event (`run_completed`, `run_failed`, or `run_cancelled`) is emitted per run
- **Duplicates** are logged and ignored (returns `null`)
- **Fallback**: If stream ends without a terminal event, `ensureTerminal()` synthesizes one

Example scenario:
```typescript
// Pi-AI emits run_completed
manager.processRuntimeEvent({ type: 'run_completed', ... })  // ✓ accepted
// Later, an error is reported
manager.processRuntimeEvent({ type: 'run_failed', ... })    // ✗ ignored, logged
```

### Channel Backpressure

| Event Type | Channel | Blocking | Semantics |
|-----------|---------|----------|-----------|
| Terminal (run_completed, run_failed) | Main | ✅ Yes (`flushPush`) | Critical — must acknowledge |
| Non-terminal (model_request, model_event) | Trace | ❌ No (`safePush`) | Best-effort — safe to drop on overload |

**Rationale**: Model streams are high-frequency and can tolerate loss; terminal events must not be lost.

---

## Validation Checklist (Phase 1 Exit)

- [x] `run_started` emitted first by PiAiRuntime
- [x] `run_completed`/`run_failed` emitted last
- [x] No duplicate terminal events via RunLifecycleManager
- [x] Non-terminal events pass through unchanged
- [x] Terminal events use `flushPush()` (blocking)
- [x] Non-terminal events use `safePush()` (async)
- [ ] Trace backend aggregates events by `runId` correctly
- [ ] Multi-turn conversation preserves event order
- [ ] Performance baseline: TTFT < 2s, throughput > 10 req/s

---

## Known Gaps & Future Work

### Phase 2 (Pi-CLI Compatible)
- [ ] Add `tool_call` / `tool_result` events (requires embedded tool loop)
- [ ] Support `run_cancelled` via AbortSignal
- [ ] Support multi-turn (session-level context)

### Phase 3 (Multi-Framework)
- [ ] Add mapping for Embedded Execution Kernel events
- [ ] Extend for OpenAI API runtime
- [ ] Add extension framework events

---

## References

- Contract: `@telegraph/runtime-contracts` – RuntimeEvent, RUNTIME_CONTRACT_SCHEMA_VERSION
- Implementation: `packages/agent/src/runtime/streamPiAiRuntime.ts`
- Integration: `apps/telegraph/src/services/agent/node/AgentStreamService.ts`
- Lifecycle: `packages/agent/src/runtime/RunLifecycleManager.ts`
- Architecture: `codebase-wiki/architecture/20260505-telegraph-agent-runtime-extension-host-theory.md` (A-005)
- Phase Gates: `codebase-wiki/roadmap/20260505-agent-runtime-extension-host-phase-gates.md` (P-002)
