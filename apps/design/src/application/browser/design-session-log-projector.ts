import type { AgentEvent } from '@/packages/agent-protocol'
import type {
  DesignAgentStreamEvent,
  DesignSubagentRecordSnapshot,
} from '@/apps/design/application/common'

export type DesignSessionLogStatus = 'info' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface DesignSessionLogItem {
  id: string
  ts: number
  runId?: string
  childRunId?: string
  kind: 'run' | 'step' | 'model' | 'tool' | 'subagent' | 'artifact' | 'review' | 'snapshot'
  label: string
  detail?: string
  fullDetail?: string
  status: DesignSessionLogStatus
}

const MAX_SESSION_LOG_ITEMS = 160
const DETAIL_LIMIT = 180

export function reduceDesignSessionLogItems(
  previous: DesignSessionLogItem[],
  event: DesignAgentStreamEvent,
): DesignSessionLogItem[] {
  const items = designSessionLogItemsFromEvent(event, previous)
  const finalized = finalizeThinkingItems(previous, thinkingTerminalStatusFromEvent(event))
  if (items.length === 0) return finalized

  const next = [...finalized]
  for (const item of items) {
    const existingIndex = next.findIndex(entry => entry.id === item.id)
    if (existingIndex >= 0) {
      next[existingIndex] = item
    } else {
      next.push(item)
    }
  }

  return next
    .sort((a, b) => a.ts - b.ts)
    .slice(-MAX_SESSION_LOG_ITEMS)
}

export function initialDesignSessionLogItemsFromEvents(
  events: AgentEvent[],
  fallbackRunId: string,
): DesignSessionLogItem[] {
  return events.reduce<DesignSessionLogItem[]>((items, event) =>
    reduceDesignSessionLogItems(items, {
      type: 'agent_event',
      runId: eventRunId(event) ?? fallbackRunId,
      event,
    }), [])
}

function designSessionLogItemsFromEvent(
  event: DesignAgentStreamEvent,
  previous: DesignSessionLogItem[],
): DesignSessionLogItem[] {
  if (event.type === 'run_queued') {
    return [{
      id: `${event.runId}:queued`,
      ts: Date.now(),
      runId: event.runId,
      kind: 'run',
      label: 'Run queued',
      detail: snapshotDetail(event.sessionId, event.runId),
      status: 'running',
    }]
  }

  if (event.type === 'run_failed') {
    return [{
      id: `${event.runId}:terminal`,
      ts: Date.now(),
      runId: event.runId,
      kind: 'run',
      label: 'Run failed',
      detail: event.error,
      status: event.error === 'Cancelled' ? 'cancelled' : 'failed',
    }]
  }

  if (event.type === 'subagent_updated') {
    return [subagentSnapshotLogItem(event.subagent, event.sessionId)]
  }

  return agentEventLogItems(event.runId, event.sessionId, event.event, previous)
}

function agentEventLogItems(
  streamRunId: string,
  sessionId: string | undefined,
  event: AgentEvent,
  previous: DesignSessionLogItem[],
): DesignSessionLogItem[] {
  switch (event.type) {
    case 'run_started':
      return [{
        id: `${event.runId}:run`,
        ts: event.ts,
        runId: event.runId,
        kind: 'run',
        label: 'Run started',
        detail: [event.pattern, event.origin?.runtimeId, snapshotDetail(sessionId, event.runId)].filter(Boolean).join(' / '),
        status: 'running',
      }]

    case 'run_completed':
      return [
        {
          id: `${event.runId}:terminal`,
          ts: event.ts,
          runId: event.runId,
          kind: 'run',
          label: 'Run completed',
          detail: summarizeRunOutput(event.output, previous, event.runId),
          status: 'completed',
        },
        snapshotLogItem(event.runId, sessionId, previous.length + 1, event.ts),
      ]

    case 'run_failed':
      return [{
        id: `${event.runId}:terminal`,
        ts: event.ts,
        runId: event.runId,
        kind: 'run',
        label: 'Run failed',
        detail: failureDetail(event.error.message, event.error.details),
        status: 'failed',
      }]

    case 'run_cancelled':
      return [{
        id: `${event.runId}:terminal`,
        ts: event.ts,
        runId: event.runId,
        kind: 'run',
        label: 'Run cancelled',
        detail: event.reason,
        status: 'cancelled',
      }]

    case 'step_started':
      return [{
        id: event.stepId,
        ts: event.ts,
        runId: event.runId ?? streamRunId,
        kind: 'step',
        label: `Step started: ${event.label}`,
        detail: event.kind,
        status: 'running',
      }]

    case 'step_completed': {
      const existing = previous.find(item => item.id === event.stepId)
      const label = existing?.label.replace('Step started: ', '') ?? event.stepId
      const detail = summarizeStepOutput(event.stepId, event.output)
      return [{
        id: event.stepId,
        ts: event.ts,
        runId: event.runId ?? streamRunId,
        kind: stepKindFromOutput(event.output),
        label: `Step completed: ${label}`,
        detail,
        status: statusFromOutput(event.output, 'completed'),
      }]
    }

    case 'child_run_started':
      return [{
        id: event.childRunId,
        ts: event.ts,
        runId: event.parentRunId,
        childRunId: event.childRunId,
        kind: 'subagent',
        label: `Model invoked: ${event.label ?? event.childRunId}`,
        detail: summarizeChildRunRaw(event.raw),
        status: 'running',
      }]

    case 'child_run_completed':
      return [{
        id: event.childRunId,
        ts: event.ts,
        runId: event.parentRunId,
        childRunId: event.childRunId,
        kind: stepKindFromOutput(event.output) === 'review' ? 'review' : 'subagent',
        label: `Model completed: ${existingChildLabel(previous, event.childRunId) ?? event.childRunId}`,
        detail: summarizeStepOutput(event.childRunId, event.output),
        status: statusFromOutput(event.output, 'completed'),
      }]

    case 'model_request':
      return [{
        id: `${event.runId ?? streamRunId}:model-request:${event.requestId}`,
        ts: event.ts,
        runId: event.runId ?? streamRunId,
        kind: 'model',
        label: 'Model request',
        detail: summarizeModelPayload(event.payload) ?? event.requestId,
        status: 'running',
      }]

    case 'model_event':
      return [{
        id: `${event.runId ?? streamRunId}:model-event:${event.requestId}:${String(event.ts)}`,
        ts: event.ts,
        runId: event.runId ?? streamRunId,
        kind: 'model',
        label: 'Model event',
        detail: summarizeModelPayload(event.raw),
        status: 'running',
      }]

    case 'assistant_delta':
      return [{
        id: `${event.runId ?? streamRunId}:assistant:${event.requestId}:${String(event.ts)}`,
        ts: event.ts,
        runId: event.runId ?? streamRunId,
        kind: 'model',
        label: 'Assistant output',
        detail: truncateDetail(event.text),
        fullDetail: event.text,
        status: 'completed',
      }]

    case 'assistant_message':
      return [{
        id: `${event.runId ?? streamRunId}:assistant-message:${event.requestId}`,
        ts: event.ts,
        runId: event.runId ?? streamRunId,
        kind: 'model',
        label: 'Assistant message',
        detail: truncateDetail(event.message.content),
        status: 'completed',
      }]

    case 'tool_call':
      return [{
        id: `${event.runId ?? streamRunId}:tool-call:${event.callId}`,
        ts: event.ts,
        runId: event.runId ?? streamRunId,
        kind: 'tool',
        label: `Tool call: ${event.toolName}`,
        detail: summarizeToolInput(event.input),
        status: 'running',
      }]

    case 'tool_result':
      return [{
        id: `${event.runId ?? streamRunId}:tool-result:${event.callId}`,
        ts: event.ts,
        runId: event.runId ?? streamRunId,
        kind: 'tool',
        label: `Tool result: ${event.toolName}`,
        detail: summarizeStepOutput(event.callId, event.output),
        status: 'completed',
      }]

    case 'tool_error':
      return [{
        id: `${event.runId ?? streamRunId}:tool-error:${event.callId}`,
        ts: event.ts,
        runId: event.runId ?? streamRunId,
        kind: 'tool',
        label: `Tool error: ${event.toolName}`,
        detail: event.error.message,
        status: 'failed',
      }]

    case 'runtime_log': {
      const thinking = thinkingDeltaFromRaw(event.raw)
      if (thinking) {
        return [thinkingLogItem(streamRunId, event, thinking, previous)]
      }
      const detail = thinking ?? event.message
      return [{
        id: `${event.runId ?? streamRunId}:runtime-log:${String(event.ts)}:${event.message}`,
        ts: event.ts,
        runId: event.runId ?? streamRunId,
        kind: 'model',
        label: thinking ? 'Thinking' : `Runtime ${event.level}`,
        detail: truncateDetail(detail),
        fullDetail: detail,
        status: event.level === 'error' ? 'failed' : 'info',
      }]
    }

    default:
      return []
  }
}

function thinkingLogItem(
  streamRunId: string,
  event: Extract<AgentEvent, { type: 'runtime_log' }>,
  delta: string,
  previous: DesignSessionLogItem[],
): DesignSessionLogItem {
  const runId = event.runId ?? streamRunId
  const id = thinkingLogItemId(runId, event.requestId)
  const existing = previous.find(item => item.id === id)
  const fullDetail = `${existing?.fullDetail ?? ''}${delta}`
  return {
    id,
    ts: existing?.ts ?? event.ts,
    runId,
    kind: 'model',
    label: 'Thinking',
    detail: truncateDetail(fullDetail),
    fullDetail,
    status: 'running',
  }
}

function thinkingLogItemId(runId: string, requestId: string | undefined): string {
  return `${runId}:thinking:${requestId ?? 'run'}`
}

function finalizeThinkingItems(
  items: DesignSessionLogItem[],
  terminal: { runId: string; status: Extract<DesignSessionLogStatus, 'completed' | 'failed' | 'cancelled'> } | undefined,
): DesignSessionLogItem[] {
  if (!terminal) return items

  const shouldFinalize = items.some(item =>
    isThinkingLogItem(item) && item.runId === terminal.runId && item.status === 'running',
  )
  if (!shouldFinalize) return items

  return items.map((item) => {
    if (!isThinkingLogItem(item) || item.runId !== terminal.runId || item.status !== 'running') {
      return item
    }
    return { ...item, status: terminal.status }
  })
}

function thinkingTerminalStatusFromEvent(
  event: DesignAgentStreamEvent,
): { runId: string; status: Extract<DesignSessionLogStatus, 'completed' | 'failed' | 'cancelled'> } | undefined {
  if (event.type === 'run_failed') {
    return {
      runId: event.runId,
      status: event.error === 'Cancelled' ? 'cancelled' : 'failed',
    }
  }
  if (event.type !== 'agent_event') return undefined

  switch (event.event.type) {
    case 'run_completed':
      return { runId: event.event.runId, status: 'completed' }
    case 'run_failed':
      return { runId: event.event.runId, status: 'failed' }
    case 'run_cancelled':
      return { runId: event.event.runId, status: 'cancelled' }
    case 'child_run_completed':
      return { runId: event.event.childRunId, status: 'completed' }
    default:
      return undefined
  }
}

function isThinkingLogItem(item: DesignSessionLogItem): boolean {
  return item.kind === 'model' && item.label === 'Thinking'
}

function subagentSnapshotLogItem(
  snapshot: DesignSubagentRecordSnapshot,
  sessionId: string | undefined,
): DesignSessionLogItem {
  return {
    id: `subagent:${snapshot.id}`,
    ts: snapshot.completedAt ?? snapshot.startedAt,
    runId: snapshot.parentRunId,
    childRunId: snapshot.id,
    kind: 'subagent',
    label: `Subagent ${snapshot.status}: ${snapshot.label}`,
    detail: [
      snapshot.agent,
      snapshot.task,
      snapshot.toolUses > 0 ? `${String(snapshot.toolUses)} tool calls` : undefined,
      snapshot.error,
      truncateDetail(snapshot.result),
      snapshotDetail(sessionId, snapshot.parentRunId),
    ].filter(Boolean).join(' / '),
    status: subagentStatus(snapshot.status),
  }
}

function snapshotLogItem(
  runId: string,
  sessionId: string | undefined,
  eventCount: number,
  ts: number,
): DesignSessionLogItem {
  return {
    id: `${runId}:snapshot`,
    ts,
    runId,
    kind: 'snapshot',
    label: 'Session snapshot captured',
    detail: `${snapshotDetail(sessionId, runId)} / ${String(eventCount)} projected log events`,
    status: 'completed',
  }
}

function summarizeRunOutput(
  output: unknown,
  previous: DesignSessionLogItem[],
  runId: string,
): string | undefined {
  const artifactSummary = summarizeArtifactOutput(output)
  const childCount = previous.filter(item => item.runId === runId && item.kind === 'subagent').length
  return [artifactSummary, childCount > 0 ? `${String(childCount)} model stages` : undefined]
    .filter(Boolean)
    .join(' / ') || undefined
}

function summarizeStepOutput(stepId: string, output: unknown): string | undefined {
  const review = reviewFromOutput(output)
  if (review) return summarizeReview(review)

  const visual = visualReviewFromOutput(output)
  if (visual) return summarizeVisualReview(visual)

  const retrieval = componentRetrievalFromOutput(output)
  if (retrieval) return summarizeComponentRetrieval(retrieval)

  const artifact = summarizeArtifactOutput(output)
  if (artifact) return artifact

  const brief = briefFromOutput(output)
  if (brief) return truncateDetail(brief)

  const summary = stringField(output, 'summary')
  if (summary) return truncateDetail(summary)

  const status = stringField(output, 'status')
  if (status) return status

  const kind = stringField(output, 'kind')
  const artifactId = stringField(output, 'artifactId') ?? stringField(output, 'id')
  if (kind || artifactId) return [kind, artifactId].filter(Boolean).join(' / ')

  return stepId.includes('model-event') ? summarizeModelPayload(output) : undefined
}

function summarizeComponentRetrieval(output: Record<string, unknown>): string {
  const ledger = recordField(output, 'ledger') ?? output
  const selected = arrayField(ledger, 'selected').length > 0
    ? arrayField(ledger, 'selected')
    : arrayField(output, 'components')
  const selectedNames = selected
    .map(item => stringField(item, 'name') ?? stringField(item, 'id'))
    .filter((name): name is string => Boolean(name))
    .slice(0, 6)
  const metrics = recordField(recordField(ledger, 'retrieval'), 'metrics') ?? recordField(ledger, 'metrics')
  const selectedCount = numberField(metrics, 'selectedCount') ?? selected.length
  const rejectedCount = numberField(metrics, 'rejectedCount') ?? arrayField(ledger, 'rejected').length
  const fallbackCount = numberField(metrics, 'fallbackCount') ?? arrayField(ledger, 'fallbacks').length
  const status = stringField(recordField(ledger, 'retrieval'), 'status') ?? stringField(output, 'status')
  const names = selectedNames.length > 0 ? `components: ${selectedNames.join(', ')}` : `${String(selectedCount)} components`
  return [
    names,
    status ? `status: ${status}` : undefined,
    `selected ${String(selectedCount)} / rejected ${String(rejectedCount)} / fallback ${String(fallbackCount)}`,
  ].filter(Boolean).join(' / ')
}

function summarizeReview(review: Record<string, unknown>): string {
  const verdict = stringField(review, 'verdict') ?? 'unknown'
  const failed = arrayField(review, 'checks')
    .map(recordValue)
    .filter(isFailedCheck)
  const failedIds = failed
    .map(check => stringField(check, 'id'))
    .filter((id): id is string => Boolean(id))
    .slice(0, 5)
  const failedSummary = failed
    .map(check => stringField(check, 'summary'))
    .filter((summary): summary is string => Boolean(summary))
    .slice(0, 2)
    .join('; ')
  return [
    `verdict: ${verdict}`,
    failedIds.length > 0 ? `failed: ${failedIds.join(', ')}` : undefined,
    failedSummary ? truncateDetail(failedSummary) : undefined,
  ].filter(Boolean).join(' / ')
}

function summarizeVisualReview(report: Record<string, unknown>): string {
  const status = stringField(report, 'status') ?? 'unknown'
  const failedIds = arrayField(report, 'checks')
    .map(recordValue)
    .filter(isFailedCheck)
    .map(check => stringField(check, 'id'))
    .filter((id): id is string => Boolean(id))
    .slice(0, 5)
  const messages = arrayField(recordField(report, 'compileRuntime'), 'messages')
    .filter((message): message is string => typeof message === 'string')
    .slice(0, 2)
    .join('; ')
  return [
    `visual: ${status}`,
    failedIds.length > 0 ? `failed: ${failedIds.join(', ')}` : undefined,
    messages ? truncateDetail(messages) : undefined,
  ].filter(Boolean).join(' / ')
}

function summarizeArtifactOutput(output: unknown): string | undefined {
  const artifact = artifactFromOutput(output)
  if (!artifact) return undefined
  const kind = stringField(artifact, 'kind')
  const title = stringField(artifact, 'title') ?? stringField(artifact, 'name') ?? stringField(artifact, 'id')
  const operations = arrayField(artifact, 'operations')
  const files = arrayField(artifact, 'files')
  const counts = [
    operations.length > 0 ? `${String(operations.length)} operations` : undefined,
    files.length > 0 ? `${String(files.length)} files` : undefined,
  ].filter(Boolean).join(', ')
  return [kind, title, counts].filter(Boolean).join(' / ') || undefined
}

function summarizeChildRunRaw(raw: unknown): string | undefined {
  const record = recordValue(raw)
  if (!record) return undefined
  const profile = recordField(record, 'profile')
  const stage = stringField(record, 'stage')
  const profileId = stringField(record, 'profileId')
  return [
    stage ? `stage: ${stage}` : undefined,
    profileId ? `profile: ${profileId}` : undefined,
    stringField(profile, 'sourcePath'),
    arrayField(profile, 'skills').filter((skill): skill is string => typeof skill === 'string').join(', '),
  ].filter(Boolean).join(' / ') || undefined
}

function summarizeToolInput(input: unknown): string | undefined {
  const record = recordValue(input)
  const output = recordField(record, 'output')
  return summarizeStepOutput('tool-input', output ?? input) ?? summarizeModelPayload(input)
}

function summarizeModelPayload(payload: unknown): string | undefined {
  const record = recordValue(payload)
  if (!record) return truncateDetail(typeof payload === 'string' ? payload : undefined)
  const type = stringField(record, 'type') ?? stringField(record, 'event') ?? stringField(record, 'name')
  const model = stringField(record, 'model')
  const toolName = stringField(record, 'toolName') ?? stringField(record, 'tool_name')
  const messages = arrayField(record, 'messages').length
  const tools = arrayField(record, 'tools')
    .map(tool => stringField(tool, 'name'))
    .filter((name): name is string => Boolean(name))
    .slice(0, 6)
  return [
    type,
    model ? `model: ${model}` : undefined,
    toolName ? `tool: ${toolName}` : undefined,
    messages > 0 ? `${String(messages)} messages` : undefined,
    tools.length > 0 ? `tools: ${tools.join(', ')}` : undefined,
  ].filter(Boolean).join(' / ') || undefined
}

function failureDetail(message: string, details: unknown): string {
  const review = reviewFromOutput(details)
  if (review) return `${message} / ${summarizeReview(review)}`
  return message
}

function stepKindFromOutput(output: unknown): DesignSessionLogItem['kind'] {
  if (reviewFromOutput(output) || visualReviewFromOutput(output)) return 'review'
  if (artifactFromOutput(output)) return 'artifact'
  return 'step'
}

function statusFromOutput(output: unknown, fallback: DesignSessionLogStatus): DesignSessionLogStatus {
  const review = reviewFromOutput(output)
  if (review) {
    const verdict = stringField(review, 'verdict')
    return verdict === 'pass' ? 'completed' : 'failed'
  }
  const visual = visualReviewFromOutput(output)
  if (visual) {
    const status = stringField(visual, 'status')
    return status === 'pass' ? 'completed' : 'failed'
  }
  return fallback
}

function componentRetrievalFromOutput(output: unknown): Record<string, unknown> | undefined {
  const record = recordValue(output)
  if (!record) return undefined
  if (Array.isArray(record.selected) || recordField(record, 'ledger')) return record
  const components = arrayField(record, 'components')
  if (components.length > 0) return record
  return undefined
}

function reviewFromOutput(output: unknown): Record<string, unknown> | undefined {
  const record = recordValue(output)
  if (!record) return undefined
  const review = recordField(record, 'review')
  if (review) return review
  if (typeof record.verdict === 'string' && Array.isArray(record.checks)) return record
  return undefined
}

function visualReviewFromOutput(output: unknown): Record<string, unknown> | undefined {
  const record = recordValue(output)
  if (!record) return undefined
  if (record.id === 'visual-review' || (Array.isArray(record.viewports) && record.compileRuntime)) return record
  const metadata = recordField(artifactFromOutput(output), 'metadata')
  return recordField(metadata, 'visualReview')
}

function artifactFromOutput(output: unknown): Record<string, unknown> | undefined {
  const record = recordValue(output)
  if (!record) return undefined
  const artifact = recordField(record, 'artifact')
  if (artifact) return artifact
  if (typeof record.kind === 'string' && (typeof record.id === 'string' || Array.isArray(record.operations) || Array.isArray(record.files))) {
    return record
  }
  return undefined
}

function briefFromOutput(output: unknown): string | undefined {
  const brief = recordField(output, 'brief')
  return stringField(brief, 'summary')
}

function subagentStatus(status: DesignSubagentRecordSnapshot['status']): DesignSessionLogStatus {
  if (status === 'completed') return 'completed'
  if (status === 'error') return 'failed'
  if (status === 'stopped') return 'cancelled'
  return 'running'
}

function existingChildLabel(previous: DesignSessionLogItem[], childRunId: string): string | undefined {
  const label = previous.find(item => item.childRunId === childRunId)?.label
  return label?.replace('Model invoked: ', '')
}

function snapshotDetail(sessionId: string | undefined, runId: string): string {
  return [
    sessionId ? `session ${shortId(sessionId)}` : undefined,
    `run ${shortId(runId)}`,
  ].filter(Boolean).join(' / ')
}

function eventRunId(event: AgentEvent): string | undefined {
  if ('runId' in event && typeof event.runId === 'string') return event.runId
  if ('parentRunId' in event && typeof event.parentRunId === 'string') return event.parentRunId
  return undefined
}

function recordField(value: unknown, key: string): Record<string, unknown> | undefined {
  const record = recordValue(value)
  const field = record?.[key]
  return recordValue(field)
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function arrayField(value: unknown, key: string): unknown[] {
  const record = recordValue(value)
  const field = record?.[key]
  return Array.isArray(field) ? field : []
}

function stringField(value: unknown, key: string): string | undefined {
  const record = recordValue(value)
  const field = record?.[key]
  return typeof field === 'string' && field.length > 0 ? field : undefined
}

function numberField(value: unknown, key: string): number | undefined {
  const record = recordValue(value)
  const field = record?.[key]
  return typeof field === 'number' ? field : undefined
}

function thinkingDeltaFromRaw(value: unknown): string | undefined {
  const record = recordValue(value)
  const delta = record?.delta
  return typeof delta === 'string' && delta.length > 0 ? delta : undefined
}

function isFailedCheck(value: Record<string, unknown> | undefined): value is Record<string, unknown> {
  return Boolean(value) && value?.passed === false
}

function shortId(value: string): string {
  return value.length > 8 ? value.slice(0, 8) : value
}

function truncateDetail(value: string | undefined): string | undefined {
  if (!value) return undefined
  return value.length > DETAIL_LIMIT ? `${value.slice(0, DETAIL_LIMIT - 3)}...` : value
}
