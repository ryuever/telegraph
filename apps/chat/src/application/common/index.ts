import { createId } from '@x-oasis/di'
import type { AgentEvent } from '@/packages/agent-protocol'

export const CHAT_PAGELET_SERVICE_PATH = 'chat-pagelet-api'

// ---------------------------------------------------------------------------
// Agent runtime settings (renderer → pagelet, pagelet → daemon)
// ---------------------------------------------------------------------------

export interface AgentRuntimeSettings {
  provider: string
  modelId: string
  apiKey: string
  baseUrl?: string
  backend?: AgentBackendKind
  orchestration?: AgentOrchestrationMode
  orchestrationPattern?: AgentOrchestrationPattern
  worktreeIsolation?: boolean
  extensionBlocklist?: string[]
}

export type AgentBackendKind = 'pi-ai' | 'pi-cli' | 'pi-embedded' | 'pi-subagents' | 'langgraph' | 'vercel-ai' | 'telegraph-orchestrator'
export type AgentOrchestrationMode = 'none' | 'pi-subagents'
export type AgentOrchestrationPattern = 'chain' | 'parallel'

// ---------------------------------------------------------------------------
// Chat service types
// ---------------------------------------------------------------------------

export interface ChatStreamEvent {
  type: 'run_queued' | 'run_started' | 'text_delta' | 'run_completed' | 'run_failed' | 'done' | 'error' | 'llm_trace' | 'runtime_event'
  runId: string
  sessionId?: string
  text?: string
  error?: string
  trace?: LlmTracePayload
  event?: AgentEvent
}

export interface EventSubscription {
  unsubscribe(): void
}

export interface ChatSendRequest {
  message: string
  settings: AgentRuntimeSettings
  runId: string
  sessionId: string
}

export interface ChatSendResult {
  runId: string
  status: 'completed' | 'failed'
  text?: string
  error?: string
}

// ---------------------------------------------------------------------------
// LLM trace payloads (renderer-side trace rows)
// ---------------------------------------------------------------------------

export type LlmTracePayload =
  | {
      kind: 'telegraph_turn_context'
      messages: Array<{ id: string; role: string; content: string; status?: string }>
      runtimeSettingsSummary: {
        provider: string
        modelId: string
        backend: string
        orchestration: string
        pattern: string | null
      }
    }
  | {
      kind: 'pi_cli_request'
      userMessage: string
      promptPassedToPi: string
      provider?: string
      modelId?: string
      orchestration?: string
      pattern?: string | null
    }
  | {
      kind: 'pi_json_line'
      payload: unknown
    }
  | {
      kind: 'pi_ai_request'
      context: unknown
      options: { hasApiKey: boolean; signal: boolean }
      systemPrompt: string
      messages: Array<{ role: string; content: string }>
      provider?: string
      modelId?: string
    }
  | {
      kind: 'pi_ai_stream_event'
      event: unknown
    }
  | {
      kind: 'runtime_event'
      event: AgentEvent
    }

// ---------------------------------------------------------------------------
// Chat service RPC interface (renderer ↔ pagelet)
// ---------------------------------------------------------------------------

export interface IChatPageletService {
  info(): Promise<string>
  send(request: ChatSendRequest): Promise<ChatSendResult>
  cancel(runId: string): Promise<boolean>
  onStreamEvent(callback: (event: ChatStreamEvent) => void): EventSubscription
}

// ---------------------------------------------------------------------------
// Model descriptor (for UI picker)
// ---------------------------------------------------------------------------

export type ModelDescriptor =
  | { kind: 'builtin'; provider: string; id: string; label: string }
  | { kind: 'custom'; provider: string; id: string; label: string; model: unknown }

export const MINIMAX_PROVIDER_ID = 'minimax'
export const MINIMAX_CN_PROVIDER_ID = 'minimax-cn'
export const MINIMAX_OPENAI_COMPAT_PROVIDER_ID = 'minimax-openai-compat'

export const DEFAULT_MODEL_CATALOG: ModelDescriptor[] = [
  { kind: 'builtin', provider: MINIMAX_PROVIDER_ID, id: 'MiniMax-M2.7', label: 'MiniMax · M2.7' },
  { kind: 'builtin', provider: MINIMAX_PROVIDER_ID, id: 'MiniMax-M2.7-highspeed', label: 'MiniMax · M2.7 highspeed' },
  { kind: 'builtin', provider: MINIMAX_CN_PROVIDER_ID, id: 'MiniMax-M2.7', label: 'MiniMax (CN) · M2.7' },
  { kind: 'builtin', provider: MINIMAX_CN_PROVIDER_ID, id: 'MiniMax-M2.7-highspeed', label: 'MiniMax (CN) · M2.7 highspeed' },
  { kind: 'builtin', provider: 'anthropic', id: 'claude-sonnet-4-5', label: 'Anthropic · Claude Sonnet 4.5' },
  { kind: 'builtin', provider: 'openai', id: 'gpt-4o-mini', label: 'OpenAI · GPT-4o mini' },
  { kind: 'builtin', provider: 'openai', id: 'gpt-4o', label: 'OpenAI · GPT-4o' },
]

// ---------------------------------------------------------------------------
// Chat message types (shared between browser components and stores)
// ---------------------------------------------------------------------------

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

export interface IChatApplication {
  start(): Promise<void>
}

export const ChatApplicationId = createId('ChatApplication')
