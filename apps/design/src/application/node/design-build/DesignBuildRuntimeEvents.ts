import type { AgentEvent, RuntimeOrigin } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { TELEGRAPH_DESIGN_BUILD_RUNTIME_ID } from '@/apps/design/application/common/design-build'
import type { DesignBuildFailureCode } from './DesignBuildInitialState'

export const TELEGRAPH_DESIGN_BUILD_PRODUCER_VERSION = 'telegraph-design-build@0.1.0'

export const DESIGN_BUILD_SCHEMA_VERSION = RUNTIME_CONTRACT_SCHEMA_VERSION
export const DESIGN_BUILD_ORIGIN: RuntimeOrigin = {
  framework: 'telegraph',
  runtimeId: TELEGRAPH_DESIGN_BUILD_RUNTIME_ID,
}

export function runStarted(runId: string): AgentEvent {
  return {
    type: 'run_started',
    schemaVersion: DESIGN_BUILD_SCHEMA_VERSION,
    producerVersion: TELEGRAPH_DESIGN_BUILD_PRODUCER_VERSION,
    origin: DESIGN_BUILD_ORIGIN,
    runId,
    pattern: 'prompt_chain',
    ts: Date.now(),
  }
}

export function runCancelled(runId: string): AgentEvent {
  return {
    type: 'run_cancelled',
    schemaVersion: DESIGN_BUILD_SCHEMA_VERSION,
    producerVersion: TELEGRAPH_DESIGN_BUILD_PRODUCER_VERSION,
    origin: DESIGN_BUILD_ORIGIN,
    runId,
    reason: 'Cancelled',
    ts: Date.now(),
  }
}

export function runFailed(runId: string, code: DesignBuildFailureCode, message: string, details?: unknown): AgentEvent {
  return {
    type: 'run_failed',
    schemaVersion: DESIGN_BUILD_SCHEMA_VERSION,
    producerVersion: TELEGRAPH_DESIGN_BUILD_PRODUCER_VERSION,
    origin: DESIGN_BUILD_ORIGIN,
    runId,
    error: {
      code,
      message,
      details,
    },
    ts: Date.now(),
  }
}

export function childRunStarted(
  parentRunId: string,
  childRunId: string,
  label: string,
  raw?: unknown,
): AgentEvent {
  return {
    type: 'child_run_started',
    schemaVersion: DESIGN_BUILD_SCHEMA_VERSION,
    producerVersion: TELEGRAPH_DESIGN_BUILD_PRODUCER_VERSION,
    origin: DESIGN_BUILD_ORIGIN,
    parentRunId,
    childRunId,
    label,
    raw,
    ts: Date.now(),
  }
}

export function childRunCompleted(
  parentRunId: string,
  childRunId: string,
  output: unknown,
  raw?: unknown,
): AgentEvent {
  return {
    type: 'child_run_completed',
    schemaVersion: DESIGN_BUILD_SCHEMA_VERSION,
    producerVersion: TELEGRAPH_DESIGN_BUILD_PRODUCER_VERSION,
    origin: DESIGN_BUILD_ORIGIN,
    parentRunId,
    childRunId,
    output,
    raw,
    ts: Date.now(),
  }
}

export function stepStarted(runId: string, stepId: string, label: string): AgentEvent {
  return {
    type: 'step_started',
    schemaVersion: DESIGN_BUILD_SCHEMA_VERSION,
    producerVersion: TELEGRAPH_DESIGN_BUILD_PRODUCER_VERSION,
    origin: DESIGN_BUILD_ORIGIN,
    runId,
    stepId,
    label,
    kind: 'worker',
    ts: Date.now(),
  }
}

export function stepCompleted(runId: string, stepId: string, output: unknown): AgentEvent {
  return {
    type: 'step_completed',
    schemaVersion: DESIGN_BUILD_SCHEMA_VERSION,
    producerVersion: TELEGRAPH_DESIGN_BUILD_PRODUCER_VERSION,
    origin: DESIGN_BUILD_ORIGIN,
    runId,
    stepId,
    output,
    ts: Date.now(),
  }
}

export function assistantArtifactDelta(input: {
  runId: string
  requestId: string
  artifact: { id: string; kind: string; title: string }
}): AgentEvent {
  return {
    type: 'assistant_delta',
    schemaVersion: DESIGN_BUILD_SCHEMA_VERSION,
    producerVersion: TELEGRAPH_DESIGN_BUILD_PRODUCER_VERSION,
    origin: DESIGN_BUILD_ORIGIN,
    runId: input.runId,
    requestId: input.requestId,
    text: `已生成「${input.artifact.title}」预览。`,
    raw: { artifactId: input.artifact.id, kind: input.artifact.kind },
    ts: Date.now(),
  }
}

export function runCompleted(input: {
  runId: string
  artifact: unknown
  childRuns: Array<{ childRunId: string; profileId: string; output: unknown }>
}): AgentEvent {
  return {
    type: 'run_completed',
    schemaVersion: DESIGN_BUILD_SCHEMA_VERSION,
    producerVersion: TELEGRAPH_DESIGN_BUILD_PRODUCER_VERSION,
    origin: DESIGN_BUILD_ORIGIN,
    runId: input.runId,
    output: {
      artifact: input.artifact,
      orchestration: {
        childRuns: input.childRuns,
      },
    },
    ts: Date.now(),
  }
}
