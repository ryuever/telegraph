import type {
  DesignAgentRunRecordSnapshot,
  DesignAgentStreamEvent,
  DesignSubagentRecordSnapshot,
} from '@/apps/design/application/common'
import type { AgentEvent } from '@/packages/agent-protocol'
import { AgentRunControl } from '@/packages/agent/harness'
import { SubagentManager } from '@/extensions/telegraph-subagents/src/SubagentManager'
import type { SubagentRecord } from '@/extensions/telegraph-subagents/src/types'
import { DesignRunStore } from './DesignRunStore'

export interface DesignHarnessRunHandle {
  runId: string
  sessionId: string
  signal: AbortSignal
}

export class DesignHarnessRunController {
  private readonly runControl = new AgentRunControl<DesignAgentStreamEvent>()
  private readonly runtimeSubagents = new Map<string, DesignSubagentRecordSnapshot>()
  private readonly runStore = new DesignRunStore()
  readonly subagents: SubagentManager

  constructor() {
    this.subagents = new SubagentManager({
      onCreate: record => {
        this.emitSubagentRecord(record)
      },
      onUpdate: record => {
        this.emitSubagentRecord(record)
      },
      onStart: record => {
        this.emitSubagentRecord(record)
      },
      onComplete: record => {
        this.emitSubagentRecord(record)
      },
    })
  }

  subscribe(callback: (event: DesignAgentStreamEvent) => void): { unsubscribe: () => void } {
    return this.runControl.subscribe(callback)
  }

  startRun(input: {
    runId: string
    sessionId: string
    prompt: string
  }): DesignHarnessRunHandle {
    const run = this.runControl.startRun(input)
    this.clearRuntimeSubagentsForRun(input.runId)
    this.runStore.start(input)
    this.emitAgentEvent({
      type: 'run_queued',
      runId: input.runId,
      sessionId: input.sessionId,
    })

    return {
      runId: run.runId,
      sessionId: input.sessionId,
      signal: run.signal,
    }
  }

  cancelRun(runId: string): boolean {
    return this.runControl.cancelRun(runId)
  }

  finishRun(runId: string): void {
    this.runControl.finishRun(runId)
  }

  emitAgentEvent(event: DesignAgentStreamEvent): void {
    this.runStore.append(event)
    this.runControl.emit(event)
    if (event.type === 'agent_event') {
      this.observeRuntimeSubagentEvent(event.runId, event.sessionId, event.event)
    }
  }

  completeRun(runId: string, status: DesignAgentRunRecordSnapshot['status'], error?: string): void {
    this.runStore.complete(runId, status, error)
  }

  listRuns(): DesignAgentRunRecordSnapshot[] {
    return this.runStore.list()
  }

  getRun(runId: string): DesignAgentRunRecordSnapshot | null {
    return this.runStore.get(runId)
  }

  listSubagents(): DesignSubagentRecordSnapshot[] {
    const snapshots = new Map<string, DesignSubagentRecordSnapshot>()
    for (const snapshot of this.runtimeSubagents.values()) {
      snapshots.set(snapshot.id, snapshot)
    }
    for (const snapshot of this.subagents.listRecords().map(snapshotSubagentRecord)) {
      snapshots.set(snapshot.id, snapshot)
    }
    return [...snapshots.values()].sort((a, b) => b.startedAt - a.startedAt)
  }

  getSubagentResult(childRunId: string, consume: boolean): DesignSubagentRecordSnapshot | null {
    const managedRecord = this.subagents.getResult(childRunId, { consume })
    const managed = snapshotNullableSubagentRecord(managedRecord)
    if (managed) {
      if (consume && managedRecord) this.emitSubagentRecord(managedRecord)
      return managed
    }

    const runtime = this.runtimeSubagents.get(childRunId)
    if (!runtime) return null
    if (!consume) return { ...runtime }
    const consumed = { ...runtime, resultConsumed: true }
    this.runtimeSubagents.set(childRunId, consumed)
    this.emitAgentEvent({
      type: 'subagent_updated',
      runId: consumed.parentRunId,
      subagent: consumed,
    })
    return { ...consumed }
  }

  cancelSubagent(childRunId: string): boolean {
    const cancelled = this.subagents.abort(childRunId)
    const record = this.subagents.getRecord(childRunId)
    if (record) this.emitSubagentRecord(record)
    return cancelled
  }

  private emitSubagentRecord(record: SubagentRecord): void {
    this.emitAgentEvent({
      type: 'subagent_updated',
      runId: record.parentRunId,
      sessionId: record.sessionId,
      subagent: snapshotSubagentRecord(record),
    })
  }

  private observeRuntimeSubagentEvent(runId: string, sessionId: string | undefined, event: AgentEvent): void {
    const snapshot = runtimeSubagentSnapshotFromEvent(this.runtimeSubagents, event, sessionId)
    if (!snapshot) return
    this.runtimeSubagents.set(snapshot.id, snapshot)
    this.emitAgentEvent({
      type: 'subagent_updated',
      runId,
      sessionId,
      subagent: snapshot,
    })
  }

  private clearRuntimeSubagentsForRun(runId: string): void {
    for (const [childRunId, snapshot] of this.runtimeSubagents) {
      if (snapshot.parentRunId === runId) {
        this.runtimeSubagents.delete(childRunId)
      }
    }
  }
}

function snapshotNullableSubagentRecord(record: SubagentRecord | undefined): DesignSubagentRecordSnapshot | null {
  return record ? snapshotSubagentRecord(record) : null
}

export function snapshotSubagentRecord(record: SubagentRecord): DesignSubagentRecordSnapshot {
  return {
    id: record.id,
    parentRunId: record.parentRunId,
    sessionId: record.sessionId,
    agent: record.agent,
    label: record.label,
    description: record.description,
    task: record.task,
    status: record.status,
    result: record.result,
    error: record.error,
    toolUses: record.toolUses,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    resultConsumed: record.resultConsumed,
  }
}

function runtimeSubagentSnapshotFromEvent(
  existing: Map<string, DesignSubagentRecordSnapshot>,
  event: AgentEvent,
  sessionId: string | undefined,
): DesignSubagentRecordSnapshot | null {
  switch (event.type) {
    case 'child_run_started': {
      const raw = childRaw(event.raw)
      const profile = childProfile(raw?.profile)
      return {
        id: event.childRunId,
        parentRunId: event.parentRunId,
        sessionId,
        agent: profile?.title ?? raw?.profileId ?? event.label ?? event.childRunId,
        label: event.label ?? profile?.title ?? raw?.profileId ?? event.childRunId,
        description: profile?.description ?? raw?.stage ?? event.label ?? event.childRunId,
        task: raw?.stage ?? event.label ?? event.childRunId,
        status: 'running',
        toolUses: 0,
        startedAt: event.ts,
      }
    }
    case 'child_run_completed': {
      const previous = existing.get(event.childRunId)
      return {
        id: event.childRunId,
        parentRunId: event.parentRunId,
        sessionId: previous?.sessionId ?? sessionId,
        agent: previous?.agent ?? event.childRunId,
        label: previous?.label ?? event.childRunId,
        description: previous?.description ?? event.childRunId,
        task: previous?.task ?? event.childRunId,
        status: 'completed',
        result: summarizeRuntimeSubagentOutput(event.output),
        toolUses: previous?.toolUses ?? 0,
        startedAt: previous?.startedAt ?? event.ts,
        completedAt: event.ts,
        resultConsumed: previous?.resultConsumed,
      }
    }
    case 'tool_call': {
      if (!event.runId) return null
      const previous = existing.get(event.runId)
      if (!previous) return null
      return {
        ...previous,
        toolUses: previous.toolUses + 1,
      }
    }
    case 'run_failed': {
      const previous = existing.get(event.runId)
      if (!previous) return null
      return {
        ...previous,
        status: 'error',
        error: event.error.message,
        completedAt: event.ts,
      }
    }
    case 'run_cancelled': {
      const previous = existing.get(event.runId)
      if (!previous) return null
      return {
        ...previous,
        status: 'stopped',
        completedAt: event.ts,
      }
    }
    default:
      return null
  }
}

function childRaw(value: unknown): {
  profileId?: string
  stage?: string
  profile?: unknown
} | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  return {
    profileId: stringField(record, 'profileId'),
    stage: stringField(record, 'stage'),
    profile: record.profile,
  }
}

function childProfile(value: unknown): {
  title?: string
  description?: string
} | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  return {
    title: stringField(record, 'title'),
    description: stringField(record, 'description'),
  }
}

function summarizeRuntimeSubagentOutput(output: unknown): string | undefined {
  if (typeof output === 'string') return truncateRuntimeSubagentOutput(output)
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined
  const record = output as Record<string, unknown>
  const text = stringField(record, 'text')
  if (text) return truncateRuntimeSubagentOutput(text)

  const review = record.review
  if (review && typeof review === 'object' && !Array.isArray(review)) {
    const verdict = stringField(review as Record<string, unknown>, 'verdict')
    return verdict ? `review ${verdict}` : undefined
  }

  const artifact = record.artifact
  if (artifact && typeof artifact === 'object' && !Array.isArray(artifact)) {
    const artifactRecord = artifact as Record<string, unknown>
    return [stringField(artifactRecord, 'kind'), stringField(artifactRecord, 'title')]
      .filter(Boolean)
      .join(' / ') || undefined
  }

  return [
    stringField(record, 'summary'),
    stringField(record, 'kind'),
    stringField(record, 'artifactId'),
    stringField(record, 'title'),
  ].filter(Boolean).join(' / ') || undefined
}

function truncateRuntimeSubagentOutput(value: string): string {
  return value.length > 240 ? `${value.slice(0, 237)}...` : value
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
