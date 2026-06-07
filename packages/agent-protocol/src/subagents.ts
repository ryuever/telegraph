import type { PermissionRequest } from './permissions.js'

/**
 * Declarative profile of a subagent that an extension contributes.
 * The subagent runtime model is **a child Run** (independent `runId`) executed
 * in-process within the host pagelet utility process — not a new framework
 * adapter. See D-016 §6 for the Native Subagent Harness design.
 *
 * Execution glue (`spawn`, `spawnAndWait`, queueing, abort) lives in the
 * Native Subagent Harness; this protocol type only describes what an extension
 * registers via `telegraph.registerSubagentProfile(profile)`.
 */
export interface SubagentProfile {
  /** Unique identifier within a Subagent Registry instance (per-pagelet). */
  name: string
  /** Short, LLM-friendly description used by routers / tool dispatch. */
  description: string
  /** System prompt injected into the child Run. */
  systemPrompt: string
  /**
   * Optional model override. When omitted the child Run inherits the parent
   * Run's model. Shape mirrors `RuntimeSettings.backend`-style hints; left
   * `unknown` here to avoid coupling protocol to a specific provider schema.
   */
  model?: {
    provider: string
    name: string
    [key: string]: unknown
  }
  /**
   * Tools the child Run is allowed to invoke. `undefined` means inherit the
   * parent's allow-list. Empty array means deny all.
   */
  allowedTools?: string[]
  /**
   * Soft cap on assistant turns inside the child Run. When hit the Harness
   * injects a wrap-up signal (see D-016 §6.3 step 5).
   */
  turnBudget?: number
  /**
   * Hard-abort grace window after `turnBudget`: the child gets this many more
   * turns to gracefully wrap up before `AbortSignal` is fired.
   */
  graceTurns?: number
  /** Optional permission floor the host enforces on this subagent. */
  permissions?: PermissionRequest[]
  /**
   * Name of a registered ContextProvider that injects parent-conversation
   * context into the child Run's input. Resolution lives in the Harness.
   */
  contextProvider?: string
  /**
   * Loose metadata bag for extension authors (source markdown path, version,
   * tags, …). The runtime treats this as opaque.
   */
  metadata?: Record<string, unknown>
}

/** Contribution wrapper consumed by the protocol-level extension manifest. */
export interface SubagentProfileContribution {
  id: string
  profile: SubagentProfile
}
