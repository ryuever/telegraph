import type { RuntimeEvent } from '@telegraph/runtime-contracts'
import type { LlmTracePayload as CommonLlmTracePayload, ChatMessage, ChatConversation } from '@telegraph/chat/application/common'

export type { LlmTracePayload, ChatMessage, ChatConversation, ChatToolCall, ChatRole, ChatMessageStatus } from '@telegraph/chat/application/common'

export type AgentSendOptions = {
  conversation: ChatConversation
  onChunk: (delta: string) => void
  onToolCall?: (call: import('@telegraph/chat/application/common').ChatToolCall) => void
  onStatus?: (status: 'queued' | 'running' | 'completed' | 'failed') => void
  onLlmTrace?: (info: { sessionId: string; runId: string; trace: CommonLlmTracePayload }) => void
  signal?: AbortSignal
}

export interface AgentService {
  send(opts: AgentSendOptions): Promise<void>
}
