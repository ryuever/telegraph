/**
 * RunnableSequence — sequential composition of runnables.
 *
 * ```ts
 * const chain = new RunnableSequence([a, b, c]);
 * // same as: a.pipe(b).pipe(c)
 * ```
 */

import { Runnable, coerceToRunnable, _registerFactory, type RunnableLike } from "./base.js";
import type { RunnableConfig } from "./config.js";

export class RunnableSequence<Input, Output> extends Runnable<Input, Output> {
  readonly steps: Runnable<unknown, unknown>[];

  constructor(steps: Runnable<unknown, unknown>[], name?: string) {
    super(name ?? "RunnableSequence");
    if (steps.length < 2) {
      throw new Error("RunnableSequence requires at least 2 steps.");
    }
    this.steps = steps;
  }

  async invoke(input: Input, config?: RunnableConfig): Promise<Output> {
    config?.signal?.throwIfAborted();
    let current: unknown = input;
    for (const step of this.steps) {
      config?.signal?.throwIfAborted();
      current = await step.invoke(current, config);
    }
    return current as Output;
  }

  /** Stream: pipe each step's output into the next. */
  async *stream(
    input: Input,
    config?: RunnableConfig
  ): AsyncGenerator<Output> {
    // For sequences, we fully resolve all steps except the last,
    // then stream the last step.
    let current: unknown = input;
    for (let i = 0; i < this.steps.length - 1; i++) {
      config?.signal?.throwIfAborted();
      current = await this.steps[i].invoke(current, config);
    }
    const lastStep = this.steps[this.steps.length - 1];
    yield* lastStep.stream(current, config) as AsyncGenerator<Output>;
  }

  /**
   * Override pipe to flatten nested sequences.
   */
  override pipe<Next>(
    next: RunnableLike<Output, Next>
  ): RunnableSequence<Input, Next> {
    const nextRunnable = coerceToRunnable(next);
    return new RunnableSequence<Input, Next>([
      ...this.steps,
      nextRunnable as Runnable<unknown, unknown>,
    ]);
  }

  /**
   * Create a sequence from varargs or an array.
   */
  static from<I, O>(
    steps: RunnableLike<unknown, unknown>[]
  ): RunnableSequence<I, O> {
    return new RunnableSequence<I, O>(
      steps.map((s) => coerceToRunnable(s))
    );
  }

  /** First step in the chain. */
  get first(): Runnable<Input, unknown> {
    return this.steps[0] as Runnable<Input, unknown>;
  }

  /** Last step in the chain. */
  get last(): Runnable<unknown, Output> {
    return this.steps[this.steps.length - 1] as Runnable<unknown, Output>;
  }
}

// Self-register
_registerFactory("sequence", (<I, O>(steps: Runnable<unknown, unknown>[]) =>
  new RunnableSequence<I, O>(steps)) as never);
