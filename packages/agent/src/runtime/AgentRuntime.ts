import type { RuntimeEvent, RuntimeSettings } from '@telegraph/runtime-contracts'

/**
 * Runtime input for executing an agent run.
 * This is the unified interface that all runtime adapters implement.
 */
export interface RuntimeInput {
  runId: string
  sessionId?: string
  message: string
  settings: RuntimeSettings
  signal?: AbortSignal
}

/**
 * Runtime executor interface - implements a specific backend for executing agent runs.
 * All execution backends (pi-ai, pi-cli, future frameworks) implement this.
 * 
 * NOTE: This is the IMPLEMENTATION interface for runtime executors.
 * The CONTRACT interface is RuntimeExecutor in @telegraph/runtime-contracts.
 * 
 * Implementations should:
 * - Emit RuntimeEvent stream via AsyncIterable
 * - Start with 'run_started' and end with terminal event ('run_completed'/'run_failed'/'run_cancelled')
 * - Respect AbortSignal for cancellation
 * - Never throw after yielding 'run_started' (emit 'run_failed' instead)
 */
export interface RuntimeExecutor {
  readonly id: string
  readonly label: string
  run(input: RuntimeInput): AsyncIterable<RuntimeEvent>
}

/**
 * Base class for runtime implementations.
 * Provides common utilities for event generation and error handling.
 */
export abstract class BaseAgentRuntime implements RuntimeExecutor {
  abstract readonly id: string
  abstract readonly label: string

  protected now(): number {
    return Date.now()
  }

  protected generateRequestId(runId: string): string {
    return `req-${runId.slice(0, 12)}`
  }

  abstract run(input: RuntimeInput): AsyncIterable<RuntimeEvent>
}
