# Agent protocol compatibility

`@telegraph/agent-protocol` is the long-term shared protocol package for
pagelet-local agent hosts. The legacy `@telegraph/runtime-contracts` compatibility
package has been removed after the repo migrated to `@/packages/agent-protocol`.

## Versioning

- **`schemaVersion`**: carried on every `AgentEvent` / `RuntimeEvent` (see `RUNTIME_CONTRACT_SCHEMA_VERSION`). Breaking semantic changes bump this integer.
- **`producerVersion`**: optional string (semver recommended) identifying the adapter build (`PiAiRuntime`, `PiCliRuntime`, etc.).

Consumers must tolerate unknown event `type` values by degrading to `runtime_log` semantics (A-005).

## Naming

- Prefer `AgentEvent` in new cross-pagelet code.
- Keep `RuntimeEvent` in adapter internals when that name describes runtime
  facts; use `AgentEvent` for cross-pagelet protocol surfaces.
- Do not introduce app-specific protocol events for chat or design artifacts;
  carry app output through `assistant_message`, `tool_result.output`,
  `run_completed.output`, or event metadata.

## Agent IPC (Phase 1)

- New chunk: `{ type: 'runtime_event', runId, sessionId, event: RuntimeEvent }` (sink push uses **non-blocking** `safePush` like `llm_trace` to avoid I-002-style RPC deadlock).
- Legacy `text_delta` / `llm_trace` rows remain for Chat + old trace rows.

## Agent IPC: `AgentRunEvent` → `RuntimeEvent` (target mapping)

Today the daemon → renderer stream uses `AgentRunEvent` (`apps/telegraph/src/services/agent/common/types.ts`). Phase 1 adapters should emit `RuntimeEvent` (and may dual-write legacy chunks during migration).

| Legacy `AgentRunEvent` | Target `RuntimeEvent` | Notes |
|------------------------|----------------------|--------|
| `run_queued` | `run_started` or `runtime_log` | Queueing is transport-level; prefer `run_started` when execution actually begins. |
| `run_started` | `run_started` | Map `status: 'running'` into `run_started`; include `producerVersion`. |
| `text_delta` | `assistant_delta` | Use `requestId` per model turn; set `runId` for trace grouping. |
| `run_completed` | `run_completed` | Map final assistant text into `output` when known. |
| `run_failed` / `error` | `run_failed` | Wrap string errors in `RuntimeError` `{ code, message }`. |
| `done` | `run_completed` or redundant `runtime_log` | Prefer explicit `run_completed` as the terminal fact. |
| `llm_trace` | `model_request` / `model_event` / `tool_*` / `runtime_log` | Trace rows become first-class events; raw pi-ai/CLI payloads live in `raw`. |

## Trace payloads (`LlmTracePayload`) → events

| `LlmTracePayload.kind` | Target `RuntimeEvent` kinds |
|--------------------------|-----------------------------|
| `telegraph_turn_context` | `runtime_log` or `model_request` (summary) |
| `pi_ai_request` | `model_request` |
| `pi_ai_stream_event` | `model_event` / `assistant_delta` |
| `pi_cli_request` | `model_request` and/or `runtime_log` |
| `pi_json_line` | `model_event`, `tool_call`, `tool_result`, `run_completed`, … |

## Pi-ai stream tokens

Raw pi-ai iterator events (`text_delta`, `toolcall_*`, `done`, …) should not cross the UI boundary unchanged long-term; they are mapped by the adapter to the rows above.
