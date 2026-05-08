/**
 * SessionStore manages the lifecycle of Session objects.
 * Stores sessions in-memory (Phase 2); persistent storage deferred to Phase 3.
 */

import { Session } from './Session'

export interface SessionStoreConfig {
  maxSessions?: number
  sessionTimeoutMs?: number // Inactive session cleanup
}

/**
 * In-memory session store.
 * Future: Replace with persistent backend (SQLite, etc.)
 */
export class SessionStore {
  private sessions = new Map<string, Session>()
  private config: Required<SessionStoreConfig>

  constructor(config: SessionStoreConfig = {}) {
    this.config = {
      maxSessions: config.maxSessions ?? 1000,
      sessionTimeoutMs: config.sessionTimeoutMs ?? 24 * 60 * 60 * 1000, // 24 hours
    }

    // Periodic cleanup of timed-out sessions
    this.startCleanupInterval()
  }

  /**
   * Get or create a session by ID.
   */
  getOrCreate(sessionId: string): Session {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!
    }

    // Check capacity
    if (this.sessions.size >= this.config.maxSessions) {
      // Evict oldest idle session
      this.evictLeastRecentlyUsed()
    }

    const session = new Session(sessionId)
    this.sessions.set(sessionId, session)
    return session
  }

  /**
   * Get existing session (does not create).
   */
  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId)
  }

  /**
   * List all active sessions.
   */
  list(): Session[] {
    return Array.from(this.sessions.values())
  }

  /**
   * Close a session and remove it from store.
   */
  close(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.terminate()
      this.sessions.delete(sessionId)
    }
  }

  /**
   * Check if session exists.
   */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  /**
   * Get session count.
   */
  size(): number {
    return this.sessions.size
  }

  /**
   * Clear all sessions.
   */
  clear(): void {
    this.sessions.clear()
  }

  /**
   * Get store statistics.
   */
  getStats() {
    const sessions = Array.from(this.sessions.values())
    const now = Date.now()

    return {
      totalSessions: sessions.length,
      activeRuns: sessions.reduce((sum, s) => sum + (s.getCurrentRun() ? 1 : 0), 0),
      totalMessages: sessions.reduce((sum, s) => sum + s.getMessages().length, 0),
      totalEvents: sessions.reduce((sum, s) => sum + s.getRuns().reduce((rs, r) => rs + r.events.length, 0), 0),
      sessionStats: sessions.map(s => ({
        ...s.getStats(),
        ageSec: Math.floor((now - s.getStats().createdTs) / 1000),
      })),
    }
  }

  /**
   * Private: Periodic cleanup of timed-out sessions
   */
  private cleanupInterval?: ReturnType<typeof setInterval>

  private startCleanupInterval(): void {
    // Run cleanup every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, 60 * 60 * 1000)

    // Allow process to exit if this is the only active timer
    if (typeof this.cleanupInterval === 'object' && this.cleanupInterval && 'unref' in this.cleanupInterval) {
      (this.cleanupInterval as any).unref?.()
    }
  }

  private cleanup(): void {
    const now = Date.now()
    const toDelete: string[] = []

    for (const [sessionId, session] of this.sessions) {
      const lastActivityTs = session.getLastActivityTs()
      const inactiveMs = now - lastActivityTs

      if (inactiveMs > this.config.sessionTimeoutMs) {
        toDelete.push(sessionId)
      }
    }

    for (const sessionId of toDelete) {
      console.log(`[SessionStore] Cleaning up inactive session '${sessionId}'`)
      this.close(sessionId)
    }
  }

  /**
   * Private: Evict least recently used session
   */
  private evictLeastRecentlyUsed(): void {
    let lruSession: Session | null = null
    let lruTime = Infinity

    for (const session of this.sessions.values()) {
      const lastActivityTs = session.getLastActivityTs()
      if (lastActivityTs < lruTime) {
        lruTime = lastActivityTs
        lruSession = session
      }
    }

    if (lruSession) {
      const sessionId = lruSession.getSessionId()
      console.warn(`[SessionStore] Evicting LRU session '${sessionId}' due to capacity`)
      this.close(sessionId)
    }
  }

  /**
   * Cleanup: Stop the cleanup interval.
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
    this.sessions.clear()
  }
}
