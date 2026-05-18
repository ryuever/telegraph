/**
 * RunnableLambda — wraps a plain function as a Runnable.
 *
 * ```ts
 * const r = new RunnableLambda((x: number) => x * 2);
 * await r.invoke(5); // 10
 * ```
 */

import { Runnable, _registerFactory } from "./base.js";
import type { RunnableConfig } from "./config.js";

export class RunnableLambda<Input, Output> extends Runnable<Input, Output> {
  private readonly fn: (input: Input, config?: RunnableConfig) => Output | Promise<Output>;

  constructor(
    fn: (input: Input, config?: RunnableConfig) => Output | Promise<Output>,
    name?: string
  ) {
    super(name ?? (fn.name || "RunnableLambda"));
    this.fn = fn;
  }

  async invoke(input: Input, config?: RunnableConfig): Promise<Output> {
    config?.signal?.throwIfAborted();
    return this.fn(input, config);
  }

  /**
   * Static factory for convenience.
   */
  static from<I, O>(
    fn: (input: I, config?: RunnableConfig) => O | Promise<O>,
    name?: string
  ): RunnableLambda<I, O> {
    return new RunnableLambda(fn, name);
  }
}

// Self-register
_registerFactory("lambda", (<I, O>(fn: (input: I, config?: RunnableConfig) => O | Promise<O>) =>
  new RunnableLambda<I, O>(fn)) as never);
