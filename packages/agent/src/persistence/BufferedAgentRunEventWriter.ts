import type { AgentEvent } from '@/packages/agent-protocol'
import type {
  AgentRunEventRecord,
  AgentRunRepository,
} from './AgentRunRepository'

export interface BufferedAgentRunEventWriterOptions {
  flushIntervalMs?: number
  maxBatchSize?: number
  compactHighFrequencyEvents?: boolean
  onFlush?: (runId: string, records: AgentRunEventRecord[]) => void | Promise<void>
}

interface PendingRunEvents {
  events: AgentEvent[]
  timer: ReturnType<typeof setTimeout> | null
  flushing: Promise<AgentRunEventRecord[]> | null
}

const DEFAULT_FLUSH_INTERVAL_MS = 250
const DEFAULT_MAX_BATCH_SIZE = 32

export class BufferedAgentRunEventWriter {
  private readonly pendingByRun = new Map<string, PendingRunEvents>()
  private readonly flushIntervalMs: number
  private readonly maxBatchSize: number
  private readonly compactHighFrequencyEvents: boolean
  private readonly onFlush?: (runId: string, records: AgentRunEventRecord[]) => void | Promise<void>

  constructor(
    private readonly repository: AgentRunRepository,
    options: BufferedAgentRunEventWriterOptions = {},
  ) {
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS
    this.maxBatchSize = options.maxBatchSize ?? DEFAULT_MAX_BATCH_SIZE
    this.compactHighFrequencyEvents = options.compactHighFrequencyEvents ?? true
    this.onFlush = options.onFlush
  }

  async append(runId: string, event: AgentEvent): Promise<AgentRunEventRecord[]> {
    const pending = this.pendingForRun(runId)
    pending.events.push(event)

    if (shouldBufferEvent(event) && pending.events.length < this.maxBatchSize) {
      this.scheduleFlush(runId, pending)
      return []
    }

    return this.flushRun(runId)
  }

  async flushRun(runId: string): Promise<AgentRunEventRecord[]> {
    const pending = this.pendingByRun.get(runId)
    if (!pending) return []
    if (pending.flushing) return pending.flushing

    const events = pending.events.splice(0)
    this.clearTimer(pending)
    if (events.length === 0) {
      this.pendingByRun.delete(runId)
      return []
    }

    const writeEvents = this.compactHighFrequencyEvents
      ? compactBufferedEvents(events)
      : events

    pending.flushing = this.repository.appendEvents(runId, writeEvents)
      .then(async records => {
        if (this.onFlush && records.length > 0) {
          await this.onFlush(runId, records)
        }
        return records
      })
      .finally(() => {
        pending.flushing = null
        if (pending.events.length === 0) {
          this.pendingByRun.delete(runId)
        } else {
          this.scheduleFlush(runId, pending)
        }
      })

    return pending.flushing
  }

  async flushAll(): Promise<AgentRunEventRecord[]> {
    const runIds = Array.from(this.pendingByRun.keys())
    const batches = await Promise.all(runIds.map(runId => this.flushRun(runId)))
    return batches.flat()
  }

  private pendingForRun(runId: string): PendingRunEvents {
    const existing = this.pendingByRun.get(runId)
    if (existing) return existing
    const pending: PendingRunEvents = {
      events: [],
      timer: null,
      flushing: null,
    }
    this.pendingByRun.set(runId, pending)
    return pending
  }

  private scheduleFlush(runId: string, pending: PendingRunEvents): void {
    if (pending.timer) return
    pending.timer = setTimeout(() => {
      pending.timer = null
      void this.flushRun(runId)
    }, this.flushIntervalMs)
    pending.timer.unref?.()
  }

  private clearTimer(pending: PendingRunEvents): void {
    if (!pending.timer) return
    clearTimeout(pending.timer)
    pending.timer = null
  }
}

function shouldBufferEvent(event: AgentEvent): boolean {
  return event.type === 'assistant_delta' || event.type === 'model_event'
}

export function compactBufferedEvents(events: AgentEvent[]): AgentEvent[] {
  const compacted: AgentEvent[] = []
  for (const event of events) {
    const previous = compacted[compacted.length - 1]
    if (previous?.type === 'assistant_delta' && event.type === 'assistant_delta' && isSameAssistantDeltaStream(previous, event)) {
      compacted[compacted.length - 1] = {
        ...event,
        text: `${previous.text}${event.text}`,
        raw: compactRaw(previous.raw, event.raw),
      }
      continue
    }
    compacted.push(event)
  }
  return compacted
}

function isSameAssistantDeltaStream(
  previous: Extract<AgentEvent, { type: 'assistant_delta' }>,
  event: Extract<AgentEvent, { type: 'assistant_delta' }>,
): boolean {
  return previous.runId === event.runId &&
    previous.requestId === event.requestId &&
    previous.schemaVersion === event.schemaVersion &&
    previous.origin?.framework === event.origin?.framework &&
    previous.origin?.runtimeId === event.origin?.runtimeId
}

function compactRaw(previous: unknown, next: unknown): unknown {
  if (previous === undefined && next === undefined) return undefined
  return {
    compacted: true,
    previous,
    next,
  }
}
