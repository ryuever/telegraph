/**
 * Base Graph class providing the builder API for defining workflow topologies.
 *
 * This is the abstract base that StateGraph extends. It provides:
 * - addNode(): register named nodes
 * - addEdge(): define static edges between nodes
 * - addConditionalEdges(): define dynamic routing
 */

import { START, END } from "../constants.js";
import { GraphValidationError } from "../errors.js";
import type {
  NodeAction,
  NodeSpec,
  AddNodeOptions,
  BranchDef,
  NodeConfig,
} from "./types.js";

/**
 * Base graph builder. Collects nodes, edges, and branches in an abstract
 * topology representation.
 */
export class Graph<
  N extends string = typeof START,
  S = unknown,
  U = unknown,
> {
  /** Registered node specifications. */
  nodes: Record<string, NodeSpec<S, U>> = {};

  /** Static edges: [source, target]. */
  edges: Set<[string, string]> = new Set();

  /** Conditional branches: source → name → branch definition. */
  branches: Record<string, Record<string, BranchDef<S>>> = {};

  /** Whether the graph has been compiled. */
  compiled = false;

  /**
   * Add a node to the graph.
   *
   * @param key - Unique node name
   * @param action - Function to execute when this node is triggered
   * @param options - Optional metadata and settings
   * @returns this (for chaining)
   */
  addNode<K extends string>(
    key: K,
    action: NodeAction<S, U>,
    options?: AddNodeOptions
  ): Graph<N | K, S, U> {
    if (key === END || key === START) {
      throw new GraphValidationError(`Node "${key}" is reserved.`);
    }
    if (key in this.nodes) {
      throw new GraphValidationError(`Node "${key}" already exists.`);
    }

    this.nodes[key] = {
      action,
      metadata: options?.metadata,
    };

    return this as unknown as Graph<N | K, S, U>;
  }

  /**
   * Add a static edge from one node to another.
   *
   * @param startKey - Source node (or START)
   * @param endKey - Target node (or END)
   * @returns this (for chaining)
   */
  addEdge(startKey: typeof START | N, endKey: N | typeof END): this {
    if (startKey === END) {
      throw new GraphValidationError("END cannot be a start node.");
    }
    if (startKey !== START && !(startKey in this.nodes)) {
      throw new GraphValidationError(
        `Need to add a node named "${startKey}" first.`
      );
    }
    if (endKey !== END && !(endKey in this.nodes)) {
      throw new GraphValidationError(
        `Need to add a node named "${endKey}" first.`
      );
    }

    this.edges.add([startKey as string, endKey as string]);
    return this;
  }

  /**
   * Add conditional edges from a source node.
   *
   * @param source - The node that triggers routing
   * @param path - Function returning the next node name(s)
   * @param pathMap - Optional mapping of return values to node names
   * @param then - Optional node to always execute after the selected node
   * @returns this (for chaining)
   */
  addConditionalEdges(
    source: N,
    path: (
      state: S,
      config?: NodeConfig
    ) => string | string[] | Promise<string | string[]>,
    pathMap?: Record<string, string> | string[],
    then?: string
  ): this {
    if (!(source in this.nodes) && source !== (START as unknown as N)) {
      throw new GraphValidationError(
        `Need to add a node named "${source}" first.`
      );
    }

    const branchName = `__condition_${Object.keys(this.branches[source as string] ?? {}).length}`;

    if (!this.branches[source as string]) {
      this.branches[source as string] = {};
    }

    let resolvedPathMap: Record<string, string> | undefined;
    if (Array.isArray(pathMap)) {
      resolvedPathMap = Object.fromEntries(pathMap.map((n) => [n, n]));
    } else if (pathMap) {
      resolvedPathMap = pathMap;
    }

    this.branches[source as string][branchName] = {
      path,
      pathMap: resolvedPathMap,
      then,
    };

    return this;
  }

  /**
   * Validate the graph structure.
   */
  validate(): void {
    // Check all edge targets exist
    for (const [start, end] of this.edges) {
      if (start !== START && !(start in this.nodes)) {
        throw new GraphValidationError(
          `Edge source "${start}" is not a registered node.`
        );
      }
      if (end !== END && !(end in this.nodes)) {
        throw new GraphValidationError(
          `Edge target "${end}" is not a registered node.`
        );
      }
    }

    // Check all branch sources exist
    for (const source of Object.keys(this.branches)) {
      if (source !== START && !(source in this.nodes)) {
        throw new GraphValidationError(
          `Branch source "${source}" is not a registered node.`
        );
      }
    }

    // Check that START has at least one outgoing edge or branch
    const hasStartEdge = Array.from(this.edges).some(([s]) => s === START);
    const hasStartBranch = START in this.branches;
    if (!hasStartEdge && !hasStartBranch) {
      throw new GraphValidationError(
        "Graph has no entry point. Add an edge from START to a node."
      );
    }

    // Check for unreachable nodes
    const reachable = new Set<string>();
    const queue: string[] = [START];
    while (queue.length > 0) {
      const current = queue.pop()!;
      if (reachable.has(current)) continue;
      reachable.add(current);

      for (const [s, e] of this.edges) {
        if (s === current && !reachable.has(e)) {
          queue.push(e);
        }
      }

      for (const branch of Object.values(this.branches[current] ?? {})) {
        if (branch.pathMap) {
          for (const target of Object.values(branch.pathMap)) {
            if (!reachable.has(target)) {
              queue.push(target);
            }
          }
        }
        if (branch.then && !reachable.has(branch.then)) {
          queue.push(branch.then);
        }
      }
    }

    for (const name of Object.keys(this.nodes)) {
      if (!reachable.has(name)) {
        console.warn(`Warning: Node "${name}" is unreachable from START.`);
      }
    }
  }
}
