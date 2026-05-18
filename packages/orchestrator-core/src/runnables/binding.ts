/**
 * RunnableBinding — wraps a runnable with fixed configuration values.
 *
 * ```ts
 * const r = someRunnable.bind({ tags: ["prod"], maxConcurrency: 2 });
 * await r.invoke(input); // uses the bound config automatically
 * ```
 */

import { Runnable, _registerFactory } from "./base.js";
import { mergeConfig, type RunnableConfig } from "./config.js";

export class RunnableBinding<Input, Output> extends Runnable<Input, Output> {
  readonly bound: Runnable<Input, Output>;
  readonly boundConfig: Partial<RunnableConfig>;

  constructor(
    bound: Runnable<Input, Output>,
    config: Partial<RunnableConfig>,
    name?: string
  ) {
    super(name ?? `RunnableBinding(${bound.name})`);
    this.bound = bound;
    this.boundConfig = config;
  }

  async invoke(input: Input, config?: RunnableConfig): Promise<Output> {
    const merged = mergeConfig(this.boundConfig, config);
    return this.bound.invoke(input, merged);
  }

  async *stream(
    input: Input,
    config?: RunnableConfig
  ): AsyncGenerator<Output> {
    const merged = mergeConfig(this.boundConfig, config);
    yield* this.bound.stream(input, merged);
  }

  async batch(
    inputs: Input[],
    config?: RunnableConfig
  ): Promise<Output[]> {
    const merged = mergeConfig(this.boundConfig, config);
    return this.bound.batch(inputs, merged);
  }
}

// Self-register
_registerFactory("binding", (<I, O>(bound: Runnable<I, O>, config: Partial<RunnableConfig>) =>
  new RunnableBinding<I, O>(bound, config)) as never);
