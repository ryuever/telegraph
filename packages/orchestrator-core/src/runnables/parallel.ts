/**
 * RunnableParallel — execute multiple runnables in parallel on the same input,
 * then merge their outputs into a single object.
 *
 * ```ts
 * const r = new RunnableParallel({
 *   upper: new RunnableLambda((s: string) => s.toUpperCase()),
 *   len:   new RunnableLambda((s: string) => s.length),
 * });
 * await r.invoke("hello");
 * // { upper: "HELLO", len: 5 }
 * ```
 */

import { Runnable, coerceToRunnable, type RunnableLike } from "./base.js";
import type { RunnableConfig } from "./config.js";

/**
 * A mapping of keys to runnables (or functions). The output is an object
 * with the same keys, where each value is the corresponding runnable's output.
 */
export type RunnableParallelSpec<Input> = Record<
  string,
  RunnableLike<Input, unknown>
>;

export class RunnableParallel<
  Input,
  Output extends Record<string, unknown> = Record<string, unknown>,
> extends Runnable<Input, Output> {
  private readonly branches: Record<string, Runnable<Input, unknown>>;

  constructor(spec: RunnableParallelSpec<Input>, name?: string) {
    super(name ?? "RunnableParallel");
    this.branches = {};
    for (const [key, runnable] of Object.entries(spec)) {
      this.branches[key] = coerceToRunnable(runnable);
    }
  }

  async invoke(input: Input, config?: RunnableConfig): Promise<Output> {
    config?.signal?.throwIfAborted();

    const entries = Object.entries(this.branches);
    const results = await Promise.all(
      entries.map(async ([key, runnable]) => {
        const result = await runnable.invoke(input, config);
        return [key, result] as [string, unknown];
      })
    );

    return Object.fromEntries(results) as Output;
  }

  /**
   * Static factory.
   */
  static from<I>(
    spec: RunnableParallelSpec<I>
  ): RunnableParallel<I> {
    return new RunnableParallel(spec);
  }
}
