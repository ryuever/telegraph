import { createId } from '@x-oasis/di'
import type { AgentEvent, RuntimeMessage, RuntimeTaskCapabilityProfile } from '@/packages/agent-protocol'
import type { PermissionRequest } from '@/packages/agent-protocol'
import type {
  PermissionBrokerRequestContext,
  PermissionDecision,
} from '@/packages/agent/harness/PermissionBroker'
import type {
  AgentRunEventRecord,
  AgentRunRecord,
  AgentRunReplaySource,
  AgentRunStatus,
  ImportAgentRunBundleResult,
} from '@/packages/agent/persistence/AgentRunRepository'
import type { RuntimeCapabilityDescriptor } from '@/packages/agent/runtime/RuntimeCapabilityDescriptor'

export const CHAT_PAGELET_SERVICE_PATH = 'chat-pagelet-api'

// ---------------------------------------------------------------------------
// Agent runtime settings (renderer → pagelet, pagelet → daemon)
// ---------------------------------------------------------------------------

export interface AgentRuntimeSettings {
  provider: string
  modelId: string
  apiKey: string
  authMode?: 'api-key' | 'subscription'
  subscriptionProvider?: string
  subscriptionCredentials?: {
    refresh: string
    access: string
    expires: number
    [key: string]: unknown
  }
  baseUrl?: string
  backend?: AgentBackendKind
  orchestration?: AgentOrchestrationMode
  orchestrationPattern?: AgentOrchestrationPattern
  worktreeIsolation?: boolean
  extensionBlocklist?: string[]
  taskCapabilityProfile?: RuntimeTaskCapabilityProfile
}

export type AgentBackendKind = 'pi-ai' | 'pi-cli' | 'pi-embedded' | 'telegraph-subagents' | 'langgraph' | 'vercel-ai' | 'telegraph-orchestrator'
export type AgentOrchestrationMode = 'none' | 'telegraph-subagents'
export type AgentOrchestrationPattern = 'chain' | 'parallel'

// ---------------------------------------------------------------------------
// Chat service types
// ---------------------------------------------------------------------------

export interface ChatStreamEvent {
  type: 'run_queued' | 'run_started' | 'text_delta' | 'run_completed' | 'run_failed' | 'done' | 'error' | 'llm_trace' | 'runtime_event' | 'permission_pending'
  runId: string
  sessionId?: string
  sourceIntentId?: string
  message?: string
  text?: string
  error?: string
  trace?: LlmTracePayload
  event?: AgentEvent
  permissionRequest?: ChatPermissionRequestSnapshot
}

export interface EventSubscription {
  unsubscribe(): void
}

export interface ChatSendRequest {
  message: string
  currentMessageId?: string
  messages?: RuntimeMessage[]
  settings: AgentRuntimeSettings
  runId: string
  sessionId: string
  sourceIntentId?: string
  parentRunId?: string
  replay?: AgentRunReplaySource
}

export interface ChatSendResult {
  runId: string
  status: 'completed' | 'failed' | 'cancelled'
  text?: string
  error?: string
}

export type ChatAgentRunStatus = AgentRunStatus

export type ChatAgentRunRecordSnapshot = AgentRunRecord

export type ChatAgentRunEventRecordSnapshot = AgentRunEventRecord

export type ChatRuntimeCapabilityDescriptorSnapshot = RuntimeCapabilityDescriptor

export interface ChatConfiguredModelDescriptorSnapshot {
  provider: string
  id: string
  label: string
  api?: string
  baseUrl?: string
  authConfigured: boolean
  authSource?: 'auth-json' | 'oauth' | 'env' | 'models-json'
  authLabel?: string
}

export interface ChatRunTraceBundle {
  schemaVersion: 1
  exportedAt: number
  run: ChatAgentRunRecordSnapshot
  events: ChatAgentRunEventRecordSnapshot[]
}

export type ChatRunTraceImportResult = ImportAgentRunBundleResult

export interface ChatDeleteSessionRunsResult {
  sessionId: string
  deletedRunIds: string[]
}

export interface ChatPermissionRequestSnapshot {
  id: string
  runId: string
  sessionId?: string
  permission: PermissionRequest
  context: PermissionBrokerRequestContext
  proposedDecision: PermissionDecision
  createdAt: number
}

export interface ChatPermissionResolution {
  granted: boolean
  reason?: string
}

export interface ChatSubagentRecordSnapshot {
  id: string
  parentRunId: string
  agent: string
  label: string
  description: string
  task: string
  status: 'queued' | 'running' | 'completed' | 'stopped' | 'error'
  result?: string
  error?: string
  toolUses: number
  startedAt: number
  completedAt?: number
  resultConsumed?: boolean
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
  listRuns(options?: {
    sessionId?: string
    status?: ChatAgentRunStatus
    limit?: number
    offset?: number
  }): Promise<ChatAgentRunRecordSnapshot[]>
  deleteSessionRuns(sessionId: string): Promise<ChatDeleteSessionRunsResult>
  getRun(runId: string): Promise<ChatAgentRunRecordSnapshot | null>
  listRunEvents(runId: string): Promise<ChatAgentRunEventRecordSnapshot[]>
  listRuntimeCapabilities(): Promise<ChatRuntimeCapabilityDescriptorSnapshot[]>
  listConfiguredModels(): Promise<ChatConfiguredModelDescriptorSnapshot[]>
  exportRunTraceBundle(runId: string): Promise<ChatRunTraceBundle | null>
  importRunTraceBundle(bundle: ChatRunTraceBundle): Promise<ChatRunTraceImportResult>
  listPendingPermissions(runId?: string): Promise<ChatPermissionRequestSnapshot[]>
  resolvePermissionRequest(requestId: string, resolution: ChatPermissionResolution): Promise<boolean>
  listSubagents(): Promise<ChatSubagentRecordSnapshot[]>
  getSubagentResult(childRunId: string, consume?: boolean): Promise<ChatSubagentRecordSnapshot | null>
  cancelSubagent(childRunId: string): Promise<boolean>
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

export type ChatSubagentStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface ChatSubagent {
  runId: string
  name: string
  task?: string
  status: ChatSubagentStatus
  lastUpdate?: string
  summary?: string
  elapsedMs?: number
  startedAt?: number
  completedAt?: number
}

export interface ChatSubagentGroup {
  id: string
  parentRunId: string
  title: string
  agents: ChatSubagent[]
  updatedAt: number
}

export interface ChatSubagentUpdate {
  parentRunId: string
  childRunId: string
  name?: string
  task?: string
  status: ChatSubagentStatus
  lastUpdate?: string
  summary?: string
  elapsedMs?: number
  startedAt?: number
  completedAt?: number
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: number
  status?: ChatMessageStatus
  toolCalls?: ChatToolCall[]
  subagentGroups?: ChatSubagentGroup[]
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
