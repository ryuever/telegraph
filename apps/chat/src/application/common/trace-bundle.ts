import type {
  ChatAgentRunRecordSnapshot,
  ChatRunTraceBundle,
} from '@/apps/chat/application/common'

export interface ChatRunTraceBundleValidationIssue {
  path: string
  message: string
}

export type ChatRunTraceBundleValidationResult =
  | { ok: true; bundle: ChatRunTraceBundle }
  | { ok: false; issues: ChatRunTraceBundleValidationIssue[] }

const RUN_STATUSES = new Set(['queued', 'running', 'completed', 'failed', 'cancelled'])

export function validateChatRunTraceBundle(value: unknown): ChatRunTraceBundleValidationResult {
  const issues: ChatRunTraceBundleValidationIssue[] = []
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: '$', message: 'Trace bundle must be a JSON object.' }] }
  }

  if (value.schemaVersion !== 1) {
    issues.push({ path: '$.schemaVersion', message: 'Unsupported trace bundle schemaVersion.' })
  }
  if (!isFiniteNumber(value.exportedAt)) {
    issues.push({ path: '$.exportedAt', message: 'exportedAt must be a finite number.' })
  }

  const run = isRecord(value.run) ? value.run : undefined
  if (!run) {
    issues.push({ path: '$.run', message: 'run metadata is required.' })
  } else {
    validateRunRecord(run, issues)
  }

  if (!Array.isArray(value.events)) {
    issues.push({ path: '$.events', message: 'events must be an array.' })
  } else if (run) {
    validateEventRecords(value.events, run, issues)
  }

  if (issues.length > 0) return { ok: false, issues }
  return { ok: true, bundle: value as unknown as ChatRunTraceBundle }
}

export function assertChatRunTraceBundle(value: unknown): ChatRunTraceBundle {
  const result = validateChatRunTraceBundle(value)
  if (result.ok) return result.bundle
  throw new Error(formatTraceBundleValidationIssues(result.issues))
}

export function formatTraceBundleValidationIssues(issues: ChatRunTraceBundleValidationIssue[]): string {
  return [
    'Invalid trace bundle:',
    ...issues.slice(0, 8).map(issue => `- ${issue.path}: ${issue.message}`),
    ...(issues.length > 8 ? [`- ...and ${String(issues.length - 8)} more issue(s)`] : []),
  ].join('\n')
}

function validateRunRecord(
  run: Record<string, unknown>,
  issues: ChatRunTraceBundleValidationIssue[],
): void {
  if (!isNonEmptyString(run.runId)) {
    issues.push({ path: '$.run.runId', message: 'runId must be a non-empty string.' })
  }
  if (!isNonEmptyString(run.sessionId)) {
    issues.push({ path: '$.run.sessionId', message: 'sessionId must be a non-empty string.' })
  }
  if (!isNonEmptyString(run.runtimeId)) {
    issues.push({ path: '$.run.runtimeId', message: 'runtimeId must be a non-empty string.' })
  }
  if (typeof run.status !== 'string' || !RUN_STATUSES.has(run.status)) {
    issues.push({ path: '$.run.status', message: 'status is not a valid run status.' })
  }
  if (!Array.isArray(run.artifactRefs) || !run.artifactRefs.every(item => typeof item === 'string')) {
    issues.push({ path: '$.run.artifactRefs', message: 'artifactRefs must be a string array.' })
  }
  if (!isRecord(run.settings)) {
    issues.push({ path: '$.run.settings', message: 'settings must be an object.' })
  }
  if (!isNonNegativeInteger(run.eventCount)) {
    issues.push({ path: '$.run.eventCount', message: 'eventCount must be a non-negative integer.' })
  }
  if (!isFiniteNumber(run.createdAt)) {
    issues.push({ path: '$.run.createdAt', message: 'createdAt must be a finite number.' })
  }
  if (run.input !== undefined && (!isRecord(run.input) || !isNonEmptyString(run.input.message))) {
    issues.push({ path: '$.run.input.message', message: 'input.message must be a non-empty string when input is present.' })
  }
}

function validateEventRecords(
  events: unknown[],
  run: Record<string, unknown>,
  issues: ChatRunTraceBundleValidationIssue[],
): void {
  const runId = typeof run.runId === 'string' ? run.runId : undefined
  const sessionId = typeof run.sessionId === 'string' ? run.sessionId : undefined
  const eventCount = typeof run.eventCount === 'number' ? run.eventCount : undefined
  const seenSeq = new Set<number>()

  if (eventCount !== undefined && eventCount !== events.length) {
    issues.push({ path: '$.events', message: 'events length must match run.eventCount.' })
  }

  events.forEach((item, index) => {
    const path = `$.events[${String(index)}]`
    if (!isRecord(item)) {
      issues.push({ path, message: 'event record must be an object.' })
      return
    }
    if (item.runId !== runId) {
      issues.push({ path: `${path}.runId`, message: 'event record runId must match run.runId.' })
    }
    if (item.sessionId !== undefined && item.sessionId !== sessionId) {
      issues.push({ path: `${path}.sessionId`, message: 'event record sessionId must match run.sessionId when present.' })
    }
    if (!isPositiveInteger(item.seq)) {
      issues.push({ path: `${path}.seq`, message: 'seq must be a positive integer.' })
    } else if (seenSeq.has(item.seq)) {
      issues.push({ path: `${path}.seq`, message: 'seq must be unique.' })
    } else {
      seenSeq.add(item.seq)
    }
    if (!isFiniteNumber(item.ts)) {
      issues.push({ path: `${path}.ts`, message: 'ts must be a finite number.' })
    }
    if (!isRecord(item.event)) {
      issues.push({ path: `${path}.event`, message: 'event must be an object.' })
      return
    }
    validateRuntimeEventShape(item.event, runId, path, issues)
  })
}

function validateRuntimeEventShape(
  event: Record<string, unknown>,
  runId: string | undefined,
  eventRecordPath: string,
  issues: ChatRunTraceBundleValidationIssue[],
): void {
  const path = `${eventRecordPath}.event`
  if (!isNonEmptyString(event.type)) {
    issues.push({ path: `${path}.type`, message: 'event.type must be a non-empty string.' })
  }
  if (!isFiniteNumber(event.schemaVersion)) {
    issues.push({ path: `${path}.schemaVersion`, message: 'event.schemaVersion must be a finite number.' })
  }
  if (!isFiniteNumber(event.ts)) {
    issues.push({ path: `${path}.ts`, message: 'event.ts must be a finite number.' })
  }
  if (typeof event.runId === 'string' && runId && event.runId !== runId) {
    issues.push({ path: `${path}.runId`, message: 'event.runId must match run.runId when present.' })
  }
  if (typeof event.parentRunId === 'string' && runId && event.parentRunId !== runId) {
    issues.push({ path: `${path}.parentRunId`, message: 'event.parentRunId must match run.runId when present.' })
  }
}

export function taskCapabilityProfileSummary(run: ChatAgentRunRecordSnapshot): string {
  return run.settings.taskCapabilityProfile ?? 'default'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value >= 0
}
