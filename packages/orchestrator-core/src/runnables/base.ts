/**
 * Abstract Runnable base class — the unified interface for all executable units.
 *
 * Every Runnable exposes:
 * - invoke(): single execution
 * - batch(): parallel execution over multiple inputs
 * - stream(): async-generator based streaming
 * - pipe(): sequential composition
 *
 * Concrete implementations: RunnableLambda, RunnableSequence, RunnableParallel, etc.
 *
 * CIRCULAR DEPENDENCY NOTE:
 * To avoid ESM circular-dependency issues (base ↔ sequence ↔ lambda etc.),
 * this module does NOT import any concrete Runnable subclasses. Instead,
 * it uses a registry pattern: subclass modules register themselves at import
 * time via `_registerFactory()`, and methods like `pipe()` / `coerceToRunnable()`
 * look up the registry at call time (long after all modules are initialized).
 */

import type { RunnableConfig, RetryOptions } from "./config.js";

// ── Factory registry (breaks circular deps) ─────────────────
type LambdaFactory = <I, O>(fn: (input: I, config?: RunnableConfig) => O | Promise<O>) => Runnable<I, O>;
type SequenceFactory = <I, O>(steps: Runnable<unknown, unknown>[]) => Runnable<I, O>;
type BindingFactory = <I, O>(bound: Runnable<I, O>, config: Partial<RunnableConfig>) => Runnable<I, O>;
type FallbacksFactory = <I, O>(primary: Runnable<I, O>, fallbacks: Runnable<I, O>[]) => Runnable<I, O>;
type RetryFactory = <I, O>(wrapped: Runnable<I, O>, options?: RetryOptions) => Runnable<I, O>;

const _factories: {
  lambda?: LambdaFactory;
  sequence?: SequenceFactory;
  binding?: BindingFactory;
  fallbacks?: FallbacksFactory;
  retry?: RetryFactory;
} = {};

/** @internal Register a concrete class factory. Called by subclass modules. */
export function _registerFactory(
  name: "lambda" | "sequence" | "binding" | "fallbacks" | "retry",
  factory: (...args: never[]) => unknown
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (_factories as any)[name] = factory;
}

/**
 * A function that can be coerced into a Runnable.
 */
export type RunnableLike<I, O> =
  | Runnable<I, O>
  | ((input: I, config?: RunnableConfig) => O | Promise<O>);

/**
 * Abstract base class for all runnables.
 *
 * @typeParam Input  - The input type accepted by `invoke`.
 * @typeParam Output - The output type returned by `invoke`.
 */
export abstract class Runnable<Input, Output> {
  /** Human-readable name for debugging / tracing. */
  readonly name: string;

  constructor(name?: string) {
    this.name = name ?? this.constructor.name;
  }

  /** Execute with a single input. */
  abstract invoke(input: Input, config?: RunnableConfig): Promise<Output>;

  /**
   * Compose this runnable with another, creating a sequential pipeline.
   *
   * ```ts
   * const pipeline = a.pipe(b).pipe(c);
   * // equivalent to: input -> a -> b -> c -> output
   * ```
   */
  pipe<Next>(
    next: RunnableLike<Output, Next>
  ): Runnable<Input, Next> {
    if (!_factories.sequence) {
      throw new Error("RunnableSequence not registered. Import '@orchestrator/core' or './sequence.js' first.");
    }
    const nextRunnable = coerceToRunnable(next);
    return _factories.sequence<Input, Next>([
      this as Runnable<Input, unknown>,
      nextRunnable as Runnable<unknown, Next>,
    ]);
  }

  /**
   * Execute on multiple inputs, with optional concurrency control.
   */
  async batch(
    inputs: Input[],
    config?: RunnableConfig
  ): Promise<Output[]> {
    const max = config?.maxConcurrency ?? Infinity;
    const results: Output[] = new Array(inputs.length);

    for (let i = 0; i < inputs.length; i += max) {
      const chunk = inputs.slice(i, i + max);
      const chunkResults = await Promise.all(
        chunk.map((input) => this.invoke(input, config))
      );
      for (let j = 0; j < chunkResults.length; j++) {
        results[i + j] = chunkResults[j];
      }
    }
    return results;
  }

  /**
   * Stream output chunks. Default implementation yields the full result
   * as a single chunk. Subclasses can override for true streaming.
   */
  async *stream(
    input: Input,
    config?: RunnableConfig
  ): AsyncGenerator<Output> {
    yield await this.invoke(input, config);
  }

  /**
   * Return a new runnable with fixed configuration values.
   */
  bind(boundConfig: Partial<RunnableConfig>): Runnable<Input, Output> {
    if (!_factories.binding) {
      throw new Error("RunnableBinding not registered.");
    }
    return _factories.binding<Input, Output>(this, boundConfig);
  }

  /**
   * Return a new runnable that falls back to alternatives on error.
   */
  withFallbacks(
    fallbacks: RunnableLike<Input, Output>[]
  ): Runnable<Input, Output> {
    if (!_factories.fallbacks) {
      throw new Error("RunnableWithFallbacks not registered.");
    }
    return _factories.fallbacks<Input, Output>(
      this,
      fallbacks.map((f) => coerceToRunnable(f))
    );
  }

  /**
   * Return a new runnable that retries on error.
   */
  withRetry(options?: RetryOptions): Runnable<Input, Output> {
    if (!_factories.retry) {
      throw new Error("RunnableRetry not registered.");
    }
    return _factories.retry<Input, Output>(this, options);
  }
}

/**
 * Coerce a plain function or Runnable into a Runnable instance.
 */
export function coerceToRunnable<I, O>(
  thing: RunnableLike<I, O>
): Runnable<I, O> {
  if (thing instanceof Runnable) return thing;
  if (typeof thing === "function") {
    if (!_factories.lambda) {
      throw new Error("RunnableLambda not registered. Import '@orchestrator/core' or './lambda.js' first.");
    }
    return _factories.lambda<I, O>(
      thing as (input: I, config?: RunnableConfig) => O | Promise<O>
    );
  }
  throw new Error(
    `Cannot coerce ${typeof thing} to Runnable. Expected a function or Runnable instance.`
  );
}
