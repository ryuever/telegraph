import type { AgentEvent } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'

/**
 * Design runs emit huge streaming volumes. Persist and display only compact
 * ledger rows: workflow/tool events plus one assistant_message per request.
 */
export function shouldPersistDesignRunEvent(event: AgentEvent): boolean {
  if (event.type === 'model_event' || event.type === 'assistant_delta') return false
  if (event.type === 'runtime_log' && isThinkingRuntimeLog(event)) return false
  return true
}

export function compactDesignPersistedEvent(event: AgentEvent): AgentEvent {
  if (event.type !== 'model_request') return event
  if (event.raw === undefined) return event
  const { raw: _raw, ...rest } = event
  return rest
}

export function sanitizeDesignRunConsoleEvents(events: AgentEvent[]): AgentEvent[] {
  const sanitized: AgentEvent[] = []
  const assistantByRequest = new Map<string, string>()

  const flushAssistant = (
    runId: string | undefined,
    requestId: string,
    producerVersion?: string,
    ts?: number,
  ) => {
    const text = assistantByRequest.get(requestId)?.trim()
    if (!text) return
    sanitized.push({
      type: 'assistant_message',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      producerVersion,
      runId,
      requestId,
      message: {
        id: `${runId ?? 'run'}:${requestId}:assistant`,
        role: 'assistant',
        content: text,
      },
      ts: ts ?? Date.now(),
    })
    assistantByRequest.delete(requestId)
  }

  for (const event of events) {
    if (event.type === 'model_event' || isThinkingRuntimeLog(event)) continue

    if (event.type === 'assistant_delta') {
      assistantByRequest.set(
        event.requestId,
        `${assistantByRequest.get(event.requestId) ?? ''}${event.text}`,
      )
      continue
    }

    if (shouldFlushDesignAssistantSnapshot(event)) {
      for (const requestId of [...assistantByRequest.keys()]) {
        flushAssistant(event.runId, requestId, event.producerVersion, event.ts)
      }
    }

    sanitized.push(event.type === 'model_request' ? compactDesignPersistedEvent(event) : event)
  }

  for (const [requestId, text] of assistantByRequest) {
    const content = text.trim()
    if (!content) continue
    sanitized.push({
      type: 'assistant_message',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: undefined,
      requestId,
      message: {
        id: `run:${requestId}:assistant`,
        role: 'assistant',
        content,
      },
      ts: Date.now(),
    })
  }

  return sanitized
}

export function shouldFlushDesignAssistantSnapshot(event: AgentEvent): boolean {
  return event.type === 'tool_call' ||
    event.type === 'tool_result' ||
    event.type === 'tool_error' ||
    event.type === 'model_request' ||
    event.type === 'assistant_message' ||
    event.type === 'run_completed' ||
    event.type === 'run_failed' ||
    event.type === 'run_cancelled' ||
    event.type === 'child_run_completed' ||
    event.type === 'step_completed'
}

function isThinkingRuntimeLog(event: AgentEvent): boolean {
  return event.type === 'runtime_log' &&
    (event.message === 'thinking_delta' || rawEventType(event.raw).includes('thinking'))
}

function rawEventType(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const type = (value as Record<string, unknown>).type
  return typeof type === 'string' ? type : ''
}
