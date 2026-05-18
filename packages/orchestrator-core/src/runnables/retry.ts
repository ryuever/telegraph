/**
 * RunnableRetry — wraps a runnable with automatic retry on failure.
 *
 * ```ts
 * const r = unstableRunnable.withRetry({
 *   maxAttempts: 3,
 *   delayMs: 200,
 *   backoffFactor: 2,
 * });
 * ```
 */

import { Runnable, _registerFactory } from "./base.js";
import type { RunnableConfig, RetryOptions } from "./config.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class RunnableRetry<Input, Output> extends Runnable<Input, Output> {
  readonly wrapped: Runnable<Input, Output>;
  readonly maxAttempts: number;
  readonly delayMs: number;
  readonly backoffFactor: number;
  readonly retryOn: (error: Error) => boolean;

  constructor(
    wrapped: Runnable<Input, Output>,
    options?: RetryOptions,
    name?: string
  ) {
    super(name ?? `RunnableRetry(${wrapped.name})`);
    this.wrapped = wrapped;
    this.maxAttempts = options?.maxAttempts ?? 3;
    this.delayMs = options?.delayMs ?? 100;
    this.backoffFactor = options?.backoffFactor ?? 2;
    this.retryOn = options?.retryOn ?? (() => true);
  }

  async invoke(input: Input, config?: RunnableConfig): Promise<Output> {
    let lastError: Error | undefined;
    let delay = this.delayMs;

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      try {
        config?.signal?.throwIfAborted();
        return await this.wrapped.invoke(input, config);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (!this.retryOn(lastError) || attempt === this.maxAttempts - 1) {
          throw lastError;
        }
        await sleep(delay);
        delay *= this.backoffFactor;
      }
    }

    throw lastError!;
  }
}

// Self-register
_registerFactory("retry", (<I, O>(wrapped: Runnable<I, O>, options?: RetryOptions) =>
  new RunnableRetry<I, O>(wrapped, options)) as never);
