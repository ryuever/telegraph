export interface AgentRunControlStartInput {
  runId: string
  sessionId?: string
}

export interface AgentRunControlHandle {
  runId: string
  sessionId?: string
  signal: AbortSignal
}

export interface AgentRunControlSubscription {
  unsubscribe(): void
}

export class AgentRunControl<Event> {
  private readonly activeRuns = new Map<string, AbortController>()
  private readonly listeners = new Set<(event: Event) => void>()

  subscribe(callback: (event: Event) => void): AgentRunControlSubscription {
    this.listeners.add(callback)
    return {
      unsubscribe: () => {
        this.listeners.delete(callback)
      },
    }
  }

  startRun(input: AgentRunControlStartInput): AgentRunControlHandle {
    const previous = this.activeRuns.get(input.runId)
    previous?.abort()

    const abortController = new AbortController()
    this.activeRuns.set(input.runId, abortController)
    return {
      runId: input.runId,
      sessionId: input.sessionId,
      signal: abortController.signal,
    }
  }

  cancelRun(runId: string): boolean {
    const controller = this.activeRuns.get(runId)
    if (!controller) return false
    controller.abort()
    return true
  }

  finishRun(runId: string): void {
    this.activeRuns.delete(runId)
  }

  emit(event: Event): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        this.listeners.delete(listener)
      }
    }
  }

  isActive(runId: string): boolean {
    return this.activeRuns.has(runId)
  }
}
