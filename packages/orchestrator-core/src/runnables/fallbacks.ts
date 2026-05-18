/**
 * RunnableWithFallbacks — tries the primary runnable first, then each
 * fallback in order if the previous one throws.
 *
 * ```ts
 * const r = primary.withFallbacks([fallback1, fallback2]);
 * // tries: primary -> fallback1 -> fallback2
 * ```
 */

import { Runnable, _registerFactory } from "./base.js";
import type { RunnableConfig } from "./config.js";

export class RunnableWithFallbacks<Input, Output> extends Runnable<
  Input,
  Output
> {
  readonly primary: Runnable<Input, Output>;
  readonly fallbacks: Runnable<Input, Output>[];

  constructor(
    primary: Runnable<Input, Output>,
    fallbacks: Runnable<Input, Output>[],
    name?: string
  ) {
    super(name ?? `RunnableWithFallbacks(${primary.name})`);
    this.primary = primary;
    this.fallbacks = fallbacks;
  }

  async invoke(input: Input, config?: RunnableConfig): Promise<Output> {
    let lastError: Error | undefined;

    // Try primary
    try {
      return await this.primary.invoke(input, config);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
    }

    // Try fallbacks
    for (const fallback of this.fallbacks) {
      try {
        return await fallback.invoke(input, config);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }

    throw lastError!;
  }
}

// Self-register
_registerFactory("fallbacks", (<I, O>(primary: Runnable<I, O>, fallbacks: Runnable<I, O>[]) =>
  new RunnableWithFallbacks<I, O>(primary, fallbacks)) as never);
