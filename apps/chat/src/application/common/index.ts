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

/**
 * Mirrored from `@/packages/agent` (`packages/agent/src/types.ts`).
 *
 * The chat pagelet keeps its own copy to avoid a hard dependency from the
 * common/types layer on the agent package, but the semantics must stay in
 * sync. As of D-016 P8 these unions widen to `(string & {})` so the agent
 * kernel no longer needs to know any extension-contributed runtime id at
 * compile time; chat UI is still allowed to hardcode specific values
 * (e.g. `'telegraph-subagents'` for the first-party Team Router option)
 * because chat deliberately ships with first-class subagent support.
 */
export type AgentBackendKind =
  | 'pi-ai'
  | 'pi-cli'
  | 'pi-embedded'
  | 'langgraph'
  | 'vercel-ai'
  | 'telegraph-orchestrator'
  | (string & Record<never, never>)
export type AgentOrchestrationMode =
  | 'none'
  | (string & Record<never, never>)
export type AgentOrchestrationPattern = 'chain' | 'parallel'

// ---------------------------------------------------------------------------
// Chat service types
// ---------------------------------------------------------------------------

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
  authSource?: 'runtime' | 'project-config' | 'env' | 'subscription-settings'
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

export interface ChatRunQueuedStreamEvent {
  type: 'run_queued'
  runId: string
  sessionId?: string
  sourceIntentId?: string
  message?: string
}

export interface ChatPermissionPendingStreamEvent {
  type: 'permission_pending'
  runId: string
  sessionId?: string
  permissionRequest: ChatPermissionRequestSnapshot
}

/**
 * 4-pack item D: notify surface that the chat pagelet exposes through
 * the extension host's custom registry under
 * {@link CHAT_NOTIFY_CAPABILITY_KEY}. Extensions resolve it via
 * `host.getCustom(CHAT_NOTIFY_CAPABILITY_KEY)` during activation and call
 * it from inside hook handlers (or whenever) to surface a toast/banner.
 *
 * Implementations MUST be synchronous and side-effect-only — the result
 * is intentionally void so extension authors don't accidentally await
 * delivery inside a hot model path (I-002 deadlock pattern equivalent
 * for the stream channel).
 */
export interface ChatNotifyCapability {
  (input: {
    extensionId: string
    level?: 'info' | 'warn' | 'error'
    message: string
    runId?: string
    sessionId?: string
  }): void
}

/** Custom-registry key used by {@link ChatNotifyCapability}. */
export const CHAT_NOTIFY_CAPABILITY_KEY = 'chat.notify'

/**
 * 4-pack item D: extension-originated notification surfaced as a stream
 * event so the renderer can show a toast/banner without rendering it as a
 * conversation message. Emitted whenever an extension calls
 * `host.notify({ ... })` (see ChatPageletWorker's notify capability).
 *
 * `runId` is optional because some extensions notify in response to
 * lifecycle events outside a run (activation, periodic timers); chat
 * surfaces these as global toasts not tied to any conversation.
 */
export interface ChatExtensionNotificationStreamEvent {
  type: 'extension_notification'
  runId?: string
  sessionId?: string
  extensionId: string
  level: 'info' | 'warn' | 'error'
  message: string
  ts: number
}

export type ChatStreamEvent =
  | AgentEvent
  | ChatRunQueuedStreamEvent
  | ChatPermissionPendingStreamEvent
  | ChatExtensionNotificationStreamEvent

export function isChatRunQueuedStreamEvent(event: ChatStreamEvent): event is ChatRunQueuedStreamEvent {
  return event.type === 'run_queued'
}

export function isChatPermissionPendingStreamEvent(event: ChatStreamEvent): event is ChatPermissionPendingStreamEvent {
  return event.type === 'permission_pending'
}

export function isChatExtensionNotificationStreamEvent(
  event: ChatStreamEvent,
): event is ChatExtensionNotificationStreamEvent {
  return event.type === 'extension_notification'
}

export function isChatTransportStreamEvent(
  event: ChatStreamEvent,
): event is ChatRunQueuedStreamEvent | ChatPermissionPendingStreamEvent | ChatExtensionNotificationStreamEvent {
  return (
    event.type === 'run_queued' ||
    event.type === 'permission_pending' ||
    event.type === 'extension_notification'
  )
}

export function isAgentStreamEvent(event: ChatStreamEvent): event is AgentEvent {
  return !isChatTransportStreamEvent(event)
}

export function chatStreamParentRunId(
  event: ChatStreamEvent,
  childRunParents: ReadonlyMap<string, string> = new Map(),
): string | undefined {
  if (isChatTransportStreamEvent(event)) {
    return event.runId
  }
  if (event.type === 'child_run_started' || event.type === 'child_run_completed') {
    return event.parentRunId
  }
  if ('runId' in event && typeof event.runId === 'string') {
    return childRunParents.get(event.runId) ?? event.runId
  }
  return undefined
}

export function chatStreamBelongsToRun(
  event: ChatStreamEvent,
  runId: string,
  childRunParents: ReadonlyMap<string, string> = new Map(),
): boolean {
  if (isChatTransportStreamEvent(event)) {
    return event.runId === runId
  }
  const parentRunId = chatStreamParentRunId(event, childRunParents)
  if (parentRunId === undefined) {
    return true
  }
  return parentRunId === runId
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
  getRuntimeSettings(): Promise<AgentRuntimeSettings>
  updateRuntimeSettings(settings: AgentRuntimeSettings): Promise<AgentRuntimeSettings>
  exportRunTraceBundle(runId: string): Promise<ChatRunTraceBundle | null>
  importRunTraceBundle(bundle: ChatRunTraceBundle): Promise<ChatRunTraceImportResult>
  listPendingPermissions(runId?: string): Promise<ChatPermissionRequestSnapshot[]>
  resolvePermissionRequest(requestId: string, resolution: ChatPermissionResolution): Promise<boolean>
  listSubagents(): Promise<ChatSubagentRecordSnapshot[]>
  getSubagentResult(childRunId: string, consume?: boolean): Promise<ChatSubagentRecordSnapshot | null>
  cancelSubagent(childRunId: string): Promise<boolean>
  /**
   * Invoke an extension-registered slash command by id (the same id the
   * extension passed to `host.registerCommand({ id, ... })`). Args are
   * forwarded verbatim to the command's `invoke` callback; the return value
   * is whatever the extension chose to return. Renderers typically pre-parse
   * the user's `/foo bar` input into a structured args object before calling
   * this RPC.
   *
   * Resolves with `{ ok: false, error: ... }` if no command with that id is
   * active (extension not loaded / typo) or if the command has no `invoke`
   * handler (renderer-side commands per CapabilityHost docs). Resolves with
   * `{ ok: true, result }` on success. Errors thrown by the command's
   * `invoke` are surfaced as `{ ok: false, error: e.message }` rather than
   * propagated through the RPC boundary so the renderer never crashes on an
   * extension-author bug.
   */
  invokeCommand(commandId: string, args?: unknown): Promise<ChatCommandInvocationResult>
  onStreamEvent(callback: (event: ChatStreamEvent) => void): EventSubscription
}

/**
 * Result envelope for {@link IChatPageletService.invokeCommand}. Renderers
 * pattern-match on `ok` to distinguish "command produced a value" from
 * "command not found / command threw".
 */
export type ChatCommandInvocationResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string }

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
