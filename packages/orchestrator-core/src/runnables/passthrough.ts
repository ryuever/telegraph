/**
 * RunnablePassthrough — passes input through unchanged, optionally merging
 * additional computed fields (via `assign`).
 *
 * ```ts
 * // Pure passthrough
 * const r = new RunnablePassthrough();
 * await r.invoke({ x: 1 }); // { x: 1 }
 *
 * // With assign: merge computed fields into the input
 * const r2 = RunnablePassthrough.assign({
 *   doubled: (input: { x: number }) => input.x * 2,
 * });
 * await r2.invoke({ x: 5 }); // { x: 5, doubled: 10 }
 * ```
 */

import { Runnable, coerceToRunnable, type RunnableLike } from "./base.js";
import type { RunnableConfig } from "./config.js";

export class RunnablePassthrough<
  Input extends Record<string, unknown> = Record<string, unknown>,
> extends Runnable<Input, Input> {
  constructor(name?: string) {
    super(name ?? "RunnablePassthrough");
  }

  async invoke(input: Input, config?: RunnableConfig): Promise<Input> {
    config?.signal?.throwIfAborted();
    return input;
  }

  /**
   * Create a passthrough that also computes and merges additional fields.
   *
   * Each key in `mapping` is a field name, and the value is a Runnable or
   * function that computes the field value from the input.
   */
  static assign<Input extends Record<string, unknown>>(
    mapping: Record<string, RunnableLike<Input, unknown>>
  ): RunnableAssign<Input> {
    return new RunnableAssign<Input>(mapping);
  }
}

/**
 * Internal class that passes through input and merges computed fields.
 */
class RunnableAssign<
  Input extends Record<string, unknown>,
> extends Runnable<Input, Input & Record<string, unknown>> {
  private readonly mapping: Record<string, Runnable<Input, unknown>>;

  constructor(mapping: Record<string, RunnableLike<Input, unknown>>) {
    super("RunnableAssign");
    this.mapping = {};
    for (const [key, val] of Object.entries(mapping)) {
      this.mapping[key] = coerceToRunnable(val);
    }
  }

  async invoke(
    input: Input,
    config?: RunnableConfig
  ): Promise<Input & Record<string, unknown>> {
    config?.signal?.throwIfAborted();

    const entries = Object.entries(this.mapping);
    const results = await Promise.all(
      entries.map(async ([key, runnable]) => {
        const result = await runnable.invoke(input, config);
        return [key, result] as [string, unknown];
      })
    );

    return { ...input, ...Object.fromEntries(results) };
  }
}
