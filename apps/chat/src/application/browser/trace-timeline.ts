import type { LlmTracePayload } from '@/apps/chat/application/common'
import type { AgentEvent } from '@/packages/agent-protocol'
import type { LlmTraceRow } from './llm-trace-store'

export type TimelineStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown'

export interface TraceTimelineChildRun {
  id: string
  label: string
  status: TimelineStatus
  rows: LlmTraceRow[]
}

export interface TraceTimelineStep {
  id: string
  label: string
  kind?: string
  status: TimelineStatus
  rows: LlmTraceRow[]
}

export interface TraceTimelineRun {
  id: string
  pattern?: string
  status: TimelineStatus
  rows: LlmTraceRow[]
  directRows: LlmTraceRow[]
  childRuns: TraceTimelineChildRun[]
  steps: TraceTimelineStep[]
}

export function formatTraceJson(trace: LlmTracePayload): string {
  try {
    return JSON.stringify(trace, null, 2)
  } catch {
    return JSON.stringify(trace)
  }
}

export function runtimeEventForRow(row: LlmTraceRow): AgentEvent | null {
  return row.trace.kind === 'runtime_event' ? row.trace.event : null
}

export function traceRowSummary(row: LlmTraceRow): string {
  const event = runtimeEventForRow(row)
  if (!event) return legacyTraceSummary(row.trace)

  switch (event.type) {
    case 'permission_requested':
      return `Permission requested: ${permissionLabel(event.permission)}`
    case 'permission_resolved':
      return `Permission ${event.granted ? 'granted' : 'denied'}: ${permissionLabel(event.permission)}`
    case 'tool_call':
      return `${isExecEvent(event) ? 'Exec' : 'Tool'} started: ${event.toolName}`
    case 'tool_result':
      return `${isExecEvent(event) ? 'Exec' : 'Tool'} completed: ${event.toolName}`
    case 'tool_error':
      return `${isExecEvent(event) ? 'Exec' : 'Tool'} failed: ${event.toolName}`
    case 'runtime_log':
      return runtimeLogSummary(event)
    case 'extension_activated':
      return `Extension activated: ${event.extensionId}`
    case 'extension_deactivated':
      return `Extension deactivated: ${event.extensionId}`
    case 'step_started':
      return `Step started: ${event.label}`
    case 'step_completed':
      return `Step completed: ${shortId(event.stepId)}`
    case 'edge_taken':
      return `Edge taken: ${event.from} -> ${event.to}`
    case 'child_run_started':
      return `Child run started: ${event.label ?? shortId(event.childRunId)}`
    case 'child_run_completed':
      return `Child run completed: ${shortId(event.childRunId)}`
    case 'assistant_delta':
      return event.text ? `Assistant delta: ${compact(event.text)}` : 'Assistant delta'
    case 'assistant_message':
      return `Assistant message: ${compact(event.message.content)}`
    case 'model_request':
      return `Model request: ${event.requestId}`
    case 'model_event':
      return `Model event: ${event.requestId}`
    case 'run_started':
      return `Run started${event.pattern ? `: ${event.pattern}` : ''}`
    case 'run_completed':
      return 'Run completed'
    case 'run_failed':
      return `Run failed: ${event.error.message}`
    case 'run_cancelled':
      return `Run cancelled${event.reason ? `: ${event.reason}` : ''}`
    default:
      return event satisfies never
  }
}

export function shortId(id: string): string {
  if (id.length <= 12) return id
  return `${id.slice(0, 10)}...`
}

export function statusClass(status: TimelineStatus): string {
  if (status === 'completed') return 'bg-emerald-500/15 text-emerald-200'
  if (status === 'failed') return 'bg-red-500/15 text-red-200'
  if (status === 'cancelled') return 'bg-zinc-600/40 text-zinc-300'
  if (status === 'running') return 'bg-sky-500/15 text-sky-200'
  return 'bg-zinc-800 text-zinc-400'
}

function eventRunId(event: AgentEvent | null, fallbackRunId: string): string {
  if (!event) return fallbackRunId
  if ('parentRunId' in event) return event.parentRunId
  if ('runId' in event && typeof event.runId === 'string') return event.runId
  return fallbackRunId
}

function statusForRunEvent(type: AgentEvent['type']): TimelineStatus | null {
  if (type === 'run_started') return 'running'
  if (type === 'run_completed') return 'completed'
  if (type === 'run_failed') return 'failed'
  if (type === 'run_cancelled') return 'cancelled'
  return null
}

function makeRun(runId: string): TraceTimelineRun {
  return {
    id: runId,
    status: 'unknown',
    rows: [],
    directRows: [],
    childRuns: [],
    steps: [],
  }
}

function legacyTraceSummary(trace: LlmTracePayload): string {
  switch (trace.kind) {
    case 'telegraph_turn_context':
      return `Turn context: ${String(trace.messages.length)} message${trace.messages.length === 1 ? '' : 's'}`
    case 'pi_cli_request':
      return `Pi CLI request: ${compact(trace.userMessage)}`
    case 'pi_json_line':
      return 'Pi JSON line'
    case 'pi_ai_request':
      return `Pi AI request: ${String(trace.messages.length)} message${trace.messages.length === 1 ? '' : 's'}`
    case 'pi_ai_stream_event':
      return 'Pi AI stream event'
    case 'runtime_event':
      return traceRowSummary({
        sessionId: '',
        runId: '',
        ts: 0,
        trace,
      })
    default:
      return trace satisfies never
  }
}

function runtimeLogSummary(event: Extract<AgentEvent, { type: 'runtime_log' }>): string {
  const source = rawStringField(event.raw, 'source')
  const hook = rawStringField(event.raw, 'hook')
  const action = rawStringField(event.raw, 'action')
  if (source === 'pi-extension-compat' && hook) {
    return `Hook ${hook}${action ? ` ${action}` : ''}: ${event.message}`
  }
  if (source) {
    return `Feedback (${source}): ${event.message}`
  }
  return `Runtime ${event.level}: ${event.message}`
}

function rawStringField(raw: unknown, key: string): string | undefined {
  if (!raw || typeof raw !== 'object' || !(key in raw)) return undefined
  const value = raw[key as keyof typeof raw]
  return typeof value === 'string' ? value : undefined
}

function permissionLabel(permission: Extract<AgentEvent, { type: 'permission_requested' }>['permission']): string {
  switch (permission.type) {
    case 'filesystem':
      return `${permission.type}:${permission.scope}:${permission.access}`
    case 'shell':
      return `${permission.type}:${permission.risk}`
    case 'network':
      return `${permission.type}:${permission.hosts?.join(',') ?? '*'}`
    case 'process':
      return `${permission.type}:${permission.commands?.join(',') ?? '*'}`
    case 'secrets':
      return `${permission.type}:${permission.keys?.join(',') ?? '*'}`
    default:
      return permission satisfies never
  }
}

function isExecEvent(event: Extract<AgentEvent, { type: 'tool_call' | 'tool_result' | 'tool_error' }>): boolean {
  return event.origin?.runtimeId === 'node-process-capability'
}

function compact(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 80) return normalized
  return `${normalized.slice(0, 77)}...`
}

export function buildTraceTimeline(rows: LlmTraceRow[]): TraceTimelineRun[] {
  const runs = new Map<string, TraceTimelineRun>()
  const childRunIndex = new Map<string, TraceTimelineChildRun>()
  const childRunParentIndex = new Map<string, string>()
  const stepIndex = new Map<string, TraceTimelineStep>()

  const ensureRun = (runId: string): TraceTimelineRun => {
    const existing = runs.get(runId)
    if (existing) return existing
    const run = makeRun(runId)
    runs.set(runId, run)
    return run
  }

  const ensureChildRun = (parent: TraceTimelineRun, childRunId: string, label?: string): TraceTimelineChildRun => {
    const existing = childRunIndex.get(childRunId)
    if (existing) {
      if (label) existing.label = label
      return existing
    }
    const childRun: TraceTimelineChildRun = {
      id: childRunId,
      label: label ?? `child ${shortId(childRunId)}`,
      status: 'running',
      rows: [],
    }
    childRunIndex.set(childRunId, childRun)
    childRunParentIndex.set(childRunId, parent.id)
    parent.childRuns.push(childRun)
    return childRun
  }

  const ensureStep = (run: TraceTimelineRun, stepId: string, label?: string, kind?: string): TraceTimelineStep => {
    const key = `${run.id}:${stepId}`
    const existing = stepIndex.get(key)
    if (existing) {
      if (label) existing.label = label
      if (kind) existing.kind = kind
      return existing
    }
    const step: TraceTimelineStep = {
      id: stepId,
      label: label ?? `step ${shortId(stepId)}`,
      kind,
      status: 'running',
      rows: [],
    }
    stepIndex.set(key, step)
    run.steps.push(step)
    return step
  }

  for (const row of rows) {
    const event = runtimeEventForRow(row)
    const explicitEventRunId = event && 'runId' in event && typeof event.runId === 'string' ? event.runId : null
    const parentRunId = explicitEventRunId ? childRunParentIndex.get(explicitEventRunId) : undefined
    const run = ensureRun(parentRunId ?? eventRunId(event, row.runId))
    run.rows.push(row)

    if (event?.type === 'run_started') {
      run.status = 'running'
      run.pattern = event.pattern
      run.directRows.push(row)
      continue
    }

    const runStatus = event ? statusForRunEvent(event.type) : null
    if (runStatus) {
      run.status = runStatus
      run.directRows.push(row)
      continue
    }

    if (event?.type === 'child_run_started') {
      const childRun = ensureChildRun(run, event.childRunId, event.label)
      childRun.status = 'running'
      childRun.rows.push(row)
      continue
    }

    if (event?.type === 'child_run_completed') {
      const childRun = ensureChildRun(run, event.childRunId)
      childRun.status = 'completed'
      childRun.rows.push(row)
      continue
    }

    if (event?.type === 'step_started') {
      const step = ensureStep(run, event.stepId, event.label, event.kind)
      step.status = 'running'
      step.rows.push(row)
      continue
    }

    if (event?.type === 'step_completed') {
      const step = ensureStep(run, event.stepId)
      step.status = 'completed'
      step.rows.push(row)
      continue
    }

    if (explicitEventRunId) {
      const childRun = childRunIndex.get(explicitEventRunId)
      if (childRun) {
        childRun.rows.push(row)
        continue
      }
    }

    run.directRows.push(row)
  }

  return [...runs.values()]
}
