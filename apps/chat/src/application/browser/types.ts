import type {
  LlmTracePayload as CommonLlmTracePayload,
  ChatAgentRunEventRecordSnapshot,
  ChatAgentRunRecordSnapshot,
  ChatAgentRunStatus,
  ChatConversation,
  ChatPermissionRequestSnapshot,
  ChatPermissionResolution,
  ChatRunTraceBundle,
  ChatRunTraceImportResult,
  ChatRuntimeCapabilityDescriptorSnapshot,
  ChatSubagentRecordSnapshot,
  ChatStreamEvent,
  EventSubscription,
} from '@/apps/chat/application/common'
import type { AgentRunReplaySource } from '@/packages/agent/persistence/AgentRunRepository'

export type { LlmTracePayload, ChatMessage, ChatConversation, ChatToolCall, ChatRole, ChatMessageStatus } from '@/apps/chat/application/common'
export type { ChatSubagent, ChatSubagentGroup, ChatSubagentRecordSnapshot, ChatSubagentStatus, ChatSubagentUpdate } from '@/apps/chat/application/common'
export type { ChatAgentRunEventRecordSnapshot, ChatAgentRunRecordSnapshot, ChatAgentRunStatus } from '@/apps/chat/application/common'
export type { ChatRuntimeCapabilityDescriptorSnapshot } from '@/apps/chat/application/common'
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
  getRun?(runId: string, signal?: AbortSignal): Promise<ChatAgentRunRecordSnapshot | null>
  listRunEvents?(runId: string, signal?: AbortSignal): Promise<ChatAgentRunEventRecordSnapshot[]>
  listRuntimeCapabilities?(signal?: AbortSignal): Promise<ChatRuntimeCapabilityDescriptorSnapshot[]>
  exportRunTraceBundle?(runId: string, signal?: AbortSignal): Promise<ChatRunTraceBundle | null>
  importRunTraceBundle?(bundle: ChatRunTraceBundle, signal?: AbortSignal): Promise<ChatRunTraceImportResult>
  listPendingPermissions?(runId?: string, signal?: AbortSignal): Promise<ChatPermissionRequestSnapshot[]>
  resolvePermissionRequest?(requestId: string, resolution: ChatPermissionResolution, signal?: AbortSignal): Promise<boolean>
  subscribeToStreamEvents?(callback: (event: ChatStreamEvent) => void, signal?: AbortSignal): Promise<EventSubscription>
  listSubagents(signal?: AbortSignal): Promise<ChatSubagentRecordSnapshot[]>
  getSubagentResult(childRunId: string, options?: { consume?: boolean; signal?: AbortSignal }): Promise<ChatSubagentRecordSnapshot | null>
  cancelSubagent(childRunId: string, signal?: AbortSignal): Promise<boolean>
}
