import type { AgentEvent, RuntimeEvent } from './events.js'
import type { RuntimeMessage } from './messages.js'

/**
 * Settings snapshot for a run — mirrors `AgentRuntimeSettings` from `@/packages/agent`
 * without taking a runtime dependency on pi-ai.
 */
export interface RuntimeSettings {
  provider?: string
  modelId?: string
  apiKey?: string
  baseUrl?: string
  backend?: string
  orchestration?: string
  orchestrationPattern?: string | null
  worktreeIsolation?: boolean
  extensionBlocklist?: string[]
  taskCapabilityProfile?: RuntimeTaskCapabilityProfile
}

export type RuntimeTaskCapabilityProfile =
  | { kind: 'default' }
  | { kind: 'readonly-workspace'; scopes: string[] }
  | { kind: 'computer-observe'; scopes?: string[] }
  | { kind: 'computer-act'; scopes?: string[]; actions?: string[] }
  | { kind: 'shell-automation'; commands?: string[]; cwdPolicy: 'workspace' | 'restricted' }
  | { kind: 'coding-edit'; scopes: string[]; patchPolicy: 'preview' | 'apply-after-confirm' }
  | { kind: 'design-build'; scopes: string[]; artifactPolicy: 'preview' | 'apply-after-confirm' }

export interface RunInput {
  runId: string
  sessionId: string
  messages: RuntimeMessage[]
  settings: RuntimeSettings
  enabledExtensions?: string[]
  metadata?: Record<string, unknown>
  signal?: AbortSignal
}

/**
 * Serializable run request that can cross RPC/pagelet boundaries.
 *
 * Execution-only capabilities such as AbortSignal, runtime instances, and
 * executable tools are intentionally kept in the harness layer.
 */
export interface AgentRunRequest {
  runId: string
  sessionId: string
  messages: RuntimeMessage[]
  settings: RuntimeSettings
  enabledExtensions?: string[]
  metadata?: Record<string, unknown>
}

export interface AgentRunEventEnvelope {
  type: 'agent_event'
  runId: string
  sessionId?: string
  event: AgentEvent
}

export interface AgentRuntime {
  readonly id: string
  readonly label?: string
  run(input: RunInput): AsyncIterable<RuntimeEvent>
}
