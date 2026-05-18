import type { AgentEvent, RuntimeOrigin } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import type { StepKind } from '@/packages/agent-protocol/workflow'

export interface OrchestratorHookBase {
  runId: string
  ts?: number
  origin?: RuntimeOrigin
  raw?: unknown
}

export interface NodeHookInput extends OrchestratorHookBase {
  nodeId: string
  label?: string
  kind?: StepKind
}

export interface NodeCompletedHookInput extends NodeHookInput {
  output?: unknown
}

export interface EdgeTakenHookInput extends OrchestratorHookBase {
  from: string
  to: string
  condition?: string
}

export interface CheckpointHookInput extends OrchestratorHookBase {
  checkpointId: string
  nodeId?: string
  state?: unknown
}

export interface InterruptHookInput extends OrchestratorHookBase {
  interruptId: string
  nodeId?: string
  reason: string
  resumable?: boolean
}

export function createNodeStartedEvent(input: NodeHookInput): AgentEvent {
  return {
    type: 'step_started',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: 'telegraph-orchestrator-observability@0.0.0',
    origin: input.origin,
    runId: input.runId,
    stepId: input.nodeId,
    label: input.label ?? input.nodeId,
    kind: input.kind ?? 'custom',
    raw: input.raw,
    ts: input.ts ?? Date.now(),
  }
}

export function createNodeCompletedEvent(input: NodeCompletedHookInput): AgentEvent {
  return {
    type: 'step_completed',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: 'telegraph-orchestrator-observability@0.0.0',
    origin: input.origin,
    runId: input.runId,
    stepId: input.nodeId,
    output: input.output,
    raw: input.raw,
    ts: input.ts ?? Date.now(),
  }
}

export function createEdgeTakenEvent(input: EdgeTakenHookInput): AgentEvent {
  return {
    type: 'edge_taken',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: 'telegraph-orchestrator-observability@0.0.0',
    origin: input.origin,
    runId: input.runId,
    from: input.from,
    to: input.to,
    condition: input.condition,
    raw: input.raw,
    ts: input.ts ?? Date.now(),
  }
}

export function createCheckpointEvent(input: CheckpointHookInput): AgentEvent {
  return {
    type: 'runtime_log',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: 'telegraph-orchestrator-observability@0.0.0',
    origin: input.origin,
    runId: input.runId,
    level: 'debug',
    message: `checkpoint:${input.checkpointId}`,
    raw: {
      hook: 'checkpoint',
      checkpointId: input.checkpointId,
      nodeId: input.nodeId,
      state: input.state,
      raw: input.raw,
    },
    ts: input.ts ?? Date.now(),
  }
}

export function createInterruptEvent(input: InterruptHookInput): AgentEvent {
  return {
    type: 'runtime_log',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: 'telegraph-orchestrator-observability@0.0.0',
    origin: input.origin,
    runId: input.runId,
    level: 'warn',
    message: `interrupt:${input.interruptId}:${input.reason}`,
    raw: {
      hook: 'interrupt',
      interruptId: input.interruptId,
      nodeId: input.nodeId,
      reason: input.reason,
      resumable: input.resumable ?? false,
      raw: input.raw,
    },
    ts: input.ts ?? Date.now(),
  }
}
