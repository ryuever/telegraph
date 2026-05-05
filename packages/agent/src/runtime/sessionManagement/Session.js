/**
 * Session represents a multi-turn conversation context.
 * Manages message history, run records, and execution state.
 */
/**
 * Session lifecycle:
 * - Created when user starts conversation
 * - Accumulates messages across multiple runs
 * - Closed when conversation ends or timed out
 */
export class Session {
    sessionId;
    messages = [];
    runs = [];
    isTerminal = false;
    createdTs;
    lastActivityTs;
    maxMessages = 100; // Prevent unbounded growth
    constructor(sessionId) {
        this.sessionId = sessionId;
        this.createdTs = Date.now();
        this.lastActivityTs = Date.now();
    }
    /**
     * Add a user or assistant message to the session.
     */
    addMessage(role, content, metadata) {
        if (this.isTerminal) {
            throw new Error(`[Session] Cannot add message to terminal session '${this.sessionId}'`);
        }
        this.messages.push({
            role,
            content,
            ts: Date.now(),
            metadata,
        });
        this.lastActivityTs = Date.now();
        // Prevent unbounded growth
        if (this.messages.length > this.maxMessages) {
            console.warn(`[Session] Message count (${this.messages.length}) exceeded limit (${this.maxMessages}), consider pruning`);
        }
    }
    /**
     * Create a new run record for this session.
     */
    createRun(runId) {
        if (this.isTerminal) {
            throw new Error(`[Session] Cannot create run in terminal session '${this.sessionId}'`);
        }
        this.runs.push({
            runId,
            startTs: Date.now(),
            events: [],
            toolResults: {},
        });
        this.lastActivityTs = Date.now();
    }
    /**
     * Add a runtime event to the current run.
     */
    recordEvent(event) {
        const currentRun = this.getCurrentRun();
        if (!currentRun) {
            throw new Error('[Session] No active run to record event');
        }
        currentRun.events.push(event);
        this.lastActivityTs = Date.now();
    }
    /**
     * Record tool execution result in current run.
     */
    recordToolResult(toolCallId, result) {
        const currentRun = this.getCurrentRun();
        if (!currentRun) {
            throw new Error('[Session] No active run to record tool result');
        }
        if (!currentRun.toolResults) {
            currentRun.toolResults = {};
        }
        currentRun.toolResults[toolCallId] = result;
    }
    /**
     * Mark current run as complete.
     */
    completeRun() {
        const currentRun = this.getCurrentRun();
        if (!currentRun) {
            throw new Error('[Session] No active run to complete');
        }
        currentRun.endTs = Date.now();
        this.lastActivityTs = Date.now();
    }
    /**
     * Get context for LLM execution.
     */
    getExecutionContext(runId, availableTools, systemPrompt) {
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
        };
    }
    /**
     * Mark session as terminal (no more runs).
     */
    terminate() {
        this.isTerminal = true;
        this.lastActivityTs = Date.now();
    }
    /**
     * Getters
     */
    getSessionId() {
        return this.sessionId;
    }
    getMessages() {
        return [...this.messages];
    }
    getRuns() {
        return [...this.runs];
    }
    getCurrentRun() {
        return this.runs[this.runs.length - 1];
    }
    getIsTerminal() {
        return this.isTerminal;
    }
    getLastActivityTs() {
        return this.lastActivityTs;
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
        };
    }
}
