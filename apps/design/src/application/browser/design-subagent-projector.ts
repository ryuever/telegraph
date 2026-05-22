import type {
  DesignAgentStreamEvent,
  DesignSubagentRecordSnapshot,
} from '@/apps/design/application/common'

export type DesignSubagentViewStatus = 'queued' | 'running' | 'completed' | 'stopped' | 'error'

export interface DesignSubagentViewItem {
  id: string
  parentRunId: string
  label: string
  agent?: string
  profileId?: string
  stage?: string
  task?: string
  status: DesignSubagentViewStatus
  detail?: string
  result?: string
  error?: string
  toolUses?: number
  startedAt?: number
  completedAt?: number
  cancellable: boolean
}

export function reduceDesignSubagentItems(
  previous: DesignSubagentViewItem[],
  event: DesignAgentStreamEvent,
): DesignSubagentViewItem[] {
  const item = designSubagentItemFromEvent(previous, event)
  if (!item) return previous
  return [...previous.filter(entry => entry.id !== item.id), item].slice(-40)
}

function designSubagentItemFromEvent(
  previous: DesignSubagentViewItem[],
  event: DesignAgentStreamEvent,
): DesignSubagentViewItem | null {
  if (event.type === 'subagent_updated') {
    return itemFromSnapshot(event.subagent)
  }
  if (event.type !== 'agent_event') return null

  const runtimeEvent = event.event
  switch (runtimeEvent.type) {
    case 'child_run_started': {
      const raw = childRaw(runtimeEvent.raw)
      const profile = childProfile(raw?.profile)
      return {
        id: runtimeEvent.childRunId,
        parentRunId: runtimeEvent.parentRunId,
        label: runtimeEvent.label ?? profile?.title ?? raw?.profileId ?? runtimeEvent.childRunId,
        agent: profile?.title,
        profileId: raw?.profileId,
        stage: raw?.stage,
        task: raw?.stage,
        status: 'running',
        detail: profile?.description,
        startedAt: runtimeEvent.ts,
        cancellable: false,
      }
    }
    case 'child_run_completed': {
      const existing = previous.find(item => item.id === runtimeEvent.childRunId)
      const result = summarizeSubagentOutput(runtimeEvent.output)
      return {
        id: runtimeEvent.childRunId,
        parentRunId: runtimeEvent.parentRunId,
        label: existing?.label ?? runtimeEvent.childRunId,
        agent: existing?.agent,
        profileId: existing?.profileId,
        stage: existing?.stage,
        task: existing?.task,
        status: 'completed',
        detail: result ?? existing?.detail,
        result,
        toolUses: existing?.toolUses,
        startedAt: existing?.startedAt,
        completedAt: runtimeEvent.ts,
        cancellable: false,
      }
    }
    case 'run_failed': {
      const existing = previous.find(item => item.id === runtimeEvent.runId)
      if (!existing) return null
      return {
        ...existing,
        status: 'error',
        error: runtimeEvent.error.message,
        detail: runtimeEvent.error.message,
        completedAt: runtimeEvent.ts,
        cancellable: false,
      }
    }
    case 'run_cancelled': {
      const existing = previous.find(item => item.id === runtimeEvent.runId)
      if (!existing) return null
      return {
        ...existing,
        status: 'stopped',
        detail: runtimeEvent.reason ?? existing.detail,
        completedAt: runtimeEvent.ts,
        cancellable: false,
      }
    }
    case 'tool_call': {
      const existing = previous.find(item => item.id === runtimeEvent.runId)
      if (!existing) return null
      return {
        ...existing,
        toolUses: (existing.toolUses ?? 0) + 1,
        detail: runtimeEvent.toolName,
      }
    }
    default:
      return null
  }
}

function itemFromSnapshot(snapshot: DesignSubagentRecordSnapshot): DesignSubagentViewItem {
  return {
    id: snapshot.id,
    parentRunId: snapshot.parentRunId,
    label: snapshot.label,
    agent: snapshot.agent,
    task: snapshot.task,
    status: snapshot.status,
    detail: snapshot.error ?? truncateSubagentText(snapshot.result) ?? snapshot.description,
    result: snapshot.result,
    error: snapshot.error,
    toolUses: snapshot.toolUses,
    startedAt: snapshot.startedAt,
    completedAt: snapshot.completedAt,
    cancellable: snapshot.status === 'queued' || snapshot.status === 'running',
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
    profileId: stringValue(record.profileId),
    stage: stringValue(record.stage),
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
    title: stringValue(record.title),
    description: stringValue(record.description),
  }
}

function summarizeSubagentOutput(output: unknown): string | undefined {
  if (typeof output === 'string') return truncateSubagentText(output)
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined
  const record = output as Record<string, unknown>

  const text = stringValue(record.text)
  if (text) return truncateSubagentText(text)

  const artifact = record.artifact
  if (artifact && typeof artifact === 'object' && !Array.isArray(artifact)) {
    const artifactRecord = artifact as Record<string, unknown>
    return [stringValue(artifactRecord.kind), stringValue(artifactRecord.title)]
      .filter(Boolean)
      .join(' / ') || undefined
  }

  const review = record.review
  if (review && typeof review === 'object' && !Array.isArray(review)) {
    const verdict = stringValue((review as Record<string, unknown>).verdict)
    return verdict ? `review ${verdict}` : undefined
  }

  const summary = stringValue(record.summary)
  if (summary) return truncateSubagentText(summary)

  return [stringValue(record.kind), stringValue(record.artifactId), stringValue(record.title)]
    .filter(Boolean)
    .join(' / ') || undefined
}

function truncateSubagentText(value: string | undefined): string | undefined {
  if (!value) return undefined
  return value.length > 96 ? `${value.slice(0, 93)}...` : value
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
