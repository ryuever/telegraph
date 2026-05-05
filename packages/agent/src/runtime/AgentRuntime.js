/**
 * Base class for runtime implementations.
 * Provides common utilities for event generation and error handling.
 */
export class BaseAgentRuntime {
    now() {
        return Date.now();
    }
    generateRequestId(runId) {
        return `req-${runId.slice(0, 12)}`;
    }
}
