import type { AgentEvent } from '@/packages/agent-protocol'
import type { ChatToolCall, LlmTracePayload } from '@/apps/chat/application/common'

export interface ChatAgentEventProjectionHandlers {
  sessionId: string
  runId: string
  onChunk: (delta: string) => void
  onToolCall?: (call: ChatToolCall) => void
  onStatus?: (status: 'queued' | 'running' | 'completed' | 'failed') => void
  onLlmTrace?: (info: { sessionId: string; runId: string; trace: LlmTracePayload }) => void
}

export function projectAgentEventToChat(event: AgentEvent, handlers: ChatAgentEventProjectionHandlers): void {
  handlers.onLlmTrace?.({
    sessionId: handlers.sessionId,
    runId: handlers.runId,
    trace: { kind: 'runtime_event', event },
  })

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

export function isLegacyProjectionEvent(type: string): boolean {
  return type === 'run_started' ||
    type === 'text_delta' ||
    type === 'run_completed' ||
    type === 'run_failed' ||
    type === 'done' ||
    type === 'error'
}
