/**
 * SessionStore manages the lifecycle of Session objects.
 * Stores sessions in-memory (Phase 2); persistent storage deferred to Phase 3.
 */
import { Session } from './Session';
/**
 * In-memory session store.
 * Future: Replace with persistent backend (SQLite, etc.)
 */
export class SessionStore {
    sessions = new Map();
    config;
    constructor(config = {}) {
        this.config = {
            maxSessions: config.maxSessions ?? 1000,
            sessionTimeoutMs: config.sessionTimeoutMs ?? 24 * 60 * 60 * 1000, // 24 hours
        };
        // Periodic cleanup of timed-out sessions
        this.startCleanupInterval();
    }
    /**
     * Get or create a session by ID.
     */
    getOrCreate(sessionId) {
        if (this.sessions.has(sessionId)) {
            return this.sessions.get(sessionId);
        }
        // Check capacity
        if (this.sessions.size >= this.config.maxSessions) {
            // Evict oldest idle session
            this.evictLeastRecentlyUsed();
        }
        const session = new Session(sessionId);
        this.sessions.set(sessionId, session);
        return session;
    }
    /**
     * Get existing session (does not create).
     */
    get(sessionId) {
        return this.sessions.get(sessionId);
    }
    /**
     * List all active sessions.
     */
    list() {
        return Array.from(this.sessions.values());
    }
    /**
     * Close a session and remove it from store.
     */
    close(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.terminate();
            this.sessions.delete(sessionId);
        }
    }
    /**
     * Check if session exists.
     */
    has(sessionId) {
        return this.sessions.has(sessionId);
    }
    /**
     * Get session count.
     */
    size() {
        return this.sessions.size;
    }
    /**
     * Clear all sessions.
     */
    clear() {
        this.sessions.clear();
    }
    /**
     * Get store statistics.
     */
    getStats() {
        const sessions = Array.from(this.sessions.values());
        const now = Date.now();
        return {
            totalSessions: sessions.length,
            activeRuns: sessions.reduce((sum, s) => sum + (s.getCurrentRun() ? 1 : 0), 0),
            totalMessages: sessions.reduce((sum, s) => sum + s.getMessages().length, 0),
            totalEvents: sessions.reduce((sum, s) => sum + s.getRuns().reduce((rs, r) => rs + r.events.length, 0), 0),
            sessionStats: sessions.map(s => ({
                ...s.getStats(),
                ageSec: Math.floor((now - s.getStats().createdTs) / 1000),
            })),
        };
    }
    /**
     * Private: Periodic cleanup of timed-out sessions
     */
    cleanupInterval;
    startCleanupInterval() {
        // Run cleanup every hour
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 60 * 60 * 1000);
        // Allow process to exit if this is the only active timer
        if (typeof this.cleanupInterval === 'object' && this.cleanupInterval && 'unref' in this.cleanupInterval) {
            this.cleanupInterval.unref?.();
        }
    }
    cleanup() {
        const now = Date.now();
        const toDelete = [];
        for (const [sessionId, session] of this.sessions) {
            const lastActivityTs = session.getLastActivityTs();
            const inactiveMs = now - lastActivityTs;
            if (inactiveMs > this.config.sessionTimeoutMs) {
                toDelete.push(sessionId);
            }
        }
        for (const sessionId of toDelete) {
            console.log(`[SessionStore] Cleaning up inactive session '${sessionId}'`);
            this.close(sessionId);
        }
    }
    /**
     * Private: Evict least recently used session
     */
    evictLeastRecentlyUsed() {
        let lruSession = null;
        let lruTime = Infinity;
        for (const session of this.sessions.values()) {
            const lastActivityTs = session.getLastActivityTs();
            if (lastActivityTs < lruTime) {
                lruTime = lastActivityTs;
                lruSession = session;
            }
        }
        if (lruSession) {
            const sessionId = lruSession.getSessionId();
            console.warn(`[SessionStore] Evicting LRU session '${sessionId}' due to capacity`);
            this.close(sessionId);
        }
    }
    /**
     * Cleanup: Stop the cleanup interval.
     */
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.sessions.clear();
    }
}
