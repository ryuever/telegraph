/**
 * Interrupt primitives for the orchestration engine.
 *
 * Provides the `interrupt()` function that allows nodes to pause graph
 * execution and wait for external input (human-in-the-loop).
 *
 * ## Architecture
 *
 * The interrupt mechanism uses an exception-based control flow:
 *
 * 1. Node calls `interrupt(value)` with a payload describing what's needed
 * 2. If no resume value is available, throws `GraphInterrupt`
 * 3. Engine catches the interrupt, saves checkpoint with interrupt info
 * 4. External system (UI, API) receives the interrupt payload
 * 5. External system calls `invoke(Command({ resume: data }))`
 * 6. Engine restores from checkpoint, re-executes the interrupted node
 * 7. `interrupt()` finds the resume value and returns it instead of throwing
 *
 * ## Multi-interrupt support
 *
 * A single node can call `interrupt()` multiple times. Each call is tracked
 * by an `interruptCounter` so that resume values are matched to the correct
 * interrupt call by index.
 *
 * @example
 * ```ts
 * const graph = new StateGraph(MyState)
 *   .addNode("review", async (state) => {
 *     const response = interrupt({
 *       type: "approval",
 *       message: `Approve action: ${state.action}?`,
 *     });
 *     return { approved: response.type === "accept" };
 *   })
 *   .addEdge(START, "review")
 *   .addEdge("review", END)
 *   .compile({ checkpointer: new MemorySaver() });
 *
 * // First invocation — will throw GraphInterrupt
 * try {
 *   await graph.invoke(
 *     { action: "delete_file" },
 *     { configurable: { thread_id: "t1" } }
 *   );
 * } catch (e) {
 *   if (e instanceof GraphInterrupt) {
 *     console.log("Interrupt:", e.interrupts[0].value);
 *   }
 * }
 *
 * // Resume with approval
 * const result = await graph.invoke(
 *   new Command({ resume: { type: "accept" } }),
 *   { configurable: { thread_id: "t1" } }
 * );
 * ```
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { uuid6 } from "./checkpoint/id.js";

// ═══════════════════════════════════════════════════════════════
//  Interrupt errors
// ═══════════════════════════════════════════════════════════════

/**
 * Information about a single interrupt within a graph execution.
 */
export interface InterruptInfo {
  /** Unique identifier for this interrupt instance. */
  id: string;
  /** The value passed to `interrupt()` — describes what's needed from the human. */
  value: unknown;
  /** The node that raised the interrupt. */
  nodeId?: string;
  /** Whether this interrupt has been resumed. */
  resumable: boolean;
}

/**
 * Thrown when a graph node calls `interrupt()` and no resume value is available.
 *
 * This exception is caught by the Pregel engine to save the current state
 * and surface the interrupt information to the caller.
 *
 * Unlike regular errors, GraphInterrupt is a **control flow mechanism** —
 * it should NOT be caught by user code in try-catch blocks.
 */
export class GraphInterrupt extends Error {
  /** List of interrupts raised during this execution. */
  readonly interrupts: InterruptInfo[];

  constructor(interrupts: InterruptInfo[]) {
    const messages = interrupts.map(
      (i) =>
        `Interrupt(id=${i.id}, value=${JSON.stringify(i.value)})`
    );
    super(`Graph interrupted: ${messages.join(", ")}`);
    this.name = "GraphInterrupt";
    this.interrupts = interrupts;
  }
}

/**
 * Thrown from within a node to request human input.
 *
 * This is a convenience wrapper — functionally identical to calling
 * `interrupt()` but can be thrown directly for more explicit control flow.
 */
export class NodeInterrupt extends GraphInterrupt {
  constructor(value: unknown) {
    const id = uuid6(0);
    super([{ id, value, resumable: true }]);
    this.name = "NodeInterrupt";
  }
}

/**
 * Type guard for GraphInterrupt errors.
 */
export function isGraphInterrupt(error: unknown): error is GraphInterrupt {
  return (
    error instanceof GraphInterrupt ||
    (error instanceof Error && error.name === "GraphInterrupt") ||
    (error instanceof Error && error.name === "NodeInterrupt")
  );
}

// ═══════════════════════════════════════════════════════════════
//  Execution context (AsyncLocalStorage-based scratchpad)
// ═══════════════════════════════════════════════════════════════

/**
 * Internal execution context passed through AsyncLocalStorage.
 * Carries resume values and interrupt counter for the current node execution.
 */
export interface InterruptContext {
  /** Resume values provided via Command({ resume: ... }). Indexed by interrupt counter. */
  resumeValues: unknown[];
  /** Counter tracking which interrupt() call we're at in the current node. */
  interruptCounter: number;
  /** The node ID currently executing. */
  nodeId: string;
  /** Collected interrupts from this node execution. */
  collectedInterrupts: InterruptInfo[];
}

/**
 * AsyncLocalStorage instance that carries interrupt context through the call stack.
 * This allows `interrupt()` to be called at any depth without threading context manually.
 */
export const interruptContextStorage = new AsyncLocalStorage<InterruptContext>();

// ═══════════════════════════════════════════════════════════════
//  interrupt() function
// ═══════════════════════════════════════════════════════════════

/**
 * Pause graph execution and wait for external input.
 *
 * When called inside a node function:
 * - If resume values are available (from `Command({ resume })`), returns the
 *   resume value for this interrupt index
 * - If no resume value is available, throws `GraphInterrupt` to pause execution
 *
 * The `value` parameter is the payload sent to the external system (UI, API)
 * describing what input is needed. It can be any serializable value.
 *
 * @param value - Payload describing the interrupt (sent to the human/UI)
 * @returns The resume value provided by the external system
 * @throws {GraphInterrupt} When no resume value is available (first execution)
 *
 * @example
 * ```ts
 * // Simple approval
 * const approved = interrupt("Please approve this action");
 *
 * // Structured payload
 * const response = interrupt({
 *   type: "approval",
 *   action: "delete_file",
 *   details: { path: "/important/file.txt" },
 * });
 *
 * // Multiple interrupts in one node
 * const name = interrupt("What is your name?");
 * const age = interrupt("What is your age?");
 * ```
 */
export function interrupt<T = unknown>(value: unknown): T {
  const ctx = interruptContextStorage.getStore();

  if (!ctx) {
    throw new Error(
      "interrupt() called outside of a graph execution context. " +
        "It can only be called inside a node function during graph.invoke()."
    );
  }

  const currentIndex = ctx.interruptCounter;
  ctx.interruptCounter += 1;

  // Check if we have a resume value for this interrupt index
  if (currentIndex < ctx.resumeValues.length) {
    return ctx.resumeValues[currentIndex] as T;
  }

  // No resume value — create interrupt info and throw
  const interruptInfo: InterruptInfo = {
    id: uuid6(0),
    value,
    nodeId: ctx.nodeId,
    resumable: true,
  };

  ctx.collectedInterrupts.push(interruptInfo);

  throw new GraphInterrupt([interruptInfo]);
}
