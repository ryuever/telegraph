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
 * For now, this extends the Phase 1 pi-ai streaming without tool execution.
 */

import type { RuntimeEvent } from '@/packages/runtime-contracts'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/runtime-contracts'
import { BaseAgentRuntime, type RuntimeInput } from './AgentRuntime'
import { streamPiAiRuntimeEvents, TELEGRAPH_PI_AI_PRODUCER_VERSION } from './streamPiAiRuntime'
import type { Session } from './sessionManagement/Session'
import { SessionStore } from './sessionManagement/SessionStore'
import { ToolRegistry } from './toolExecution/ToolRegistry'
import { ToolExecutor, type ToolCallInput } from './toolExecution/ToolExecutor'
import { ToolCallParser, type ParsedToolCall } from './toolExecution/ToolCallParser'

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
  private toolExecutor: ToolExecutor
  private maxToolIterations: number = 10

  constructor() {
    super()
    this.sessionStore = new SessionStore({
      maxSessions: 1000,
      sessionTimeoutMs: 24 * 60 * 60 * 1000, // 24 hours
    })
    this.toolRegistry = new ToolRegistry()
    this.toolExecutor = new ToolExecutor(this.toolRegistry)
  }

  /**
   * Main run method with embedded tool loop.
   * 
   * Implementation:
   * 1. Get or create session (multi-turn context)
   * 2. Emit run_started
   * 3. Tool loop:
   *    a. Stream pi-ai response
   *    b. Detect tool calls in response
   *    c. Execute tools if detected
   *    d. Emit tool_result events
   *    e. Loop if tools were executed, else terminate
   * 4. Emit run_completed or run_failed
   * 5. Update session with completion status
   */
  async *run(input: RuntimeInput): AsyncIterable<RuntimeEvent> {
    const { runId, sessionId, message, settings, signal } = input

    // Get or create session for multi-turn context
    const session = this.sessionStore.getOrCreate(sessionId ?? runId)
    session.createRun(runId)

    // Add user message to session
    session.addMessage('user', message)

    // Record start event in session
    const runStartEvent: any = {
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      producerVersion: TELEGRAPH_PI_EMBEDDED_PRODUCER_VERSION,
      type: 'run_started',
      runId,
      ts: this.now(),
      origin: {
        framework: 'pi',
        runtimeId: 'pi-embedded',
      },
    }
    session.recordEvent(runStartEvent)
    yield runStartEvent

    try {
      // Embedded tool loop
      let loopIteration = 0
      let shouldContinue = true
      let lastAssistantText = ''

      while (shouldContinue && loopIteration < this.maxToolIterations) {
        loopIteration++

        // Check for cancellation
        if (signal?.aborted) {
          const cancelEvent: any = {
            schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
            producerVersion: TELEGRAPH_PI_EMBEDDED_PRODUCER_VERSION,
            type: 'run_cancelled',
            runId,
            ts: this.now(),
          }
          session.recordEvent(cancelEvent)
          yield cancelEvent
          break
        }

        // Stream pi-ai response and collect events + text
        let assistantText = ''
        const toolCalls: ParsedToolCall[] = []

        for await (const event of streamPiAiRuntimeEvents({
          runId,
          settings: settings as any,
          message: this.buildMessagesForPiAi(session),
          signal,
        })) {
          // Record event in session
          session.recordEvent(event as any)

          // Accumulate assistant text for tool call detection
          if ((event as any).type === 'model_event' && (event as any).data?.content) {
            assistantText += (event as any).data.content
          }

          // Yield event to consumer
          yield event

          // Stop if we got a terminal event from pi-ai
          if ((event as any).type === 'run_completed' || (event as any).type === 'run_failed') {
            shouldContinue = false
            break
          }
        }

        // Store last assistant text for completion event
        lastAssistantText = assistantText

        // Add assistant message to session
        if (assistantText) {
          session.addMessage('assistant', assistantText)

          // Detect tool calls in the response
          toolCalls.push(...ToolCallParser.parseToolCalls(assistantText))
        }

        // Execute tool calls if any were detected
        if (toolCalls.length > 0) {
          const toolResults = await this.executeToolCalls(runId, toolCalls, session)

          // Emit tool_result events and add to session
          for (const result of toolResults) {
            const toolResultEvent: any = {
              schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
              producerVersion: TELEGRAPH_PI_EMBEDDED_PRODUCER_VERSION,
              ...result,
              ts: this.now(),
            }
            session.recordEvent(toolResultEvent)
            yield toolResultEvent
          }

          // Add tool results as tool message to session for next iteration
          const toolResultsText = toolResults
            .map(r => this.formatToolResult(r))
            .join('\n')
          session.addMessage('tool', toolResultsText)

          // Continue loop for next LLM turn
        } else {
          // No tool calls detected, conversation complete
          shouldContinue = false
        }
      }

      // Check if we hit max iterations
      if (loopIteration >= this.maxToolIterations && shouldContinue) {
        const failureEvent: any = {
          schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
          producerVersion: TELEGRAPH_PI_EMBEDDED_PRODUCER_VERSION,
          type: 'run_failed',
          runId,
          error: {
            code: 'max_tool_iterations_exceeded',
            message: `Exceeded maximum tool iterations (${this.maxToolIterations})`,
          },
          ts: this.now(),
        }
        session.recordEvent(failureEvent)
        yield failureEvent
      } else if (shouldContinue === false) {
        // Normal completion
        const completionEvent: any = {
          schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
          producerVersion: TELEGRAPH_PI_EMBEDDED_PRODUCER_VERSION,
          type: 'run_completed',
          runId,
          output: lastAssistantText,
          ts: this.now(),
        }
        session.recordEvent(completionEvent)
        yield completionEvent
      }

      session.completeRun()
    } catch (error) {
      const failureEvent: any = {
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        producerVersion: TELEGRAPH_PI_EMBEDDED_PRODUCER_VERSION,
        type: 'run_failed',
        runId,
        error: {
          code: 'pi_embedded_error',
          message: error instanceof Error ? error.message : String(error),
        },
        ts: this.now(),
      }

      session.recordEvent(failureEvent)
      yield failureEvent
      session.completeRun()
    }
  }

  /**
   * Execute detected tool calls.
   * Returns tool result events.
   */
  private async executeToolCalls(
    runId: string,
    parsedCalls: ParsedToolCall[],
    session: Session
  ): Promise<any[]> {
    const toolCalls: ToolCallInput[] = parsedCalls.map(call => ({
      toolId: call.toolName,
      name: call.toolName,
      args: call.input,
      callId: call.callId,
    }))

    // Execute all tool calls in parallel
    const toolResults = await this.toolExecutor.executeTools(toolCalls)

    // Convert ToolResultEvent to RuntimeEvent format
    return toolResults.map(result => ({
      type: result.error ? 'tool_error' : 'tool_result',
      runId,
      callId: result.callId,
      toolName: result.name,
      output: result.result,
      error: result.error,
    }))
  }

  /**
   * Format tool result for inclusion in session messages.
   */
  private formatToolResult(result: any): string {
    if (result.error) {
      return `Tool "${result.toolName}" error: ${result.error.message}`
    }
    return `Tool "${result.toolName}" result: ${JSON.stringify(result.output)}`
  }

  /**
   * Build message array for pi-ai from session history.
   * Converts internal Message format to pi-ai expected format.
   */
  private buildMessagesForPiAi(session: Session): string {
    // Phase 2: Convert session.messages to pi-ai format
    // For now, return the latest message (single-turn compatibility)
    const messages = session.getMessages()
    if (messages.length === 0) {
      return ''
    }

    // Return the last user message as the input
    const userMessages = messages.filter(m => m.role === 'user')
    if (userMessages.length === 0) {
      return ''
    }

    return userMessages[userMessages.length - 1].content
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
