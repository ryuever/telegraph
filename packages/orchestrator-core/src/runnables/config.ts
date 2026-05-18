/**
 * Configuration types for Runnable execution.
 */

/** Configuration passed to runnable invocations. */
export interface RunnableConfig {
  /** Signal for cancellation. */
  signal?: AbortSignal;
  /** Maximum number of concurrent batch items. */
  maxConcurrency?: number;
  /** Tags for tracing / filtering. */
  tags?: string[];
  /** Arbitrary metadata attached to the run. */
  metadata?: Record<string, unknown>;
  /** User-defined configurable parameters. */
  configurable?: Record<string, unknown>;
}

/** Options for retry behavior. */
export interface RetryOptions {
  /** Maximum number of attempts (including the first). Defaults to 3. */
  maxAttempts?: number;
  /** Initial delay in milliseconds. Defaults to 100. */
  delayMs?: number;
  /** Multiplier applied to the delay after each attempt. Defaults to 2. */
  backoffFactor?: number;
  /** Predicate to decide if an error is retryable. Defaults to always true. */
  retryOn?: (error: Error) => boolean;
}

/** Merge two RunnableConfigs, with `b` taking precedence. */
export function mergeConfig(
  a: RunnableConfig | undefined,
  b: RunnableConfig | undefined
): RunnableConfig {
  if (!a) return b ?? {};
  if (!b) return a;
  return {
    signal: b.signal ?? a.signal,
    maxConcurrency: b.maxConcurrency ?? a.maxConcurrency,
    tags: [...(a.tags ?? []), ...(b.tags ?? [])],
    metadata: { ...(a.metadata ?? {}), ...(b.metadata ?? {}) },
    configurable: { ...(a.configurable ?? {}), ...(b.configurable ?? {}) },
  };
}
