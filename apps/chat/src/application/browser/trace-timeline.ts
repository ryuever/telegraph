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
