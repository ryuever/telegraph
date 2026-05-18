/**
 * @orchestrator/core/runnables — LangChain-style composable execution units.
 *
 * Provides a unified `Runnable` interface for building pipelines that
 * integrate with the orchestrator's StateGraph execution engine.
 *
 * IMPORT ORDER MATTERS: Concrete classes must be imported before they can
 * be used via `pipe()` / `coerceToRunnable()` because they self-register
 * their factories at import time.
 *
 * @example
 * ```ts
 * import {
 *   RunnableLambda,
 *   RunnableSequence,
 *   RunnableParallel,
 *   RunnableBranch,
 *   RunnablePassthrough,
 *   RunnableGraph,
 *   toNodeAction,
 * } from "@orchestrator/core";
 *
 * // Build a pipeline
 * const pipeline = RunnableLambda.from((x: string) => x.trim())
 *   .pipe((s) => s.toUpperCase())
 *   .pipe((s) => ({ result: s, length: s.length }));
 *
 * await pipeline.invoke("  hello  ");
 * // { result: "HELLO", length: 5 }
 * ```
 */

// Config types (no dependencies)
export {
  type RunnableConfig,
  type RetryOptions,
  mergeConfig,
} from "./config.js";

// Base class & utils (no concrete deps, only registry)
export {
  Runnable,
  coerceToRunnable,
  type RunnableLike,
} from "./base.js";

// ── Concrete implementations (self-register on import) ──────
// Import order: leaf classes first (no deps on siblings),
// then classes that depend on base only.
export { RunnableLambda } from "./lambda.js";
export { RunnableSequence } from "./sequence.js";
export { RunnableBinding } from "./binding.js";
export { RunnableWithFallbacks } from "./fallbacks.js";
export { RunnableRetry } from "./retry.js";

// These don't need registry registration (no circular dep with base)
export { RunnableParallel, type RunnableParallelSpec } from "./parallel.js";
export {
  RunnableBranch,
  type BranchCondition,
  type BranchEntry,
} from "./branch.js";
export { RunnablePassthrough } from "./passthrough.js";

// Graph adapter
export { RunnableGraph, toNodeAction } from "./graph_adapter.js";
