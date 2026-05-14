/**
 * Session represents a multi-turn conversation context.
 * Manages message history, run records, and execution state.
 */

import type { RuntimeEvent } from '@/packages/runtime-contracts'

export interface Message {
  role: 'user' | 'assistant' | 'tool'
  content: string
  ts: number
  metadata?: Record<string, unknown>
}

export interface RunRecord {
  runId: string
  startTs: number
  endTs?: number
  events: RuntimeEvent[]
  toolResults?: Record<string, unknown> // tool_call_id -> result
}

export interface ExecutionContext {
  sessionId: string
  runId: string
  messages: Message[]
  availableTools: string[] // tool IDs
  systemPrompt?: string
  metadata?: Record<string, unknown>
}

/**
 * Session lifecycle:
 * - Created when user starts conversation
 * - Accumulates messages across multiple runs
 * - Closed when conversation ends or timed out
 */
export class Session {
  private sessionId: string
  private messages: Message[] = []
  private runs: RunRecord[] = []
  private isTerminal = false
  private createdTs: number
  private lastActivityTs: number
  private maxMessages = 100 // Prevent unbounded growth

  constructor(sessionId: string) {
    this.sessionId = sessionId
    this.createdTs = Date.now()
    this.lastActivityTs = Date.now()
  }

  /**
   * Add a user or assistant message to the session.
   */
  addMessage(role: 'user' | 'assistant' | 'tool', content: string, metadata?: Record<string, unknown>): void {
    if (this.isTerminal) {
      throw new Error(`[Session] Cannot add message to terminal session '${this.sessionId}'`)
    }

    this.messages.push({
      role,
      content,
      ts: Date.now(),
      metadata,
    })

    this.lastActivityTs = Date.now()

    // Prevent unbounded growth
    if (this.messages.length > this.maxMessages) {
      console.warn(
        `[Session] Message count (${this.messages.length}) exceeded limit (${this.maxMessages}), consider pruning`
      )
    }
  }

  /**
   * Create a new run record for this session.
   */
  createRun(runId: string): void {
    if (this.isTerminal) {
      throw new Error(`[Session] Cannot create run in terminal session '${this.sessionId}'`)
    }

    this.runs.push({
      runId,
      startTs: Date.now(),
      events: [],
      toolResults: {},
    })

    this.lastActivityTs = Date.now()
  }

  /**
   * Add a runtime event to the current run.
   */
  recordEvent(event: RuntimeEvent): void {
    const currentRun = this.getCurrentRun()
    if (!currentRun) {
      throw new Error('[Session] No active run to record event')
    }

    currentRun.events.push(event)
    this.lastActivityTs = Date.now()
  }

  /**
   * Record tool execution result in current run.
   */
  recordToolResult(toolCallId: string, result: unknown): void {
    const currentRun = this.getCurrentRun()
    if (!currentRun) {
      throw new Error('[Session] No active run to record tool result')
    }

    if (!currentRun.toolResults) {
      currentRun.toolResults = {}
    }
    currentRun.toolResults[toolCallId] = result
  }

  /**
   * Mark current run as complete.
   */
  completeRun(): void {
    const currentRun = this.getCurrentRun()
    if (!currentRun) {
      throw new Error('[Session] No active run to complete')
    }

    currentRun.endTs = Date.now()
    this.lastActivityTs = Date.now()
  }

  /**
   * Get context for LLM execution.
   */
  getExecutionContext(runId: string, availableTools: string[], systemPrompt?: string): ExecutionContext {
    return {
      sessionId: this.sessionId,
      runId,
      messages: [...this.messages], // Copy to prevent external mutation
      availableTools,
      systemPrompt,
      metadata: {
        messageCount: this.messages.length,
        runCount: this.runs.length,
      },
    }
  }

  /**
   * Mark session as terminal (no more runs).
   */
  terminate(): void {
    this.isTerminal = true
    this.lastActivityTs = Date.now()
  }

  /**
   * Getters
   */
  getSessionId(): string {
    return this.sessionId
  }

  getMessages(): Message[] {
    return [...this.messages]
  }

  getRuns(): RunRecord[] {
    return [...this.runs]
  }

  getCurrentRun(): RunRecord | undefined {
    return this.runs[this.runs.length - 1]
  }

  getIsTerminal(): boolean {
    return this.isTerminal
  }

  getLastActivityTs(): number {
    return this.lastActivityTs
  }

  /**
   * Session statistics
   */
  getStats() {
    return {
      sessionId: this.sessionId,
      createdTs: this.createdTs,
      lastActivityTs: this.lastActivityTs,
      messageCount: this.messages.length,
      runCount: this.runs.length,
      isTerminal: this.isTerminal,
      durationMs: this.lastActivityTs - this.createdTs,
    }
  }
}
