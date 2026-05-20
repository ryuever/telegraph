import type { LlmTracePayload as CommonLlmTracePayload, ChatConversation } from '@/apps/chat/application/common'

export type { LlmTracePayload, ChatMessage, ChatConversation, ChatToolCall, ChatRole, ChatMessageStatus } from '@/apps/chat/application/common'
export type { ChatSubagent, ChatSubagentGroup, ChatSubagentStatus, ChatSubagentUpdate } from '@/apps/chat/application/common'

export type AgentSendOptions = {
  conversation: ChatConversation
  onChunk: (delta: string) => void
  onToolCall?: (call: import('@/apps/chat/application/common').ChatToolCall) => void
  onSubagentUpdate?: (update: import('@/apps/chat/application/common').ChatSubagentUpdate) => void
  onStatus?: (status: 'queued' | 'running' | 'completed' | 'failed') => void
  onLlmTrace?: (info: { sessionId: string; runId: string; trace: CommonLlmTracePayload }) => void
  signal?: AbortSignal
}

export interface AgentService {
  send(opts: AgentSendOptions): Promise<void>
}
