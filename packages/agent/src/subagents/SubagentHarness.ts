/**
 * SubagentHarness — concurrency-bounded lifecycle manager around SubagentRunner.
 *
 * Inspired by pi-subagents AgentManager (concurrency queue, spawn / spawnAndWait
 * / abort / abortAll) but with a deliberately smaller surface:
 *
 *   - No persistent AgentSession (telegraph RuntimeExecutor.run() is one-shot).
 *   - No worktree / fs isolation (host pagelet decides via FilesystemCapability).
 *   - No compaction loop (subagents are intended to be short-lived).
 *   - No scheduling / cron (out of scope per D-016 §6.4).
 *
 * Per-pagelet single instance. Wired into AgentHarnessOptions in D-016 P3.
 */

import type { RuntimeEvent } from '@/packages/agent-protocol'
import type { SubagentRegistry } from './SubagentRegistry'
import { SubagentRunner, type ChildRuntimeFactory, type ChildToolProvider, type SubagentRunnerOptions } from './SubagentRunner'
import type { SubagentHarnessOptions, SubagentInvocation, SubagentRecord, SubagentStatus } from './types'

export interface SubagentHarnessDependencies {
  registry: SubagentRegistry
  childRuntimeFactory: ChildRuntimeFactory
  toolProvider?: ChildToolProvider
  /** Subscriber callback invoked for every event flowing through any subagent. */
  onEvent?: (event: RuntimeEvent, record: SubagentRecord) => void
  /** Lifecycle observer (status transitions). */
  onStatusChange?: (record: SubagentRecord) => void
  /** Clock — injectable for tests. */
  now?: () => number
}

interface QueueItem {
  record: SubagentRecord
  invocation: SubagentInvocation
  resolve: (record: SubagentRecord) => void
  reject: (err: Error) => void
  /** Whether the caller wants the resolved promise to wait for completion. */
  awaitCompletion: boolean
}

const DEFAULT_MAX_CONCURRENCY = 4

export class SubagentHarness {
  private readonly queue: QueueItem[] = []
  private readonly active = new Map<string, { item: QueueItem; runner: ReturnType<SubagentRunner['execute']> }>()
  private readonly records = new Map<string, SubagentRecord>()
  private readonly maxConcurrency: number
  private readonly now: () => number
  private invocationSeq = 0

  constructor(
    private readonly deps: SubagentHarnessDependencies,
    private readonly options: SubagentHarnessOptions = {},
  ) {
    this.maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY
    this.now = deps.now ?? Date.now
  }

  /**
   * Enqueue an invocation. Resolves immediately with a 'queued' SubagentRecord.
   * Use spawnAndWait() to await the final 'completed'/'failed'/'cancelled' record.
   */
  spawn(invocation: SubagentInvocation): SubagentRecord {
    const profile = this.deps.registry.get(invocation.profileName)
    if (!profile) {
      throw new Error(`Unknown subagent profile "${invocation.profileName}"`)
    }
    const record: SubagentRecord = {
      invocationId: `inv-${++this.invocationSeq}`,
      childRunId: '', // set on dequeue
      profile,
      status: 'queued',
      queuedAt: this.now(),
    }
    this.records.set(record.invocationId, record)
    this.deps.onStatusChange?.(record)

    // For fire-and-forget callers we still enqueue, but resolve their promise
    // on completion. spawn() itself is sync — the promise variant is spawnAndWait().
    this.queue.push({
      record,
      invocation,
      resolve: () => {},
      reject: () => {},
      awaitCompletion: false,
    })
    queueMicrotask(() => this.pump())
    return record
  }

  /**
   * Enqueue and await completion. Resolves with the terminal record.
   * Honors invocation.joinMode === 'detach' by returning the queued record
   * without awaiting completion.
   */
  spawnAndWait(invocation: SubagentInvocation): Promise<SubagentRecord> {
    const profile = this.deps.registry.get(invocation.profileName)
    if (!profile) {
      return Promise.reject(new Error(`Unknown subagent profile "${invocation.profileName}"`))
    }
    const record: SubagentRecord = {
      invocationId: `inv-${++this.invocationSeq}`,
      childRunId: '',
      profile,
      status: 'queued',
      queuedAt: this.now(),
    }
    this.records.set(record.invocationId, record)
    this.deps.onStatusChange?.(record)

    if (invocation.joinMode === 'detach') {
      this.queue.push({ record, invocation, resolve: () => {}, reject: () => {}, awaitCompletion: false })
      queueMicrotask(() => this.pump())
      return Promise.resolve(record)
    }

    return new Promise<SubagentRecord>((resolve, reject) => {
      this.queue.push({ record, invocation, resolve, reject, awaitCompletion: true })
      queueMicrotask(() => this.pump())
    })
  }

  abort(invocationId: string, reason = 'caller-abort'): boolean {
    const active = this.active.get(invocationId)
    if (active) {
      active.runner.abort(reason)
      return true
    }
    const queuedIdx = this.queue.findIndex(q => q.record.invocationId === invocationId)
    if (queuedIdx !== -1) {
      const [item] = this.queue.splice(queuedIdx, 1)
      this.transition(item.record, 'cancelled', { cancelReason: reason })
      item.resolve(item.record)
      return true
    }
    return false
  }

  abortAll(reason = 'parent-abort'): void {
    for (const id of [...this.active.keys()]) this.abort(id, reason)
    while (this.queue.length > 0) {
      const item = this.queue.shift()!
      this.transition(item.record, 'cancelled', { cancelReason: reason })
      item.resolve(item.record)
    }
  }

  getRecord(invocationId: string): SubagentRecord | undefined {
    return this.records.get(invocationId)
  }

  listRecords(): SubagentRecord[] {
    return [...this.records.values()]
  }

  private pump(): void {
    while (this.active.size < this.maxConcurrency && this.queue.length > 0) {
      const item = this.queue.shift()!
      this.startOne(item)
    }
  }

  private startOne(item: QueueItem): void {
    const runnerOptions: SubagentRunnerOptions = {
      parentSettings: {}, // parentSettings is established per-spawn via metadata.parentSettings if available
      childRuntimeFactory: this.deps.childRuntimeFactory,
      toolProvider: this.deps.toolProvider,
      defaultTurnBudget: this.options.defaultTurnBudget,
      defaultGraceTurns: this.options.defaultGraceTurns,
      now: this.now,
    }
    // Allow caller to pass parentSettings via metadata for inheritance.
    const inheritedSettings = (item.invocation.metadata?.parentSettings ?? {}) as Record<string, unknown>
    runnerOptions.parentSettings = inheritedSettings as typeof runnerOptions.parentSettings

    const runner = new SubagentRunner(runnerOptions)
    const exec = runner.execute(item.invocation, item.record.profile)
    item.record.childRunId = exec.childRunId
    this.transition(item.record, 'running', { startedAt: this.now() })
    this.active.set(item.record.invocationId, { item, runner: exec })

    // Drive the stream off-microtask so spawn() returns synchronously.
    void this.drain(item, exec)
  }

  private async drain(item: QueueItem, exec: ReturnType<SubagentRunner['execute']>): Promise<void> {
    try {
      for await (const event of exec.stream) {
        this.deps.onEvent?.(event, item.record)
        // Snapshot terminal info as it streams.
        if (event.type === 'run_completed') {
          item.record.output = event.output
        } else if (event.type === 'run_failed') {
          item.record.error = { code: event.error?.code, message: event.error?.message ?? 'unknown' }
        } else if (event.type === 'run_cancelled') {
          item.record.cancelReason ??= event.reason
        }
      }
      const finalStatus: SubagentStatus =
        item.record.error
          ? 'failed'
          : item.record.cancelReason
            ? 'cancelled'
            : 'completed'
      this.transition(item.record, finalStatus, { finishedAt: this.now() })
      item.resolve(item.record)
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      item.record.error = { message: error.message }
      this.transition(item.record, 'failed', { finishedAt: this.now() })
      item.reject(error)
    } finally {
      this.active.delete(item.record.invocationId)
      queueMicrotask(() => this.pump())
    }
  }

  private transition(record: SubagentRecord, status: SubagentStatus, patch: Partial<SubagentRecord> = {}): void {
    record.status = status
    Object.assign(record, patch)
    this.deps.onStatusChange?.(record)
  }
}
