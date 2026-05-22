import type {
  DesignAgentRunRecordSnapshot,
  DesignAgentStreamEvent,
} from '@/apps/design/application/common'
import type { AgentEvent } from '@/packages/agent-protocol'

export class DesignRunStore {
  private readonly records = new Map<string, DesignAgentRunRecordSnapshot>()
  private readonly maxRecords: number

  constructor(options: { maxRecords?: number } = {}) {
    this.maxRecords = options.maxRecords ?? 100
  }

  start(input: {
    runId: string
    sessionId?: string
    prompt: string
  }): void {
    const now = Date.now()
    this.records.set(input.runId, {
      runId: input.runId,
      sessionId: input.sessionId,
      prompt: input.prompt,
      status: 'running',
      startedAt: now,
      updatedAt: now,
      events: [],
    })
    this.trim()
  }

  append(event: DesignAgentStreamEvent): void {
    const record = this.records.get(event.runId)
    if (!record) return
    record.events.push(summarizeStreamEvent(event))
    record.updatedAt = Date.now()

    if (event.type === 'run_failed') {
      record.status = event.error === 'Cancelled' ? 'cancelled' : 'failed'
      record.error = event.error
      record.completedAt = record.updatedAt
      return
    }

    if (event.type !== 'agent_event') return
    if (event.event.type === 'run_completed') {
      record.status = 'completed'
      record.completedAt = record.updatedAt
    } else if (event.event.type === 'run_failed') {
      record.status = 'failed'
      record.error = event.event.error.message
      record.completedAt = record.updatedAt
    } else if (event.event.type === 'run_cancelled') {
      record.status = 'cancelled'
      record.completedAt = record.updatedAt
    }
  }

  complete(runId: string, status: DesignAgentRunRecordSnapshot['status'], error?: string): void {
    const record = this.records.get(runId)
    if (!record) return
    record.status = status
    record.error = error
    record.updatedAt = Date.now()
    record.completedAt = record.updatedAt
  }

  list(): DesignAgentRunRecordSnapshot[] {
    return [...this.records.values()]
      .map(cloneRecord)
      .sort((a, b) => b.startedAt - a.startedAt)
  }

  get(runId: string): DesignAgentRunRecordSnapshot | null {
    const record = this.records.get(runId)
    return record ? cloneRecord(record) : null
  }

  private trim(): void {
    const records = this.list()
    for (const record of records.slice(this.maxRecords)) {
      this.records.delete(record.runId)
    }
  }
}

function summarizeStreamEvent(event: DesignAgentStreamEvent): DesignAgentRunRecordSnapshot['events'][number] {
  if (event.type === 'run_queued') {
    return {
      type: 'run_queued',
      ts: Date.now(),
    }
  }
  if (event.type === 'run_failed') {
    return {
      type: 'run_failed',
      ts: Date.now(),
      label: event.error,
    }
  }
  if (event.type === 'subagent_updated') {
    return {
      type: 'subagent_updated',
      ts: Date.now(),
      label: `${event.subagent.label}: ${event.subagent.status}`,
    }
  }
  return {
    type: event.event.type,
    ts: event.event.ts,
    label: labelFromAgentEvent(event.event),
  }
}

function labelFromAgentEvent(event: AgentEvent): string | undefined {
  switch (event.type) {
    case 'step_started':
      return event.label
    case 'step_completed':
      return event.stepId
    case 'child_run_started':
      return event.label ?? event.childRunId
    case 'child_run_completed':
      return event.childRunId
    case 'assistant_delta':
      return event.text
    case 'run_failed':
      return event.error.message
    case 'run_cancelled':
      return event.reason
    default:
      return undefined
  }
}

function cloneRecord(record: DesignAgentRunRecordSnapshot): DesignAgentRunRecordSnapshot {
  return {
    ...record,
    events: record.events.map(event => ({ ...event })),
  }
}
