/**
 * Error classes for the orchestration engine.
 */

/** Base error class for all orchestrator errors. */
export class OrchestratorError extends Error {
  constructor(message?: string) {
    super(message);
    this.name = "OrchestratorError";
  }
}

/** Thrown when a channel has no value to read. */
export class EmptyChannelError extends OrchestratorError {
  constructor(channelName?: string) {
    super(
      channelName
        ? `Channel "${channelName}" is empty (no value has been set).`
        : "Channel is empty."
    );
    this.name = "EmptyChannelError";
  }
}

/** Thrown when a channel receives an invalid update. */
export class InvalidUpdateError extends OrchestratorError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidUpdateError";
  }
}

/** Thrown when the graph definition is invalid. */
export class GraphValidationError extends OrchestratorError {
  constructor(message: string) {
    super(message);
    this.name = "GraphValidationError";
  }
}

/** Thrown when the graph exceeds recursion limits. */
export class GraphRecursionError extends OrchestratorError {
  constructor(message?: string) {
    super(message ?? "Recursion limit reached.");
    this.name = "GraphRecursionError";
  }
}

/** Thrown when state graph receives invalid input schema. */
export class StateGraphInputError extends OrchestratorError {
  constructor(message?: string) {
    super(
      message ??
        "Invalid StateGraph input. Must provide a state definition " +
          "(Annotation, object with reducers, or schema)."
    );
    this.name = "StateGraphInputError";
  }
}

// Re-export interrupt errors for convenience
export {
  GraphInterrupt,
  NodeInterrupt,
  isGraphInterrupt,
  type InterruptInfo,
} from "./interrupt.js";
