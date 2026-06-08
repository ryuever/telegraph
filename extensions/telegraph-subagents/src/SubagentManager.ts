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
  onCreate?: (record: SubagentRecord) => void
  onUpdate?: (record: SubagentRecord) => void
  onStart?: (record: SubagentRecord) => void
  onComplete?: (record: SubagentRecord) => void
}

/**
 * Listener subscribing to lifecycle notifications from a `SubagentManager`.
 * Each hook is optional; the same record reference is forwarded to every
 * registered listener so consumers must not mutate it.
 *
 * Introduced in D-016 P5: when the manager is owned by the
 * `@telegraph/subagents` extension factory, pagelets attach their UI
 * pumps here instead of relying on constructor callbacks.
 */
export interface SubagentManagerListener {
  onCreate?: (record: SubagentRecord) => void
  onUpdate?: (record: SubagentRecord) => void
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
  skills?: string[]
  conversationMessages?: SubagentRunRequest['conversationMessages']
}

export class SubagentManager {
  private readonly runner: SubagentRunner
  private readonly records = new Map<string, SubagentRecord>()
  private readonly listeners = new Set<SubagentManagerListener>()
  private maxConcurrent: number
  private active = 0
  private readonly queue: Array<() => void> = []

  constructor(options: SubagentManagerOptions = {}) {
    this.runner = options.runner ?? new StreamingSubagentRunner()
    this.maxConcurrent = options.maxConcurrent ?? 4

    // Constructor callbacks are preserved as a degenerate listener for
    // backwards compatibility (pre-D-016 P5 call sites). New owners should
    // prefer `addListener()` so they can unsubscribe on teardown.
    if (options.onCreate || options.onUpdate || options.onStart || options.onComplete) {
      this.listeners.add({
        onCreate: options.onCreate,
        onUpdate: options.onUpdate,
        onStart: options.onStart,
        onComplete: options.onComplete,
      })
    }
  }

  /**
   * Subscribe to manager lifecycle events. Returns an unsubscribe function.
   *
   * Pagelets attach UI pumps here after the `@telegraph/subagents` extension
   * factory hands the manager out via `host.getCustom()`. Multiple listeners
   * may coexist; the manager iterates a snapshot per emission so listeners
   * may unsubscribe themselves during dispatch without mutating-during-iter.
   */
  addListener(listener: SubagentManagerListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
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
    this.emit('onUpdate', record)
    return true
  }

  /**
   * Abort every in-flight record and drain the pending queue. Intended for
   * extension-deactivation / pagelet-shutdown paths (D-016 P5). Records that
   * have already reached a terminal state are left untouched.
   */
  disposeAll(): void {
    for (const record of this.records.values()) {
      if (isTerminal(record.status)) continue
      record.abortController.abort()
      record.status = 'stopped'
      record.completedAt = Date.now()
      this.emit('onUpdate', record)
    }
    // Release anyone still parked on the concurrency queue so their
    // `acquireSlot` promise resolves and the calling generator can exit
    // through the `aborted` branch in `spawnAndWait`.
    while (this.queue.length > 0) {
      const resolve = this.queue.shift()
      resolve?.()
    }
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
    this.emit('onStart', record)

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
        skills: input.skills,
        conversationMessages: input.conversationMessages,
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
      this.emit('onComplete', record)
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
      sessionId: input.sessionId,
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
    this.emit('onCreate', record)
    return record
  }

  /**
   * Fan-out a lifecycle event to every registered listener. Iterates a
   * snapshot so listeners may unsubscribe themselves during dispatch.
   * Listener errors are swallowed to keep one buggy subscriber from
   * starving the others (matches the convention used elsewhere in the
   * harness for UI pumps).
   */
  private emit(
    hook: keyof SubagentManagerListener,
    record: SubagentRecord,
  ): void {
    for (const listener of [...this.listeners]) {
      try {
        listener[hook]?.(record)
      } catch {
        // Subscriber error must not break other listeners or the manager.
      }
    }
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
