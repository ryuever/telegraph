/**
 * Pi-Embedded Runtime (Phase 2)
 * 
 * Framework for executing agent runs with embedded tool loop:
 * - In-process execution (no spawn overhead)
 * - Tool call detection and execution
 * - Multi-turn conversation support
 * 
 * NOTE: This is a Phase 2 scaffold. Full implementation includes tool call detection
 * from LLM output, parallel tool execution, and session management via SessionStore.
 * For now, this delegates execution to the shared pi-ai stream adapter while
 * preserving the scaffold session and registry surfaces.
 */

import type { TSchema } from '@mariozechner/pi-ai'
import type { RuntimeEvent } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { BaseAgentRuntime, type RuntimeExecutableTool, type RuntimeInput } from './AgentRuntime'
import {
  streamPiAiRuntimeEvents,
  type PiAiToolExecutionContext,
} from './streamPiAiRuntime'
import { SessionStore } from './sessionManagement/SessionStore'
import { ToolRegistry } from './toolExecution/ToolRegistry'
import type { AgentRuntimeSettings } from '@/packages/agent/types'
import { runtimeMessagesForCurrentTurn } from './runtimeMessages'

export const TELEGRAPH_PI_EMBEDDED_PRODUCER_VERSION = '0.1.0'

/**
 * Pi-Embedded Runtime Executor
 * 
 * Phase 2 Scope:
 * - [x] Session management (multi-turn context)
 * - [x] Tool registry & executor infrastructure
 * - [ ] Tool call detection from LLM response
 * - [ ] Embedded tool loop (LLM → tool call → tool execution → next LLM)
 * - [ ] Extension loading & tool registration
 * 
 * Phase 2 Exit Criteria:
 * - Tool call/result events emitted and tested
 * - Multi-turn conversation maintains state across runs
 * - Session store manages in-memory sessions with cleanup
 * - Tool registry can register and resolve tools
 */
export class PiEmbeddedRuntime extends BaseAgentRuntime {
  readonly id = 'pi-embedded'
  readonly label = 'Pi Embedded (In-Process + Tools)'

  private sessionStore: SessionStore
  private toolRegistry: ToolRegistry
  private maxToolIterations: number = 10

  constructor() {
    super()
    this.sessionStore = new SessionStore({
      maxSessions: 1000,
      sessionTimeoutMs: 24 * 60 * 60 * 1000, // 24 hours
    })
    this.toolRegistry = new ToolRegistry()
  }

  /**
   * Main run method with embedded tool loop.
   * 
   * Implementation:
   * 1. Get or create session (multi-turn context)
   * 2. Emit run_started
   * 3. Delegate model/tool streaming to the shared pi-ai adapter
   * 4. Emit run_completed or run_failed
   * 5. Update session with completion status
   */
  async *run(input: RuntimeInput): AsyncIterable<RuntimeEvent> {
    const { runId, sessionId, message, settings, signal } = input

    // Get or create session for multi-turn context
    const session = this.sessionStore.getOrCreate(sessionId ?? runId)
    session.createRun(runId)

    // Mirror the normalized harness transcript into the scaffold session so
    // debugging helpers see the same context the model receives.
    const runtimeMessages = runtimeMessagesForCurrentTurn({ runId, message, messages: input.messages })
    for (const runtimeMessage of runtimeMessages ?? [{ id: `${runId}:user`, role: 'user' as const, content: message }]) {
      session.addMessage(sessionRoleForRuntime(runtimeMessage.role), runtimeMessage.content)
    }

    // Record start event in session
    const runStartEvent = {
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      producerVersion: TELEGRAPH_PI_EMBEDDED_PRODUCER_VERSION,
      type: 'run_started',
      runId,
      ts: this.now(),
      origin: {
        framework: 'pi',
        runtimeId: 'pi-embedded',
      },
    } satisfies RuntimeEvent
    session.recordEvent(runStartEvent)
    yield runStartEvent

    try {
      for await (const event of streamPiAiRuntimeEvents({
        runId,
        settings: settings as AgentRuntimeSettings,
        message,
        messages: runtimeMessages,
        signal,
        tools: input.tools?.map(toPiAiExecutableTool),
        maxToolIterations: this.maxToolIterations,
      })) {
        session.recordEvent(event)
        yield event
        if (event.type === 'run_completed' || event.type === 'run_failed' || event.type === 'run_cancelled') break
      }

      session.completeRun()
    } catch (error) {
      const failureEvent = {
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        producerVersion: TELEGRAPH_PI_EMBEDDED_PRODUCER_VERSION,
        type: 'run_failed',
        runId,
        error: {
          code: 'pi_embedded_error',
          message: error instanceof Error ? error.message : String(error),
        },
        ts: this.now(),
      } satisfies RuntimeEvent

      session.recordEvent(failureEvent)
      yield failureEvent
      session.completeRun()
    }
  }

  /**
   * Get tool registry for external registration.
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry
  }

  /**
   * Get session store for management.
   */
  getSessionStore(): SessionStore {
    return this.sessionStore
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    this.sessionStore.destroy()
  }
}

function toPiAiExecutableTool(tool: RuntimeExecutableTool) {
  return {
    name: tool.definition.name,
    description: tool.definition.description,
    parameters: tool.definition.inputSchema as TSchema,
    execute: (toolInput: Record<string, unknown>, context: PiAiToolExecutionContext) =>
      tool.execute(toolInput, context),
  }
}

function sessionRoleForRuntime(role: 'user' | 'assistant' | 'system' | 'tool'): 'user' | 'assistant' | 'tool' {
  if (role === 'assistant' || role === 'tool') return role
  return 'user'
}
