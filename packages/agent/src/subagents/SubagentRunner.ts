/**
 * SubagentRunner — executes a single subagent invocation as a child Run.
 *
 * Responsibilities:
 *   1. Build child RuntimeInput from invocation + profile (system prompt
 *      override, allowed-tools gating, settings inheritance).
 *   2. Drive the child runtime's AsyncIterable<RuntimeEvent>.
 *   3. Rewrap child events so the parent stream sees:
 *        - `child_run_started { parentRunId, childRunId }` (emitted by Runner)
 *        - all child events (forwarded as-is, NOT mutating ts — see D-016 §8.3.2)
 *        - `child_run_completed { parentRunId, childRunId, output }` (emitted by Runner)
 *   4. Enforce turnBudget / graceTurns by injecting a wrap-up message on soft
 *      limit and firing the AbortSignal on hard limit (D-016 §6.3 step 5-6).
 *
 * Out of scope here (handled by SubagentHarness): concurrency queue,
 * detach/sync joinMode, lifecycle bookkeeping (SubagentRecord status).
 */

import type {
  RuntimeEvent,
  RuntimeSettings,
  SubagentProfile,
} from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import type { RuntimeExecutableTool, RuntimeExecutor, RuntimeInput } from '@/packages/agent/runtime/AgentRuntime'
import type { SubagentInvocation } from './types'

export type ChildRuntimeFactory = (req: ChildRuntimeRequest) => RuntimeExecutor

export interface ChildRuntimeRequest {
  runId: string
  sessionId?: string
  settings: RuntimeSettings
  profile: SubagentProfile
  parentRunId: string
  metadata?: Record<string, unknown>
}

export interface ChildToolProvider {
  /**
   * Resolve the tool descriptors visible to a subagent given the profile's
   * allow-list. Implementation lives outside the Runner (typically a thin
   * shim over the host's ToolRegistry).
   */
  resolve(profile: SubagentProfile, parentSettings: RuntimeSettings): RuntimeExecutableTool[]
}

export interface RunnerExecution {
  childRunId: string
  /** Async iterable of events scoped to this child Run, with the synthetic child_run_* envelope. */
  stream: AsyncIterable<RuntimeEvent>
  /** Aborts the child Run (forwards into the runtime AbortSignal). */
  abort(reason?: string): void
}

export interface SubagentRunnerOptions {
  parentSettings: RuntimeSettings
  childRuntimeFactory: ChildRuntimeFactory
  toolProvider?: ChildToolProvider
  /** ID generator for child runs. Default: `${parentRunId}.sub-${crypto.randomUUID()}`. */
  generateChildRunId?: (parentRunId: string) => string
  /** Default turn budget when profile omits it. */
  defaultTurnBudget?: number
  /** Default grace turns when profile omits it (after soft budget). */
  defaultGraceTurns?: number
  /** Clock — injectable for tests. */
  now?: () => number
}

const DEFAULT_GRACE_TURNS = 2

export class SubagentRunner {
  constructor(private readonly options: SubagentRunnerOptions) {}

  /**
   * Execute one invocation. The returned `stream` MUST be consumed by the
   * caller; events flow only as the iterator is pulled.
   */
  execute(invocation: SubagentInvocation, profile: SubagentProfile): RunnerExecution {
    const childRunId = (this.options.generateChildRunId ?? defaultGenerateChildRunId)(
      invocation.parentRunId,
    )
    const internalController = new AbortController()
    // Chain external invocation.signal -> internal controller
    if (invocation.signal) {
      if (invocation.signal.aborted) internalController.abort(invocation.signal.reason)
      else invocation.signal.addEventListener('abort', () => internalController.abort(invocation.signal!.reason), { once: true })
    }

    const stream = this.streamEvents(invocation, profile, childRunId, internalController)
    return {
      childRunId,
      stream,
      abort: (reason) => internalController.abort(reason),
    }
  }

  private async *streamEvents(
    invocation: SubagentInvocation,
    profile: SubagentProfile,
    childRunId: string,
    controller: AbortController,
  ): AsyncIterable<RuntimeEvent> {
    const now = this.options.now ?? Date.now
    const parentRunId = invocation.parentRunId

    // 1. Open envelope.
    yield {
      type: 'child_run_started',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      parentRunId,
      childRunId,
      label: profile.name,
      ts: now(),
    }

    const childSettings: RuntimeSettings = {
      ...this.options.parentSettings,
      ...(profile.model
        ? { provider: profile.model.provider, modelId: profile.model.name }
        : {}),
    }

    const childRuntime = this.options.childRuntimeFactory({
      runId: childRunId,
      sessionId: invocation.parentSessionId,
      settings: childSettings,
      profile,
      parentRunId,
      metadata: invocation.metadata,
    })

    const tools = this.options.toolProvider?.resolve(profile, this.options.parentSettings)

    const childInput: RuntimeInput = {
      runId: childRunId,
      sessionId: invocation.parentSessionId,
      message: invocation.prompt,
      settings: childSettings,
      metadata: {
        ...(invocation.metadata ?? {}),
        subagent: { name: profile.name, parentRunId },
      },
      tools,
      signal: controller.signal,
    }

    const turnBudget = profile.turnBudget ?? this.options.defaultTurnBudget
    const graceTurns = profile.graceTurns ?? this.options.defaultGraceTurns ?? DEFAULT_GRACE_TURNS

    let turnsObserved = 0
    let softBudgetHitAt: number | null = null
    let terminalOutput: unknown
    let terminalKind: 'completed' | 'failed' | 'cancelled' = 'completed'

    try {
      for await (const event of childRuntime.run(childInput)) {
        // Forward child event unchanged (ts preserved per D-016 §8.3.2).
        yield event

        // Count assistant_message as one turn boundary (model-side response).
        if (event.type === 'assistant_message') {
          turnsObserved += 1
          if (turnBudget !== undefined) {
            if (turnsObserved >= turnBudget && softBudgetHitAt === null) {
              softBudgetHitAt = turnsObserved
              // NOTE: wrap-up injection is intentionally not implemented here
              // in P2 — telegraph RuntimeExecutor.run() is fire-and-forget
              // AsyncIterable with no in-stream steer primitive. Subagents
              // hitting soft budget rely on the hard-abort path below; a
              // dedicated wrap-up channel is a follow-up (D-016 §9 follow-up).
            }
            if (softBudgetHitAt !== null && turnsObserved >= softBudgetHitAt + graceTurns) {
              controller.abort('budget-exceeded')
            }
          }
        }

        if (event.type === 'run_completed') {
          terminalOutput = event.output
          terminalKind = 'completed'
        } else if (event.type === 'run_failed') {
          terminalKind = 'failed'
        } else if (event.type === 'run_cancelled') {
          terminalKind = 'cancelled'
        }
      }
    } catch (err) {
      terminalKind = controller.signal.aborted ? 'cancelled' : 'failed'
      // Surface a synthetic failure event so the parent stream is well-formed
      // even if the child runtime threw mid-stream.
      yield {
        type: 'run_failed',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: childRunId,
        error: {
          code: 'subagent_runtime_error',
          message: err instanceof Error ? err.message : String(err),
        },
        ts: now(),
      }
    }

    // 2. Close envelope. `output` is `undefined` for failed/cancelled — parent
    // can inspect prior events for details.
    yield {
      type: 'child_run_completed',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      parentRunId,
      childRunId,
      output:
        terminalKind === 'completed'
          ? terminalOutput
          : { aborted: terminalKind === 'cancelled', kind: terminalKind },
      ts: now(),
    }
  }
}

function defaultGenerateChildRunId(parentRunId: string): string {
  const suffix =
    typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${parentRunId}.sub-${suffix}`
}
