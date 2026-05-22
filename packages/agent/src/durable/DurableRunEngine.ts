import type { AgentEvent, RuntimeError, StepKind } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { durableIdempotencyKey } from './idempotency'

export type DurableStepKind = 'llm_call' | 'tool_call' | 'artifact_patch' | 'custom'
export type DurableStepStatus = 'running' | 'completed' | 'failed'

export interface DurableStepDefinition<Input = unknown> {
  stepId: string
  label: string
  kind: DurableStepKind
  input?: Input
  callId?: string
  idempotencyKey?: string
}

export interface DurableStepRecord<Output = unknown> {
  idempotencyKey: string
  runId: string
  stepId: string
  callId?: string
  status: DurableStepStatus
  output?: Output
  error?: RuntimeError
  startedAt: number
  completedAt?: number
}

export interface DurableStepLedger {
  get<Output = unknown>(idempotencyKey: string): Promise<DurableStepRecord<Output> | null>
  put(record: DurableStepRecord): Promise<void>
}

export interface DurableStepExecutionContext {
  runId: string
  step: DurableStepDefinition
  idempotencyKey: string
  signal?: AbortSignal
}

export interface DurableRunEngine {
  executeStep<Output>(
    context: DurableStepExecutionContext,
    executor: () => Promise<Output>,
  ): Promise<DurableStepExecutionResult<Output>>
}

export interface DurableStepExecutionResult<Output = unknown> {
  record: DurableStepRecord<Output>
  events: AgentEvent[]
  reused: boolean
}

export interface DurableRunEngineOptions {
  ledger: DurableStepLedger
  now?: () => number
}

export class LedgerBackedDurableRunEngine implements DurableRunEngine {
  private readonly now: () => number

  constructor(private readonly options: DurableRunEngineOptions) {
    this.now = options.now ?? Date.now
  }

  async executeStep<Output>(
    context: DurableStepExecutionContext,
    executor: () => Promise<Output>,
  ): Promise<DurableStepExecutionResult<Output>> {
    const existing = await this.options.ledger.get<Output>(context.idempotencyKey)
    if (existing?.status === 'completed') {
      return {
        record: existing,
        reused: true,
        events: [
          durableStepReusedEvent(context, existing, this.now()),
          durableStepCompletedEvent(context, existing.output, existing.completedAt ?? this.now(), true),
        ],
      }
    }

    const startedAt = this.now()
    await this.options.ledger.put({
      idempotencyKey: context.idempotencyKey,
      runId: context.runId,
      stepId: context.step.stepId,
      callId: context.step.callId,
      status: 'running',
      startedAt,
    })

    try {
      const output = await executor()
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
      await this.options.ledger.put(record)
      return {
        record,
        reused: false,
        events: [
          durableStepStartedEvent(context, startedAt),
          durableStepCompletedEvent(context, output, completedAt, false),
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
      await this.options.ledger.put(record)
      return {
        record,
        reused: false,
        events: [
          durableStepStartedEvent(context, startedAt),
          durableStepFailedEvent(context, runtimeError, completedAt),
        ],
      }
    }
  }
}

export class InMemoryDurableStepLedger implements DurableStepLedger {
  private readonly records = new Map<string, DurableStepRecord>()

  get<Output = unknown>(idempotencyKey: string): Promise<DurableStepRecord<Output> | null> {
    const record = this.records.get(idempotencyKey)
    return Promise.resolve(record ? structuredClone(record) as DurableStepRecord<Output> : null)
  }

  put(record: DurableStepRecord): Promise<void> {
    this.records.set(record.idempotencyKey, structuredClone(record))
    return Promise.resolve()
  }
}

export function createDurableStepContext(input: {
  runId: string
  step: DurableStepDefinition
  signal?: AbortSignal
}): DurableStepExecutionContext {
  return {
    runId: input.runId,
    step: input.step,
    idempotencyKey: input.step.idempotencyKey ?? durableIdempotencyKey({
      runId: input.runId,
      stepId: input.step.stepId,
      callId: input.step.callId,
    }),
    signal: input.signal,
  }
}

function durableStepStartedEvent(context: DurableStepExecutionContext, ts: number): AgentEvent {
  return {
    type: 'step_started',
    runId: context.runId,
    stepId: context.step.stepId,
    label: context.step.label,
    kind: durableStepKind(context.step.kind),
    ts,
    raw: durableRaw(context),
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    origin: { framework: 'telegraph', runtimeId: 'durable-run-engine' },
  }
}

function durableStepCompletedEvent(
  context: DurableStepExecutionContext,
  output: unknown,
  ts: number,
  reused: boolean,
): AgentEvent {
  return {
    type: 'step_completed',
    runId: context.runId,
    stepId: context.step.stepId,
    output,
    ts,
    raw: {
      ...durableRaw(context),
      reused,
    },
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    origin: { framework: 'telegraph', runtimeId: 'durable-run-engine' },
  }
}

function durableStepFailedEvent(
  context: DurableStepExecutionContext,
  error: RuntimeError,
  ts: number,
): AgentEvent {
  return {
    type: 'runtime_log',
    level: 'error',
    message: `Durable step failed: ${context.step.label}`,
    runId: context.runId,
    ts,
    raw: {
      ...durableRaw(context),
      error,
    },
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    origin: { framework: 'telegraph', runtimeId: 'durable-run-engine' },
  }
}

function durableStepReusedEvent(
  context: DurableStepExecutionContext,
  record: DurableStepRecord,
  ts: number,
): AgentEvent {
  return {
    type: 'runtime_log',
    level: 'info',
    message: `Reused durable step result: ${context.step.label}`,
    runId: context.runId,
    ts,
    raw: {
      ...durableRaw(context),
      completedAt: record.completedAt,
      reused: true,
    },
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    origin: { framework: 'telegraph', runtimeId: 'durable-run-engine' },
  }
}

function durableRaw(context: DurableStepExecutionContext): Record<string, unknown> {
  return {
    durable: {
      kind: context.step.kind,
      idempotencyKey: context.idempotencyKey,
      callId: context.step.callId,
      input: context.step.input,
    },
  }
}

function durableStepKind(kind: DurableStepKind): StepKind {
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
