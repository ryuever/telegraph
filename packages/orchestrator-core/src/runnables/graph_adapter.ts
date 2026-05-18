/**
 * RunnableGraph — wraps a CompiledStateGraph as a Runnable, enabling
 * bi-directional integration between the Runnable and StateGraph worlds.
 *
 * ```ts
 * const compiled = new StateGraph(State).addNode(...).compile();
 * const runnable = new RunnableGraph(compiled);
 *
 * // Now the graph can be composed with other runnables:
 * const pipeline = preprocess.pipe(runnable).pipe(postprocess);
 * ```
 */

import { Runnable } from "./base.js";
import type { RunnableConfig } from "./config.js";
import type { CompiledStateGraph } from "../graph/state.js";
import type { NodeAction } from "../graph/types.js";

/**
 * Wraps a CompiledStateGraph as a Runnable.
 */
export class RunnableGraph<
  S extends Record<string, unknown> = Record<string, unknown>,
> extends Runnable<Partial<S>, S> {
  readonly graph: CompiledStateGraph<S>;

  constructor(graph: CompiledStateGraph<S>, name?: string) {
    super(name ?? graph.name ?? "RunnableGraph");
    this.graph = graph;
  }

  async invoke(input: Partial<S>, config?: RunnableConfig): Promise<S> {
    return this.graph.invoke(input, {
      recursionLimit:
        (config?.configurable?.recursionLimit as number | undefined) ??
        undefined,
      signal: config?.signal,
    });
  }
}

/**
 * Adapt any Runnable<I, O> into a NodeAction<I, O> for use inside a StateGraph.
 *
 * ```ts
 * const chain = RunnableLambda.from(fetchData).pipe(RunnableLambda.from(parse));
 * const graph = new StateGraph(State)
 *   .addNode("process", toNodeAction(chain))
 *   .addEdge(START, "process")
 *   .compile();
 * ```
 */
export function toNodeAction<S, U>(
  runnable: Runnable<S, U>
): NodeAction<S, U> {
  return async (state, config) => {
    return runnable.invoke(state, {
      signal: config?.signal,
      metadata: config?.taskId ? { taskId: config.taskId } : undefined,
    });
  };
}
