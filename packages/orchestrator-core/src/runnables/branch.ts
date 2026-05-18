/**
 * RunnableBranch — conditional routing based on input.
 *
 * Takes a list of (condition, runnable) pairs and a default runnable.
 * The first condition that returns true determines which branch to execute.
 *
 * ```ts
 * const r = new RunnableBranch(
 *   [
 *     [(x: number) => x > 0, new RunnableLambda(() => "positive")],
 *     [(x: number) => x < 0, new RunnableLambda(() => "negative")],
 *   ],
 *   new RunnableLambda(() => "zero") // default
 * );
 * await r.invoke(5);  // "positive"
 * await r.invoke(-1); // "negative"
 * await r.invoke(0);  // "zero"
 * ```
 */

import { Runnable, coerceToRunnable, type RunnableLike } from "./base.js";
import type { RunnableConfig } from "./config.js";

export type BranchCondition<Input> =
  | ((input: Input) => boolean)
  | ((input: Input) => Promise<boolean>);

export type BranchEntry<Input, Output> = [
  BranchCondition<Input>,
  RunnableLike<Input, Output>,
];

export class RunnableBranch<Input, Output> extends Runnable<Input, Output> {
  private readonly branches: Array<[BranchCondition<Input>, Runnable<Input, Output>]>;
  private readonly defaultBranch: Runnable<Input, Output>;

  constructor(
    branches: BranchEntry<Input, Output>[],
    defaultBranch: RunnableLike<Input, Output>,
    name?: string
  ) {
    super(name ?? "RunnableBranch");
    this.branches = branches.map(([cond, runnable]) => [
      cond,
      coerceToRunnable(runnable),
    ]);
    this.defaultBranch = coerceToRunnable(defaultBranch);
  }

  async invoke(input: Input, config?: RunnableConfig): Promise<Output> {
    config?.signal?.throwIfAborted();

    for (const [condition, runnable] of this.branches) {
      if (await condition(input)) {
        return runnable.invoke(input, config);
      }
    }
    return this.defaultBranch.invoke(input, config);
  }

  /**
   * Static factory.
   */
  static from<I, O>(
    branches: BranchEntry<I, O>[],
    defaultBranch: RunnableLike<I, O>
  ): RunnableBranch<I, O> {
    return new RunnableBranch(branches, defaultBranch);
  }
}
