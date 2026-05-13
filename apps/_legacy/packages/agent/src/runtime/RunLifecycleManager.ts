/**
 * Unified run lifecycle management.
 * 
 * Ensures:
 * - Terminal state is reached exactly once (idempotent)
 * - No duplicate events (run_completed or run_failed)
 * - Clear state transitions for tracing
 * - Fallback handling for edge cases (timeout, unexpected end)
 */
export class RunLifecycleManager {
  private state: 'initial' | 'running' | 'terminal' = 'initial'
  private terminalEvent: any | null = null

  constructor(private runId: string) {}

  /**
   * Transition from initial to running state.
   * Called once at the start of a run.
   */
  markRunning(): void {
    if (this.state !== 'initial') {
      throw new Error(
        `[RunLifecycleManager] Cannot mark running: already in state '${this.state}'`
      )
    }
    this.state = 'running'
  }

  /**
   * Process a runtime event, checking if it's a terminal event.
   * If terminal, transition to terminal state and return the event.
   * Otherwise return null to indicate non-terminal.
   * 
   * This ensures only one terminal event is emitted.
   */
  processRuntimeEvent(ev: any): any | null {
    if (!this.isTerminalEventType(ev.type)) {
      return ev // Non-terminal, pass through
    }

    // Terminal event
    if (this.state === 'terminal') {
      // Already reached terminal, ignore duplicate
      console.warn(
        `[RunLifecycleManager] Ignoring duplicate terminal event type='${ev.type}' for run '${this.runId}'`
      )
      return null
    }

    if (this.state !== 'running') {
      console.warn(
        `[RunLifecycleManager] Terminal event in unexpected state '${this.state}' for run '${this.runId}'`
      )
    }

    this.state = 'terminal'
    this.terminalEvent = ev
    return ev
  }

  /**
   * Ensure the run reaches terminal state.
   * If already terminal, returns the stored terminal event.
   * If still running, creates a synthetic terminal event for fallback scenarios.
   * 
   * Used when stream ends unexpectedly or timeout occurs.
   */
  ensureTerminal(fallbackError: {
    code: string
    message: string
  }): any {
    if (this.state === 'terminal') {
      return this.terminalEvent
    }

    if (this.state === 'running') {
      const fallbackEvent = {
        type: 'run_failed' as const,
        runId: this.runId,
        error: fallbackError,
        ts: Date.now(),
        synthetic: true, // Mark as system-generated, not from runtime
      }
      this.state = 'terminal'
      this.terminalEvent = fallbackEvent
      return fallbackEvent
    }

    throw new Error(
      `[RunLifecycleManager] Cannot ensure terminal: invalid state '${this.state}'`
    )
  }

  /**
   * Get current state.
   */
  getState(): 'initial' | 'running' | 'terminal' {
    return this.state
  }

  /**
   * Get the stored terminal event (if any).
   */
  getTerminalEvent(): any | null {
    return this.terminalEvent
  }

  /**
   * Check if this is a terminal event type.
   */
  private isTerminalEventType(type: string): boolean {
    return type === 'run_completed' || type === 'run_failed' || type === 'run_cancelled'
  }
}
