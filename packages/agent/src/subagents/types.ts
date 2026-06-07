/**
 * Native Subagent Harness — runtime-side types.
 *
 * Subagent = a child Run (independent `runId`) executed in-process within
 * the host pagelet utility process. See D-016 §6.
 *
 * The protocol-facing declaration (what an extension *contributes*) lives in
 * `@/packages/agent-protocol/subagents.ts`. This file holds the runtime
 * counterparts (invocation + record) that never need to cross IPC.
 */

import type { SubagentProfile } from '@/packages/agent-protocol'

export type { SubagentProfile }

/**
 * Invocation parameters for spawning a single subagent.
 *
 * `parentRunId` is required so the Harness can emit `child_run_started` /
 * `child_run_completed` carrying the parent linkage.
 */
export interface SubagentInvocation {
  /** Name of a previously-registered SubagentProfile. */
  profileName: string
  /** Initial user-style prompt fed to the child Run. */
  prompt: string
  /** Parent Run's runId — used for child_run_* event correlation. */
  parentRunId: string
  /** Optional parent sessionId (carries through to child input metadata). */
  parentSessionId?: string
  /**
   * 'sync' = caller awaits final output (default).
   * 'detach' = fire-and-forget; spawn returns immediately, child runs in background.
   */
  joinMode?: 'sync' | 'detach'
  /** Free-form metadata propagated to child Run metadata. */
  metadata?: Record<string, unknown>
  /** Optional abort signal — when triggered, child Run is cancelled. */
  signal?: AbortSignal
}

export type SubagentStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

/**
 * Snapshot of a subagent's lifecycle. Returned by spawn() and reflected by
 * spawnAndWait()'s resolved value.
 *
 * No persistent session handle is exposed — a subagent is fire-and-forget.
 * If steer/resume becomes necessary in the future it warrants a separate
 * design (see D-016 §6.4 table).
 */
export interface SubagentRecord {
  /** Harness-internal id (distinct from runId — useful for queue dedup / logs). */
  invocationId: string
  /** The independent child Run's runId. */
  childRunId: string
  /** Profile this invocation resolved against (snapshot, not a live ref). */
  profile: SubagentProfile
  status: SubagentStatus
  /** ms epoch when the invocation entered the queue. */
  queuedAt: number
  /** ms epoch when the child Run actually started (post-dequeue). */
  startedAt?: number
  /** ms epoch when terminal event was observed. */
  finishedAt?: number
  /** Terminal output, set on 'completed'. */
  output?: unknown
  /** Terminal error, set on 'failed'. */
  error?: { code?: string; message: string }
  /**
   * Cancellation reason, set on 'cancelled'. Distinguishes external abort
   * ('caller-abort') from Harness-enforced budget exhaustion ('budget-exceeded').
   */
  cancelReason?: 'caller-abort' | 'budget-exceeded' | 'parent-abort' | string
  /** Aggregate model usage if observable from emitted events. */
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
}

/** Configuration knob for the Harness instance. */
export interface SubagentHarnessOptions {
  /** Max concurrent running subagents (default 4). */
  maxConcurrency?: number
  /** Default turnBudget when a profile omits it (default unbounded). */
  defaultTurnBudget?: number
  /** Default graceTurns when a profile omits it (default 2). */
  defaultGraceTurns?: number
}
