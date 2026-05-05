import type { LlmTracePayload } from '@telegraph/services/agent/common/types'

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool'

export type ChatMessageStatus = 'pending' | 'streaming' | 'done' | 'error'

export interface ChatToolCall {
  id: string
  name: string
  input?: unknown
  output?: unknown
  status: 'running' | 'done' | 'error'
  errorMessage?: string
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: number
  status?: ChatMessageStatus
  toolCalls?: ChatToolCall[]
  errorMessage?: string
}

export interface ChatConversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMessage[]
}

export interface AgentSendOptions {
  conversation: ChatConversation
  onChunk: (delta: string) => void
  onToolCall?: (call: ChatToolCall) => void
  onStatus?: (status: 'queued' | 'running' | 'completed' | 'failed') => void
  /** Raw LLM trace payloads (renderer + daemon); `sessionId` matches the sidebar chat for this run. */
  onLlmTrace?: (info: { sessionId: string; runId: string; trace: LlmTracePayload }) => void
  signal?: AbortSignal
}

export type { LlmTracePayload }

export interface AgentService {
  /** Stream an assistant reply for the given conversation. Resolves when streaming completes. */
  send(opts: AgentSendOptions): Promise<void>
}
