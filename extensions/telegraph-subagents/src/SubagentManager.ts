import type { RuntimeEvent } from '@/packages/agent-protocol'
import type { SubagentDefinition, SubagentRecord, SubagentStatus } from './types'
import {
  StreamingSubagentRunner,
  type SubagentRunRequest,
  type SubagentRunner,
} from './SubagentRunner'

export interface SubagentManagerOptions {
  runner?: SubagentRunner
  maxConcurrent?: number
  onStart?: (record: SubagentRecord) => void
  onComplete?: (record: SubagentRecord) => void
}

export interface SpawnSubagentInput {
  parentRunId: string
  childRunId: string
  label?: string
  agent: SubagentDefinition
  task: string
  settings: SubagentRunRequest['settings']
  sessionId?: string
  signal?: AbortSignal
  modelOverride?: string
}

export class SubagentManager {
  private readonly runner: SubagentRunner
  private readonly records = new Map<string, SubagentRecord>()
  private readonly onStart?: (record: SubagentRecord) => void
  private readonly onComplete?: (record: SubagentRecord) => void
  private maxConcurrent: number
  private active = 0
  private readonly queue: Array<() => void> = []

  constructor(options: SubagentManagerOptions = {}) {
    this.runner = options.runner ?? new StreamingSubagentRunner()
    this.maxConcurrent = options.maxConcurrent ?? 4
    this.onStart = options.onStart
    this.onComplete = options.onComplete
  }

  getRecord(id: string): SubagentRecord | undefined {
    return this.records.get(id)
  }

  listRecords(): SubagentRecord[] {
    return [...this.records.values()].sort((a, b) => b.startedAt - a.startedAt)
  }

  setMaxConcurrent(value: number): void {
    this.maxConcurrent = Math.max(1, Math.floor(value))
    this.drainQueue()
  }

  abort(id: string): boolean {
    const record = this.records.get(id)
    if (!record || isTerminal(record.status)) return false
    record.abortController.abort()
    record.status = 'stopped'
    record.completedAt = Date.now()
    return true
  }

  getResult(id: string, options: { consume?: boolean } = {}): SubagentRecord | undefined {
    const record = this.records.get(id)
    if (record && options.consume) {
      record.resultConsumed = true
    }
    return record
  }

  async *spawnAndWait(input: SpawnSubagentInput): AsyncGenerator<RuntimeEvent, SubagentRecord, void> {
    const record = this.createRecord(input, 'queued')
    await this.acquireSlot(record)

    if (record.abortController.signal.aborted) {
      record.status = 'stopped'
      record.completedAt = Date.now()
      this.releaseSlot(record)
      return record
    }

    record.status = 'running'
    record.startedAt = Date.now()
    this.onStart?.(record)

    try {
      const request: SubagentRunRequest = {
        parentRunId: input.parentRunId,
        childRunId: input.childRunId,
        label: input.label ?? input.agent.name,
        agent: input.agent,
        task: input.task,
        settings: input.settings,
        sessionId: input.sessionId,
        signal: combinedSignal(record.abortController.signal, input.signal),
        modelOverride: input.modelOverride,
      }

      for await (const event of this.runner.run(request, record)) {
        yield event
      }
    } finally {
      if (!isTerminal(record.status)) {
        record.status = record.abortController.signal.aborted ? 'stopped' : 'completed'
        record.completedAt = Date.now()
      }
      this.releaseSlot(record)
      this.onComplete?.(record)
    }

    return record
  }

  private createRecord(input: SpawnSubagentInput, status: SubagentStatus): SubagentRecord {
    const abortController = new AbortController()
    if (input.signal?.aborted) {
      abortController.abort()
    } else {
      input.signal?.addEventListener('abort', () => abortController.abort(), { once: true })
    }

    const record: SubagentRecord = {
      id: input.childRunId,
      parentRunId: input.parentRunId,
      agent: input.agent.name,
      label: input.label ?? input.agent.name,
      description: input.agent.description ?? input.agent.name,
      task: input.task,
      status,
      toolUses: 0,
      startedAt: Date.now(),
      abortController,
      sourcePath: input.agent.sourcePath,
      origin: input.agent.origin,
    }
    this.records.set(record.id, record)
    return record
  }

  private async acquireSlot(record: SubagentRecord): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active += 1
      return
    }

    record.status = 'queued'
    await new Promise<void>(resolve => {
      this.queue.push(resolve)
    })
  }

  private releaseSlot(_record: SubagentRecord): void {
    this.active = Math.max(0, this.active - 1)
    this.drainQueue()
  }

  private drainQueue(): void {
    while (this.active < this.maxConcurrent && this.queue.length > 0) {
      const resolve = this.queue.shift()
      this.active += 1
      resolve?.()
    }
  }
}

function isTerminal(status: SubagentStatus): boolean {
  return status === 'completed' || status === 'stopped' || status === 'error'
}

function combinedSignal(first: AbortSignal, second?: AbortSignal): AbortSignal {
  if (!second) return first
  if (first.aborted) return first
  if (second.aborted) return second

  const controller = new AbortController()
  const abort = () => controller.abort()
  first.addEventListener('abort', abort, { once: true })
  second.addEventListener('abort', abort, { once: true })
  return controller.signal
}
