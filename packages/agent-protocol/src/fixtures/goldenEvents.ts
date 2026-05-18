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

export const goldenMultiAgentChain: RuntimeEvent[] = [
  {
    type: 'run_started',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: 'telegraph-test',
    runId: 'run-chain',
    pattern: 'prompt_chain',
    ts,
  },
  {
    type: 'step_started',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    runId: 'run-chain',
    stepId: 'run-chain-step-1',
    label: 'planner',
    kind: 'worker',
    ts: ts + 1,
  },
  {
    type: 'child_run_started',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    parentRunId: 'run-chain',
    childRunId: 'run-chain-planner',
    label: 'planner',
    ts: ts + 2,
  },
  {
    type: 'child_run_completed',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    parentRunId: 'run-chain',
    childRunId: 'run-chain-planner',
    output: { text: 'Plan' },
    ts: ts + 3,
  },
  {
    type: 'step_completed',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    runId: 'run-chain',
    stepId: 'run-chain-step-1',
    output: { text: 'Plan' },
    ts: ts + 4,
  },
  {
    type: 'run_completed',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    runId: 'run-chain',
    output: { text: 'Final answer' },
    ts: ts + 5,
  },
]

export const goldenMultiAgentParallel: RuntimeEvent[] = [
  {
    type: 'run_started',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: 'telegraph-test',
    runId: 'run-parallel',
    pattern: 'parallelization',
    ts,
  },
  {
    type: 'child_run_started',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    parentRunId: 'run-parallel',
    childRunId: 'run-parallel-scout',
    label: 'scout',
    ts: ts + 1,
  },
  {
    type: 'child_run_started',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    parentRunId: 'run-parallel',
    childRunId: 'run-parallel-reviewer',
    label: 'reviewer',
    ts: ts + 2,
  },
  {
    type: 'child_run_completed',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    parentRunId: 'run-parallel',
    childRunId: 'run-parallel-scout',
    output: { text: 'Scout result' },
    ts: ts + 3,
  },
  {
    type: 'child_run_completed',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    parentRunId: 'run-parallel',
    childRunId: 'run-parallel-reviewer',
    output: { text: 'Reviewer result' },
    ts: ts + 4,
  },
  {
    type: 'step_completed',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    runId: 'run-parallel',
    stepId: 'run-parallel-aggregate',
    output: { text: 'Aggregated result' },
    ts: ts + 5,
  },
  {
    type: 'run_completed',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    runId: 'run-parallel',
    output: { text: 'Aggregated result' },
    ts: ts + 6,
  },
]

export const goldenDesignArtifactRun: RuntimeEvent[] = [
  {
    type: 'run_started',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: 'telegraph-test',
    runId: 'run-design',
    pattern: 'single_llm',
    ts,
    origin: { framework: 'telegraph', runtimeId: 'design-agent' },
  },
  {
    type: 'assistant_message',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    runId: 'run-design',
    requestId: 'req-design',
    message: {
      id: 'msg-design-assistant',
      role: 'assistant',
      content: 'Generated a button layout.',
      metadata: {
        artifactKind: 'design-preview',
      },
    },
    ts: ts + 1,
  },
  {
    type: 'run_completed',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    runId: 'run-design',
    output: {
      artifactKind: 'design-preview',
      title: 'Button layout',
    },
    ts: ts + 2,
  },
]

/** Unused export forces `goldenEvents.ts` to typecheck when imported from tests or tooling. */
export const allGoldenEvents: RuntimeEvent[] = [
  ...goldenRunLifecycle,
  ...goldenModelToolWorkflow,
  ...goldenMultiAgentChain,
  ...goldenMultiAgentParallel,
  ...goldenDesignArtifactRun,
]
