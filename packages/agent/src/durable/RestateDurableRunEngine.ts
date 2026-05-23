import type { AgentEvent, RuntimeError, StepKind } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import type {
  DurableRunEngine,
  DurableStepExecutionContext,
  DurableStepExecutionResult,
  DurableStepRecord,
} from './DurableRunEngine'

export interface RestateDurableContext {
  run<Output>(name: string, action: () => Promise<Output>): Promise<Output>
}

export interface RestateDurableRunEngineOptions {
  context: RestateDurableContext
  now?: () => number
}

export class RestateDurableRunEngine implements DurableRunEngine {
  private readonly now: () => number

  constructor(private readonly options: RestateDurableRunEngineOptions) {
    this.now = options.now ?? Date.now
  }

  async executeStep<Output>(
    context: DurableStepExecutionContext,
    executor: () => Promise<Output>,
  ): Promise<DurableStepExecutionResult<Output>> {
    const startedAt = this.now()
    try {
      const output = await this.options.context.run(context.idempotencyKey, executor)
      const completedAt = this.now()
      const record: DurableStepRecord<Output> = pruneUndefined({
        idempotencyKey: context.idempotencyKey,
        runId: context.runId,
        stepId: context.step.stepId,
        callId: context.step.callId,
        status: 'completed' as const,
        output,
        startedAt,
        completedAt,
      })
      return {
        record,
        reused: false,
        events: [
          restateStepStartedEvent(context, startedAt),
          restateStepCompletedEvent(context, output, completedAt),
        ],
      }
    } catch (error) {
      const completedAt = this.now()
      const runtimeError = toRuntimeError(error)
      const record: DurableStepRecord<Output> = pruneUndefined({
        idempotencyKey: context.idempotencyKey,
        runId: context.runId,
        stepId: context.step.stepId,
        callId: context.step.callId,
        status: 'failed' as const,
        error: runtimeError,
        startedAt,
        completedAt,
      })
      return {
        record,
        reused: false,
        events: [
          restateStepStartedEvent(context, startedAt),
          restateStepFailedEvent(context, runtimeError, completedAt),
        ],
      }
    }
  }
}

function restateStepStartedEvent(context: DurableStepExecutionContext, ts: number): AgentEvent {
  return {
    type: 'step_started',
    runId: context.runId,
    stepId: context.step.stepId,
    label: context.step.label,
    kind: durableStepKind(context.step.kind),
    ts,
    raw: restateRaw(context),
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    origin: { framework: 'telegraph', runtimeId: 'durable-run-engine:restate' },
  }
}

function restateStepCompletedEvent(
  context: DurableStepExecutionContext,
  output: unknown,
  ts: number,
): AgentEvent {
  return {
    type: 'step_completed',
    runId: context.runId,
    stepId: context.step.stepId,
    output,
    ts,
    raw: restateRaw(context),
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    origin: { framework: 'telegraph', runtimeId: 'durable-run-engine:restate' },
  }
}

function restateStepFailedEvent(
  context: DurableStepExecutionContext,
  error: RuntimeError,
  ts: number,
): AgentEvent {
  return {
    type: 'runtime_log',
    level: 'error',
    message: `Restate durable step failed: ${context.step.label}`,
    runId: context.runId,
    ts,
    raw: {
      ...restateRaw(context),
      error,
    },
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    origin: { framework: 'telegraph', runtimeId: 'durable-run-engine:restate' },
  }
}

function restateRaw(context: DurableStepExecutionContext): Record<string, unknown> {
  return {
    durable: {
      kind: context.step.kind,
      idempotencyKey: context.idempotencyKey,
      callId: context.step.callId,
      input: context.step.input,
      adapter: 'restate',
      actionName: context.idempotencyKey,
    },
  }
}

function durableStepKind(kind: DurableStepExecutionContext['step']['kind']): StepKind {
  if (kind === 'llm_call') return 'model'
  if (kind === 'tool_call') return 'tool'
  return 'custom'
}

function toRuntimeError(error: unknown): RuntimeError {
  if (error instanceof Error) {
    return {
      message: error.message,
      code: error.name || 'Error',
      details: error.stack ? { stack: error.stack } : undefined,
    }
  }
  return {
    message: String(error),
    code: 'Error',
  }
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T
}
