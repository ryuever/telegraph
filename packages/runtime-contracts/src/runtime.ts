import type { RuntimeEvent } from './events.js'
import type { RuntimeMessage } from './messages.js'

/**
 * Settings snapshot for a run — mirrors `AgentRuntimeSettings` from `@telegraph/agent`
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
}

export interface RunInput {
  runId: string
  sessionId: string
  messages: RuntimeMessage[]
  settings: RuntimeSettings
  enabledExtensions?: string[]
  metadata?: Record<string, unknown>
  signal?: AbortSignal
}

export interface AgentRuntime {
  readonly id: string
  readonly label?: string
  run(input: RunInput): AsyncIterable<RuntimeEvent>
}
