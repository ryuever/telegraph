/**
 * Compile-time fixtures: must stay assignable to `RuntimeEvent`.
 * Used as Phase 0 gate evidence and adapter mapping tests (Phase 1+).
 */
import type { RuntimeEvent } from '../events.js'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '../version.js'

const ts = 1_700_000_000_000

export const goldenRunLifecycle: RuntimeEvent[] = [
  {
    type: 'run_started',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: 'telegraph-test',
    runId: 'run-1',
    ts,
    pattern: 'single_llm',
  },
  {
    type: 'run_completed',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    runId: 'run-1',
    output: { text: 'hello' },
    ts: ts + 1,
  },
]

export const goldenModelToolWorkflow: RuntimeEvent[] = [
  {
    type: 'model_request',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    runId: 'run-1',
    requestId: 'req-1',
    payload: { role: 'user', content: 'hi' },
    ts,
  },
  {
    type: 'model_event',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    runId: 'run-1',
    requestId: 'req-1',
    raw: { kind: 'token', value: 'x' },
    ts: ts + 1,
  },
  {
    type: 'assistant_delta',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    runId: 'run-1',
    requestId: 'req-1',
    text: 'Hello',
    ts: ts + 2,
  },
  {
    type: 'tool_call',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    runId: 'run-1',
    callId: 'call-1',
    toolName: 'read_file',
    input: { path: 'README.md' },
    ts: ts + 3,
  },
  {
    type: 'tool_result',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    runId: 'run-1',
    callId: 'call-1',
    toolName: 'read_file',
    output: { content: '…' },
    ts: ts + 4,
  },
  {
    type: 'step_started',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    runId: 'run-1',
    stepId: 's1',
    label: 'Plan',
    kind: 'router',
    ts: ts + 5,
  },
  {
    type: 'step_completed',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    runId: 'run-1',
    stepId: 's1',
    output: { ok: true },
    ts: ts + 6,
  },
]

/** Unused export forces `goldenEvents.ts` to typecheck when imported from tests or tooling. */
export const allGoldenEvents: RuntimeEvent[] = [...goldenRunLifecycle, ...goldenModelToolWorkflow]
