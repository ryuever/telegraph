import type { AgentEvent } from './events.js'
import type { RuntimeMessage } from './messages.js'
import type { AgentRunRequest } from './runtime.js'
import type { ToolResult } from './tools.js'

export type HookName =
  | 'input'
  | 'beforeRun'
  | 'afterRun'
  | 'beforeModelRequest'
  | 'afterModelEvent'
  | 'beforeToolCall'
  | 'afterToolResult'
  | 'onRuntimeEvent'
  | 'onMessageCommitted'

export interface InputHookEvent {
  type: 'input'
  runId: string
  sessionId: string
  text: string
  messages: RuntimeMessage[]
  images?: unknown[]
  metadata?: Record<string, unknown>
  ts: number
}

export type InputHookResult =
  | { action: 'continue' }
  | {
      action: 'transform'
      text: string
      messages?: RuntimeMessage[]
      images?: unknown[]
      metadata?: Record<string, unknown>
    }
  | { action: 'block'; reason: string; metadata?: Record<string, unknown> }

export type FeedbackLevel = 'debug' | 'info' | 'warn' | 'error'

export interface FeedbackEvent {
  type: 'feedback'
  runId?: string
  sessionId?: string
  level: FeedbackLevel
  message: string
  raw?: unknown
  ts: number
}

export interface FeedbackProgressEvent extends FeedbackEvent {
  current?: number
  total?: number
}

export interface FeedbackConfirmationRequest {
  type: 'feedback_confirm'
  runId?: string
  sessionId?: string
  title: string
  message: string
  raw?: unknown
  ts: number
}

export interface BeforeRunHookPayload {
  request: AgentRunRequest
  runtimeId: string
}

export interface AfterRunHookPayload extends BeforeRunHookPayload {
  terminalEvent?: AgentEvent
}

export interface RuntimeEventHookPayload extends BeforeRunHookPayload {
  event: AgentEvent
}

export interface ModelRequestHookPayload extends BeforeRunHookPayload {
  requestId: string
  payload: unknown
}

export interface ModelEventHookPayload extends BeforeRunHookPayload {
  requestId: string
  event: AgentEvent
}

export interface ToolCallHookPayload extends BeforeRunHookPayload {
  callId: string
  toolName: string
  input: unknown
}

export interface ToolResultHookPayload extends BeforeRunHookPayload {
  callId: string
  toolName: string
  result: ToolResult
}

export interface MessageCommittedHookPayload extends BeforeRunHookPayload {
  message: RuntimeMessage
}

export interface HookPayloadMap {
  input: InputHookEvent
  beforeRun: BeforeRunHookPayload
  afterRun: AfterRunHookPayload
  beforeModelRequest: ModelRequestHookPayload
  afterModelEvent: ModelEventHookPayload
  beforeToolCall: ToolCallHookPayload
  afterToolResult: ToolResultHookPayload
  onRuntimeEvent: RuntimeEventHookPayload
  onMessageCommitted: MessageCommittedHookPayload
}

export interface HookResultMap {
  input: InputHookResult
  beforeRun: undefined
  afterRun: undefined
  beforeModelRequest: undefined
  afterModelEvent: undefined
  beforeToolCall: undefined
  afterToolResult: undefined
  onRuntimeEvent: undefined
  onMessageCommitted: undefined
}

export type HookPayload<N extends HookName> = HookPayloadMap[N]

export type HookResult<N extends HookName> = HookResultMap[N]

export type HookHandler<N extends HookName> = N extends 'input'
  ? (payload: HookPayload<N>) => InputHookResult | Promise<InputHookResult>
  : (payload: HookPayload<N>) => void | Promise<void>
