/**
 * Core type definitions for the graph builder.
 */

import { BaseChannel } from "../channels/base.js";
import type { BaseCheckpointSaver } from "../checkpoint/base.js";

/** A node action can be a plain async function or any callable. */
export type NodeAction<S = unknown, U = unknown> = (
  state: S,
  config?: NodeConfig
) => U | Promise<U>;

/** Configuration passed to node functions during execution. */
export interface NodeConfig {
  /** Unique task identifier. */
  taskId?: string;
  /** Signal for cancellation. */
  signal?: AbortSignal;
}

/** Stored specification for a graph node. */
export interface NodeSpec<S = unknown, U = unknown> {
  /** The node's action function. */
  action: NodeAction<S, U>;
  /** Optional metadata. */
  metadata?: Record<string, unknown>;
}

/** Options for addNode. */
export interface AddNodeOptions {
  /** Optional metadata attached to the node. */
  metadata?: Record<string, unknown>;
  /** Defer execution until all non-deferred nodes complete. */
  defer?: boolean;
}

/**
 * A conditional branch definition.
 * Maps a condition function's return values to target nodes.
 */
export interface BranchDef<S = unknown, N extends string = string> {
  /** Function that determines the next node(s) based on state. */
  path: (state: S, config?: NodeConfig) => string | string[] | Promise<string | string[]>;
  /** Optional mapping of path return values to node names. */
  pathMap?: Record<string, N> | N[];
  /** Optional "then" node to always go to after the selected node. */
  then?: N;
}

/**
 * Internal representation of a compiled node in the execution engine.
 */
export interface CompiledNode<S = unknown, U = unknown> {
  /** Channel names that trigger this node. */
  triggers: string[];
  /** Mapping of input keys to channel names for reading. */
  channels: Record<string, string> | string[];
  /** The node's action function (user code). */
  action?: NodeAction<S, U>;
  /** Write entries: what channels to write to after execution. */
  writers: WriteEntry[];
  /** Optional input mapper. */
  mapper?: (input: Record<string, unknown>) => Record<string, unknown>;
  /** Whether this node is deferred. */
  defer?: boolean;
  /** Node metadata. */
  metadata?: Record<string, unknown>;
}

/** A write entry targeting a specific channel. */
export interface WriteEntry {
  channel: string;
  /** If PASSTHROUGH, use the node's output; otherwise use this literal value. */
  value: unknown;
  /** Optional mapper to transform the value before writing. */
  mapper?: (value: unknown) => [string, unknown][] | null;
}

/** Options for compiling a graph. */
export interface CompileOptions {
  /** Maximum number of supersteps before raising GraphRecursionError. */
  recursionLimit?: number;
  /** Name for the compiled graph. */
  name?: string;
  /** Description for the compiled graph. */
  description?: string;
  /** Checkpoint saver for state persistence across invocations. */
  checkpointer?: BaseCheckpointSaver;
  /**
   * Node names to interrupt BEFORE execution.
   * When a node in this list is about to execute, the graph pauses and
   * throws a GraphInterrupt. Resume with `graph.invoke(new Command({ resume: ... }))`.
   * Requires a checkpointer to be configured.
   */
  interruptBefore?: string[];
  /**
   * Node names to interrupt AFTER execution.
   * When a node in this list finishes execution, the graph pauses and
   * throws a GraphInterrupt. Resume with `graph.invoke(new Command({ resume: ... }))`.
   * Requires a checkpointer to be configured.
   */
  interruptAfter?: string[];
}

/**
 * Specifications for all channels in a compiled graph.
 */
export type ChannelSpecs = Record<string, BaseChannel>;
