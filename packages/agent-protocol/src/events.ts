import type { RuntimeError } from './errors.js'
import type { RuntimeMessage } from './messages.js'
import type { PermissionRequest } from './permissions.js'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from './version.js'
import type { StepKind, WorkflowPattern } from './workflow.js'

/** Present on every runtime event — versioned wire contract (A-005 §4.2.1). */
export type RuntimeEventSchemaFields = {
  schemaVersion: typeof RUNTIME_CONTRACT_SCHEMA_VERSION
  /** Semver or build id of the adapter that produced the event. */
  producerVersion?: string
  /** Optional correlation to the framework that emitted the underlying raw payload. */
  origin?: RuntimeOrigin
}

export interface RuntimeOrigin {
  framework: 'pi' | 'langgraph' | 'ai-sdk' | 'mastra' | 'telegraph' | 'custom'
  runtimeId?: string
  raw?: unknown
}

type V = RuntimeEventSchemaFields

export type RunLifecycleEvent = V &
  (
    | { type: 'run_started'; runId: string; pattern?: WorkflowPattern; ts: number; raw?: unknown }
    | { type: 'run_completed'; runId: string; output: unknown; raw?: unknown; ts: number }
    | { type: 'run_failed'; runId: string; error: RuntimeError; raw?: unknown; ts: number }
    | { type: 'run_cancelled'; runId: string; reason?: string; ts: number; raw?: unknown }
  )

export type ModelEvent = V &
  (
    | { type: 'model_request'; runId?: string; requestId: string; payload: unknown; raw?: unknown; ts: number }
    | { type: 'model_event'; runId?: string; requestId: string; raw: unknown; ts: number }
    | { type: 'assistant_delta'; runId?: string; requestId: string; text: string; raw?: unknown; ts: number }
    | { type: 'assistant_message'; runId?: string; requestId: string; message: RuntimeMessage; raw?: unknown; ts: number }
  )

export type ToolEvent = V &
  (
    | { type: 'tool_call'; runId?: string; callId: string; toolName: string; input: unknown; raw?: unknown; ts: number }
    | { type: 'tool_result'; runId?: string; callId: string; toolName: string; output: unknown; raw?: unknown; ts: number }
    | { type: 'tool_error'; runId?: string; callId: string; toolName: string; error: RuntimeError; raw?: unknown; ts: number }
  )

export type WorkflowEvent = V &
  (
    | { type: 'step_started'; runId?: string; stepId: string; label: string; kind?: StepKind; raw?: unknown; ts: number }
    | { type: 'step_completed'; runId?: string; stepId: string; output?: unknown; raw?: unknown; ts: number }
    | { type: 'edge_taken'; runId?: string; from: string; to: string; condition?: string; raw?: unknown; ts: number }
    | { type: 'child_run_started'; parentRunId: string; childRunId: string; label?: string; ts: number; raw?: unknown }
    | { type: 'child_run_completed'; parentRunId: string; childRunId: string; output?: unknown; ts: number; raw?: unknown }
  )

export type ExtensionEvent = V &
  (
    | { type: 'extension_activated'; extensionId: string; ts: number; raw?: unknown }
    | { type: 'extension_deactivated'; extensionId: string; ts: number; raw?: unknown }
  )

export type HumanInteractionEvent = V &
  (
    | { type: 'permission_requested'; runId: string; permission: PermissionRequest; ts: number; raw?: unknown }
    | { type: 'permission_resolved'; runId: string; permission: PermissionRequest; granted: boolean; ts: number; raw?: unknown }
  )

export type RuntimeLogEvent = V & {
  type: 'runtime_log'
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  runId?: string
  requestId?: string
  ts: number
  raw?: unknown
}

export type RuntimeEvent =
  | RunLifecycleEvent
  | ModelEvent
  | ToolEvent
  | WorkflowEvent
  | ExtensionEvent
  | HumanInteractionEvent
  | RuntimeLogEvent

export type RuntimeEventType = RuntimeEvent['type']

/** Preferred public name for the cross-pagelet agent protocol event. */
export type AgentEvent = RuntimeEvent

export type AgentEventType = RuntimeEventType

export type AgentEventSchemaFields = RuntimeEventSchemaFields
