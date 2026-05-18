import type { AgentEvent, RuntimeError, RuntimeOrigin } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { BaseAgentRuntime, type RuntimeInput } from '@/packages/agent/runtime/AgentRuntime'
import {
  createCheckpointEvent,
  createEdgeTakenEvent,
  createInterruptEvent,
  createNodeCompletedEvent,
  createNodeStartedEvent,
  type CheckpointHookInput,
  type EdgeTakenHookInput,
  type InterruptHookInput,
  type NodeCompletedHookInput,
  type NodeHookInput,
} from '@/packages/agent/runtime/observability/orchestratorObservability'

export const TELEGRAPH_ORCHESTRATOR_PRODUCER_VERSION = '0.1.0'

export type TelegraphOrchestratorSignal =
  | ({ type: 'node_started' } & Omit<NodeHookInput, 'runId' | 'origin'>)
  | ({ type: 'node_completed' } & Omit<NodeCompletedHookInput, 'runId' | 'origin'>)
  | ({ type: 'edge_taken' } & Omit<EdgeTakenHookInput, 'runId' | 'origin'>)
  | ({ type: 'checkpoint' } & Omit<CheckpointHookInput, 'runId' | 'origin'>)
  | ({ type: 'interrupt' } & Omit<InterruptHookInput, 'runId' | 'origin'>)
  | { type: 'agent_event'; event: AgentEvent }
  | { type: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string; raw?: unknown; ts?: number }
  | { type: 'completed'; output: unknown; raw?: unknown; ts?: number }
  | { type: 'failed'; error: RuntimeError | Error | string; raw?: unknown; ts?: number }

export interface TelegraphOrchestratorRunner {
  run(input: RuntimeInput): AsyncIterable<TelegraphOrchestratorSignal>
}

export interface TelegraphOrchestratorRuntimeOptions {
  runner: TelegraphOrchestratorRunner
  origin?: RuntimeOrigin
}

export class TelegraphOrchestratorRuntime extends BaseAgentRuntime {
  readonly id = 'telegraph-orchestrator'
  readonly label = 'Telegraph Orchestrator Adapter'

  private readonly runner: TelegraphOrchestratorRunner
  private readonly origin: RuntimeOrigin

  constructor(options: TelegraphOrchestratorRuntimeOptions) {
    super()
    this.runner = options.runner
    this.origin = options.origin ?? { framework: 'telegraph', runtimeId: this.id }
  }

  async *run(input: RuntimeInput): AsyncIterable<AgentEvent> {
    yield {
      type: 'run_started',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      producerVersion: TELEGRAPH_ORCHESTRATOR_PRODUCER_VERSION,
      origin: this.origin,
      runId: input.runId,
      pattern: 'orchestrator_workers',
      ts: this.now(),
    }

    try {
      for await (const signal of this.runner.run(input)) {
        if (input.signal?.aborted) {
          yield this.cancelled(input.runId)
          return
        }

        const event = this.signalToEvent(signal, input.runId)
        yield event

        if (event.type === 'run_completed' || event.type === 'run_failed' || event.type === 'run_cancelled') {
          return
        }
      }

      yield {
        type: 'run_completed',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        producerVersion: TELEGRAPH_ORCHESTRATOR_PRODUCER_VERSION,
        origin: this.origin,
        runId: input.runId,
        output: null,
        ts: this.now(),
      }
    } catch (error) {
      yield this.failed(input.runId, error)
    }
  }

  private signalToEvent(signal: TelegraphOrchestratorSignal, runId: string): AgentEvent {
    switch (signal.type) {
      case 'node_started':
        return createNodeStartedEvent({ ...signal, runId, origin: this.origin })
      case 'node_completed':
        return createNodeCompletedEvent({ ...signal, runId, origin: this.origin })
      case 'edge_taken':
        return createEdgeTakenEvent({ ...signal, runId, origin: this.origin })
      case 'checkpoint':
        return createCheckpointEvent({ ...signal, runId, origin: this.origin })
      case 'interrupt':
        return createInterruptEvent({ ...signal, runId, origin: this.origin })
      case 'agent_event':
        return signal.event
      case 'log':
        return {
          type: 'runtime_log',
          schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
          producerVersion: TELEGRAPH_ORCHESTRATOR_PRODUCER_VERSION,
          origin: this.origin,
          runId,
          level: signal.level,
          message: signal.message,
          raw: signal.raw,
          ts: signal.ts ?? this.now(),
        }
      case 'completed':
        return {
          type: 'run_completed',
          schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
          producerVersion: TELEGRAPH_ORCHESTRATOR_PRODUCER_VERSION,
          origin: this.origin,
          runId,
          output: signal.output,
          raw: signal.raw,
          ts: signal.ts ?? this.now(),
        }
      case 'failed':
        return this.failed(runId, signal.error, signal.raw, signal.ts)
      default:
        return {
          type: 'runtime_log',
          schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
          producerVersion: TELEGRAPH_ORCHESTRATOR_PRODUCER_VERSION,
          origin: this.origin,
          runId,
          level: 'warn',
          message: 'unknown_orchestrator_signal',
          raw: signal,
          ts: this.now(),
        }
    }
  }

  private cancelled(runId: string): AgentEvent {
    return {
      type: 'run_cancelled',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      producerVersion: TELEGRAPH_ORCHESTRATOR_PRODUCER_VERSION,
      origin: this.origin,
      runId,
      reason: 'Cancelled',
      ts: this.now(),
    }
  }

  private failed(runId: string, error: RuntimeError | Error | string | unknown, raw?: unknown, ts?: number): AgentEvent {
    return {
      type: 'run_failed',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      producerVersion: TELEGRAPH_ORCHESTRATOR_PRODUCER_VERSION,
      origin: this.origin,
      runId,
      error: normalizeRuntimeError(error),
      raw,
      ts: ts ?? this.now(),
    }
  }
}

function normalizeRuntimeError(error: RuntimeError | Error | string | unknown): RuntimeError {
  if (isRuntimeError(error)) return error
  if (error instanceof Error) {
    return {
      code: 'telegraph_orchestrator_error',
      message: error.message,
      details: { name: error.name, message: error.message },
    }
  }
  return {
    code: 'telegraph_orchestrator_error',
    message: typeof error === 'string' ? error : String(error),
  }
}

function isRuntimeError(error: unknown): error is RuntimeError {
  if (!error || typeof error !== 'object') return false
  const candidate = error as Partial<RuntimeError>
  return typeof candidate.code === 'string' && typeof candidate.message === 'string'
}
