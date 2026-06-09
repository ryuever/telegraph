import type {
  LlmTracePayload as CommonLlmTracePayload,
  ChatAgentRunEventRecordSnapshot,
  ChatAgentRunRecordSnapshot,
  ChatAgentRunStatus,
  ChatConversation,
  ChatDeleteSessionRunsResult,
  ChatPermissionRequestSnapshot,
  ChatPermissionResolution,
  ChatRunTraceBundle,
  ChatRunTraceImportResult,
  ChatRuntimeCapabilityDescriptorSnapshot,
  ChatConfiguredModelDescriptorSnapshot,
  ChatSubagentRecordSnapshot,
  ChatStreamEvent,
  ChatCommandInvocationResult,
  EventSubscription,
  AgentRuntimeSettings,
} from '@/apps/chat/application/common'
import type { AgentRunReplaySource } from '@/packages/agent/persistence/AgentRunRepository'

export type { LlmTracePayload, ChatMessage, ChatConversation, ChatToolCall, ChatRole, ChatMessageStatus } from '@/apps/chat/application/common'
export type { ChatSubagent, ChatSubagentGroup, ChatSubagentRecordSnapshot, ChatSubagentStatus, ChatSubagentUpdate } from '@/apps/chat/application/common'
export type { ChatAgentRunEventRecordSnapshot, ChatAgentRunRecordSnapshot, ChatAgentRunStatus } from '@/apps/chat/application/common'
export type { ChatDeleteSessionRunsResult } from '@/apps/chat/application/common'
export type { ChatRuntimeCapabilityDescriptorSnapshot } from '@/apps/chat/application/common'
export type { ChatConfiguredModelDescriptorSnapshot } from '@/apps/chat/application/common'
export type { ChatRunTraceBundle, ChatRunTraceImportResult } from '@/apps/chat/application/common'
export type { ChatPermissionRequestSnapshot, ChatPermissionResolution } from '@/apps/chat/application/common'

export type AgentSendOptions = {
  conversation: ChatConversation
  parentRunId?: string
  replay?: AgentRunReplaySource
  onChunk: (delta: string) => void
  onToolCall?: (call: import('@/apps/chat/application/common').ChatToolCall) => void
  onSubagentUpdate?: (update: import('@/apps/chat/application/common').ChatSubagentUpdate) => void
  onPermissionRequest?: (request: ChatPermissionRequestSnapshot) => void
  onStatus?: (status: 'queued' | 'running' | 'completed' | 'failed') => void
  onLlmTrace?: (info: { sessionId: string; runId: string; trace: CommonLlmTracePayload }) => void
  signal?: AbortSignal
}

export interface AgentService {
  send(opts: AgentSendOptions): Promise<void>
  listRuns?(options?: { sessionId?: string; status?: ChatAgentRunStatus; limit?: number; offset?: number; signal?: AbortSignal }): Promise<ChatAgentRunRecordSnapshot[]>
  deleteSessionRuns?(sessionId: string, signal?: AbortSignal): Promise<ChatDeleteSessionRunsResult>
  getRun?(runId: string, signal?: AbortSignal): Promise<ChatAgentRunRecordSnapshot | null>
  listRunEvents?(runId: string, signal?: AbortSignal): Promise<ChatAgentRunEventRecordSnapshot[]>
  listRuntimeCapabilities?(signal?: AbortSignal): Promise<ChatRuntimeCapabilityDescriptorSnapshot[]>
  listConfiguredModels?(signal?: AbortSignal): Promise<ChatConfiguredModelDescriptorSnapshot[]>
  getRuntimeSettings?(signal?: AbortSignal): Promise<AgentRuntimeSettings>
  updateRuntimeSettings?(settings: AgentRuntimeSettings, signal?: AbortSignal): Promise<AgentRuntimeSettings>
  exportRunTraceBundle?(runId: string, signal?: AbortSignal): Promise<ChatRunTraceBundle | null>
  importRunTraceBundle?(bundle: ChatRunTraceBundle, signal?: AbortSignal): Promise<ChatRunTraceImportResult>
  listPendingPermissions?(runId?: string, signal?: AbortSignal): Promise<ChatPermissionRequestSnapshot[]>
  resolvePermissionRequest?(requestId: string, resolution: ChatPermissionResolution, signal?: AbortSignal): Promise<boolean>
  subscribeToStreamEvents?(callback: (event: ChatStreamEvent) => void, signal?: AbortSignal): Promise<EventSubscription>
  listSubagents(signal?: AbortSignal): Promise<ChatSubagentRecordSnapshot[]>
  getSubagentResult(childRunId: string, options?: { consume?: boolean; signal?: AbortSignal }): Promise<ChatSubagentRecordSnapshot | null>
  cancelSubagent(childRunId: string, signal?: AbortSignal): Promise<boolean>
  /**
   * Invoke an extension-registered slash command by id. Optional because not
   * every AgentService implementation runs against a real pagelet (test
   * doubles can omit it). Renderers that depend on slash commands MUST
   * feature-detect: `if (agentService.invokeCommand) { ... }`.
   *
   * Result envelope mirrors `IChatPageletService.invokeCommand` — `{ ok }`
   * discriminator carries either `result` or `error`.
   */
  invokeCommand?(commandId: string, args?: unknown, signal?: AbortSignal): Promise<ChatCommandInvocationResult>
}
