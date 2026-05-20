import type { AgentEvent } from '@/packages/agent-protocol'
import type { ChatSubagentStatus, ChatSubagentUpdate, ChatToolCall, LlmTracePayload } from '@/apps/chat/application/common'

export interface ChatAgentEventProjectionState {
  childRunParents: Map<string, string>
  childRunNames: Map<string, string>
  childRunText: Map<string, string>
}

export interface ChatAgentEventProjectionHandlers {
  sessionId: string
  runId: string
  onChunk: (delta: string) => void
  onToolCall?: (call: ChatToolCall) => void
  onSubagentUpdate?: (update: ChatSubagentUpdate) => void
  onStatus?: (status: 'queued' | 'running' | 'completed' | 'failed') => void
  onLlmTrace?: (info: { sessionId: string; runId: string; trace: LlmTracePayload }) => void
  projectionState?: ChatAgentEventProjectionState
}

export function createChatAgentEventProjectionState(): ChatAgentEventProjectionState {
  return {
    childRunParents: new Map<string, string>(),
    childRunNames: new Map<string, string>(),
    childRunText: new Map<string, string>(),
  }
}

export function projectAgentEventToChat(event: AgentEvent, handlers: ChatAgentEventProjectionHandlers): void {
  handlers.onLlmTrace?.({
    sessionId: handlers.sessionId,
    runId: handlers.runId,
    trace: { kind: 'runtime_event', event },
  })

  if (projectSubagentEvent(event, handlers)) {
    return
  }

  if (!belongsToProjectedRun(event, handlers.runId)) {
    return
  }

  switch (event.type) {
    case 'run_started':
      handlers.onStatus?.('running')
      return

    case 'assistant_delta':
      handlers.onStatus?.('running')
      if (event.text) handlers.onChunk(event.text)
      return

    case 'tool_call':
      handlers.onToolCall?.({
        id: event.callId,
        name: event.toolName,
        input: event.input,
        status: 'running',
      })
      return

    case 'tool_result':
      handlers.onToolCall?.({
        id: event.callId,
        name: event.toolName,
        output: event.output,
        status: 'done',
      })
      return

    case 'tool_error':
      handlers.onToolCall?.({
        id: event.callId,
        name: event.toolName,
        status: 'error',
        errorMessage: event.error.message,
      })
      return

    case 'run_completed':
      handlers.onStatus?.('completed')
      return

    case 'run_failed':
    case 'run_cancelled':
      handlers.onStatus?.('failed')
      return

    default:
      return
  }
}

function projectSubagentEvent(event: AgentEvent, handlers: ChatAgentEventProjectionHandlers): boolean {
  if (event.type === 'child_run_started') {
    if (event.parentRunId !== handlers.runId) return true
    const name = event.label ?? compactRunLabel(event.childRunId)
    handlers.projectionState?.childRunParents.set(event.childRunId, event.parentRunId)
    handlers.projectionState?.childRunNames.set(event.childRunId, name)
    handlers.projectionState?.childRunText.set(event.childRunId, '')
    handlers.onSubagentUpdate?.({
      parentRunId: event.parentRunId,
      childRunId: event.childRunId,
      name,
      status: 'running',
      lastUpdate: 'Starting',
      startedAt: event.ts,
    })
    return true
  }

  if (event.type === 'child_run_completed') {
    if (event.parentRunId !== handlers.runId) return true
    const name = readStringField(event, 'label') ??
      handlers.projectionState?.childRunNames.get(event.childRunId) ??
      compactRunLabel(event.childRunId)
    const status = childCompletionStatus(event.output)
    handlers.onSubagentUpdate?.({
      parentRunId: event.parentRunId,
      childRunId: event.childRunId,
      name,
      status,
      summary: summarizeChildOutput(event.output),
      elapsedMs: readDurationMs(event.output),
      completedAt: event.ts,
    })
    return true
  }

  const eventRunId = 'runId' in event && typeof event.runId === 'string' ? event.runId : undefined
  if (!eventRunId) return false

  const parentRunId = handlers.projectionState?.childRunParents.get(eventRunId)
  if (parentRunId !== handlers.runId) return false

  const name = handlers.projectionState?.childRunNames.get(eventRunId) ?? compactRunLabel(eventRunId)
  const base = { parentRunId, childRunId: eventRunId, name }

  if (event.type === 'assistant_delta') {
    const previous = handlers.projectionState?.childRunText.get(eventRunId) ?? ''
    const next = previous + event.text
    handlers.projectionState?.childRunText.set(eventRunId, next)
    handlers.onSubagentUpdate?.({
      ...base,
      status: 'running',
      lastUpdate: previewText(next),
    })
    return true
  }

  if (event.type === 'tool_call') {
    handlers.onSubagentUpdate?.({
      ...base,
      status: 'running',
      lastUpdate: `Using ${event.toolName}`,
    })
    return true
  }

  if (event.type === 'tool_result') {
    handlers.onSubagentUpdate?.({
      ...base,
      status: 'running',
      lastUpdate: `Finished ${event.toolName}`,
    })
    return true
  }

  if (event.type === 'tool_error') {
    handlers.onSubagentUpdate?.({
      ...base,
      status: 'running',
      lastUpdate: `${event.toolName} failed: ${event.error.message}`,
    })
    return true
  }

  if (event.type === 'run_failed') {
    handlers.onSubagentUpdate?.({
      ...base,
      status: 'failed',
      summary: event.error.message,
      completedAt: event.ts,
    })
    return true
  }

  if (event.type === 'run_cancelled') {
    handlers.onSubagentUpdate?.({
      ...base,
      status: 'cancelled',
      summary: event.reason ?? 'Cancelled',
      completedAt: event.ts,
    })
    return true
  }

  return true
}

function belongsToProjectedRun(event: AgentEvent, runId: string): boolean {
  if ('runId' in event && typeof event.runId === 'string') {
    return event.runId === runId
  }
  return true
}

function childCompletionStatus(output: unknown): ChatSubagentStatus {
  const exitCode = readNumberField(output, 'exitCode')
  if (exitCode === undefined) return 'completed'
  return exitCode === 0 ? 'completed' : 'failed'
}

function summarizeChildOutput(output: unknown): string | undefined {
  const text = readStringField(output, 'text')
  if (text) return previewText(text)
  if (typeof output === 'string') return previewText(output)
  return undefined
}

function readDurationMs(output: unknown): number | undefined {
  return readNumberField(output, 'durationMs')
}

function readStringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined
  const candidate = value[key]
  return typeof candidate === 'string' ? candidate : undefined
}

function readNumberField(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined
  const candidate = value[key]
  return typeof candidate === 'number' ? candidate : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function previewText(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > 140 ? `${compact.slice(0, 137)}...` : compact
}

function compactRunLabel(runId: string): string {
  const last = runId.split('-').filter(Boolean).at(-1)
  if (!last) return 'Subagent'
  return last.slice(0, 1).toUpperCase() + last.slice(1)
}

export function isLegacyProjectionEvent(type: string): boolean {
  return type === 'run_started' ||
    type === 'text_delta' ||
    type === 'run_completed' ||
    type === 'run_failed' ||
    type === 'done' ||
    type === 'error'
}
