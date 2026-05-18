import type { AgentEvent } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import type { RuntimeExecutor, RuntimeInput } from '@/packages/agent/runtime/AgentRuntime'

export interface RuntimeConformanceIssue {
  eventIndex?: number
  code: string
  message: string
}

export interface RuntimeConformanceReport {
  events: AgentEvent[]
  issues: RuntimeConformanceIssue[]
}

export async function runRuntimeConformance(
  runtime: RuntimeExecutor,
  input: RuntimeInput,
): Promise<RuntimeConformanceReport> {
  const events: AgentEvent[] = []
  const issues: RuntimeConformanceIssue[] = []

  try {
    for await (const event of runtime.run(input)) {
      events.push(event as AgentEvent)
    }
  } catch (error) {
    issues.push({
      code: 'runtime_threw',
      message: error instanceof Error ? error.message : String(error),
    })
  }

  for (const [index, event] of events.entries()) {
    issues.push(...validateRuntimeEventConformance(event, index))
  }

  const terminalEvents = events.filter(isTerminalEvent)
  if (terminalEvents.length === 0) {
    issues.push({ code: 'missing_terminal_event', message: 'Runtime must emit a terminal run event.' })
  }

  const lastEvent = events.at(-1)
  if (lastEvent && !isTerminalEvent(lastEvent)) {
    issues.push({
      eventIndex: events.length - 1,
      code: 'last_event_not_terminal',
      message: `Last event must be terminal, received "${lastEvent.type}".`,
    })
  }

  return { events, issues }
}

export function validateRuntimeEventConformance(event: AgentEvent, eventIndex?: number): RuntimeConformanceIssue[] {
  const issues: RuntimeConformanceIssue[] = []

  if (event.schemaVersion !== RUNTIME_CONTRACT_SCHEMA_VERSION) {
    issues.push({
      eventIndex,
      code: 'invalid_schema_version',
      message: `Expected schemaVersion ${String(RUNTIME_CONTRACT_SCHEMA_VERSION)}.`,
    })
  }

  if (typeof event.ts !== 'number' || !Number.isFinite(event.ts)) {
    issues.push({ eventIndex, code: 'invalid_ts', message: 'Event ts must be a finite number.' })
  }

  issues.push(...validateRequiredFields(event, eventIndex))
  issues.push(...validateSerializablePayloads(event, eventIndex))

  if (event.type === 'run_failed') {
    if (!event.error || typeof event.error.code !== 'string' || typeof event.error.message !== 'string') {
      issues.push({
        eventIndex,
        code: 'invalid_failure_error',
        message: 'run_failed must normalize error as { code: string, message: string }.',
      })
    }
  }

  return issues
}

function validateRequiredFields(event: AgentEvent, eventIndex?: number): RuntimeConformanceIssue[] {
  const issues: RuntimeConformanceIssue[] = []
  const requireString = (field: string, value: unknown): void => {
    if (typeof value !== 'string' || value.length === 0) {
      issues.push({
        eventIndex,
        code: 'missing_required_field',
        message: `${event.type}.${field} must be a non-empty string.`,
      })
    }
  }

  switch (event.type) {
    case 'run_started':
    case 'run_completed':
    case 'run_failed':
    case 'run_cancelled':
      requireString('runId', event.runId)
      break
    case 'model_request':
    case 'model_event':
    case 'assistant_delta':
    case 'assistant_message':
      requireString('requestId', event.requestId)
      break
    case 'tool_call':
    case 'tool_result':
    case 'tool_error':
      requireString('callId', event.callId)
      requireString('toolName', event.toolName)
      break
    case 'step_started':
    case 'step_completed':
      requireString('stepId', event.stepId)
      break
    case 'edge_taken':
      requireString('from', event.from)
      requireString('to', event.to)
      break
    case 'child_run_started':
    case 'child_run_completed':
      requireString('parentRunId', event.parentRunId)
      requireString('childRunId', event.childRunId)
      break
    case 'extension_activated':
    case 'extension_deactivated':
      requireString('extensionId', event.extensionId)
      break
    case 'permission_requested':
    case 'permission_resolved':
      requireString('runId', event.runId)
      break
    case 'runtime_log':
      requireString('message', event.message)
      break
    default:
      break
  }

  return issues
}

function validateSerializablePayloads(event: AgentEvent, eventIndex?: number): RuntimeConformanceIssue[] {
  const issues: RuntimeConformanceIssue[] = []
  const candidates: Array<[string, unknown]> = []

  if ('raw' in event) candidates.push(['raw', event.raw])
  if (event.origin && 'raw' in event.origin) candidates.push(['origin.raw', event.origin.raw])

  for (const [field, value] of candidates) {
    if (value === undefined) continue
    try {
      JSON.stringify(value)
    } catch (error) {
      issues.push({
        eventIndex,
        code: 'non_serializable_payload',
        message: `${event.type}.${field} must be JSON serializable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      })
    }
  }

  return issues
}

function isTerminalEvent(event: AgentEvent): boolean {
  return event.type === 'run_completed' || event.type === 'run_failed' || event.type === 'run_cancelled'
}
