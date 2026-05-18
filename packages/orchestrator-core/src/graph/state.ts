/**
 * StateGraph — A graph whose nodes communicate via shared state channels.
 *
 * This is the main user-facing API. Usage:
 *
 * ```ts
 * const workflow = new StateGraph(MyState)
 *   .addNode("nodeA", myFunctionA)
 *   .addNode("nodeB", myFunctionB)
 *   .addEdge(START, "nodeA")
 *   .addConditionalEdges("nodeA", router, ["nodeB", "nodeC"])
 *   .addEdge("nodeB", END)
 *   .compile();
 *
 * const result = await workflow.invoke({ input: "hello" });
 * ```
 */

import { Graph } from "./graph.js";
import { BaseChannel } from "../channels/base.js";
import { EphemeralValue } from "../channels/ephemeral_value.js";
import { LastValueAfterFinish } from "../channels/last_value.js";
import {
  NamedBarrierValue,
  NamedBarrierValueAfterFinish,
} from "../channels/named_barrier_value.js";
// Topic channel is used for TASKS (Send-based dynamic fan-out)
import {
  START,
  END,
  TASKS,
  PASSTHROUGH,
  isCommand,
  isSend,
} from "../constants.js";
import { GraphValidationError, StateGraphInputError } from "../errors.js";
import { executePregelGraph } from "../engine/pregel.js";
import type { Command } from "../constants.js";
import type {
  AnnotationRoot,
  StateDefinition,
  StateType,
  UpdateType,
} from "../state/annotation.js";
import type {
  NodeAction,
  AddNodeOptions,
  BranchDef,
  CompiledNode,
  CompileOptions,
  WriteEntry,
  NodeConfig,
} from "./types.js";
import type { BaseCheckpointSaver } from "../checkpoint/base.js";
import type { CheckpointConfig } from "../checkpoint/types.js";

const ROOT = "__root__";

export interface StateGraphAddNodeOptions extends AddNodeOptions {
  /** Custom input schema for this specific node. */
  input?: StateDefinition;
}

/**
 * Options for invoking a compiled graph.
 */
export interface InvokeOptions {
  /** Override the recursion limit for this invocation. */
  recursionLimit?: number;
  /** AbortSignal for cancellation. */
  signal?: AbortSignal;
  /** Thread configuration for checkpoint persistence. */
  configurable?: {
    /** Thread identifier — required when using a checkpointer. */
    thread_id?: string;
    /** Checkpoint namespace for isolation. */
    checkpoint_ns?: string;
    /** Specific checkpoint to resume from. */
    checkpoint_id?: string;
    /** Additional config properties. */
    [key: string]: unknown;
  };
}

/**
 * A compiled, executable graph. Returned by StateGraph.compile().
 */
export class CompiledStateGraph<S = unknown, U = unknown> {
  /** Compiled nodes ready for the Pregel engine. */
  readonly nodes: Record<string, CompiledNode<S, U>>;

  /** Channel specifications. */
  readonly channels: Record<string, BaseChannel>;

  /** Input channel name(s). */
  readonly inputChannels: string;

  /** Output channel names. */
  readonly outputChannels: string[];

  /** Maximum supersteps. */
  readonly recursionLimit: number;

  /** Graph name. */
  readonly name?: string;

  /** Graph description. */
  readonly description?: string;

  /** Optional checkpoint saver for state persistence. */
  readonly checkpointer?: BaseCheckpointSaver;

  /** Nodes to interrupt before execution. */
  readonly interruptBefore: string[];

  /** Nodes to interrupt after execution. */
  readonly interruptAfter: string[];

  constructor(options: {
    nodes: Record<string, CompiledNode<S, U>>;
    channels: Record<string, BaseChannel>;
    inputChannels: string;
    outputChannels: string[];
    recursionLimit?: number;
    name?: string;
    description?: string;
    checkpointer?: BaseCheckpointSaver;
    interruptBefore?: string[];
    interruptAfter?: string[];
  }) {
    this.nodes = options.nodes;
    this.channels = options.channels;
    this.inputChannels = options.inputChannels;
    this.outputChannels = options.outputChannels;
    this.recursionLimit = options.recursionLimit ?? 25;
    this.name = options.name;
    this.description = options.description;
    this.checkpointer = options.checkpointer;
    this.interruptBefore = options.interruptBefore ?? [];
    this.interruptAfter = options.interruptAfter ?? [];
  }

  /**
   * Execute the graph with the given input and return the final state.
   *
   * When a checkpointer is configured and `configurable.thread_id` is provided,
   * state will be persisted across invocations, enabling:
   * - **Resumption**: Continue from where the last invocation left off
   * - **Time-travel**: Resume from a specific checkpoint_id
   * - **History**: List all checkpoints for a thread
   *
   * @example
   * ```ts
   * // Without checkpointer (stateless)
   * const result = await graph.invoke({ query: "hello" });
   *
   * // With checkpointer (stateful)
   * const result = await graph.invoke(
   *   { query: "hello" },
   *   { configurable: { thread_id: "my-thread" } }
   * );
   * ```
   */
  async invoke(
    input: Partial<S> | Command,
    options?: InvokeOptions
  ): Promise<S> {
    // Build checkpoint config from options
    let checkpointConfig: CheckpointConfig | undefined;
    if (this.checkpointer && options?.configurable?.thread_id) {
      checkpointConfig = {
        configurable: {
          thread_id: options.configurable.thread_id,
          checkpoint_ns: options.configurable?.checkpoint_ns ?? "",
          checkpoint_id: options.configurable?.checkpoint_id,
        },
      };
    }

    // Handle Command.resume input
    let actualInput: unknown = input;
    let resumeValues: unknown[] = [];

    if (isCommand(input)) {
      const cmd = input as Command;
      if (cmd.resume !== undefined) {
        resumeValues = Array.isArray(cmd.resume) ? cmd.resume : [cmd.resume];
        // When resuming, we don't pass new input — state comes from checkpoint
        actualInput = {};
      }
      if (cmd.update) {
        actualInput = cmd.update;
      }
    }

    const result = await executePregelGraph({
      nodes: this.nodes,
      channelSpecs: this.channels,
      inputChannels: this.inputChannels,
      outputChannels: this.outputChannels,
      input: actualInput,
      recursionLimit: options?.recursionLimit ?? this.recursionLimit,
      signal: options?.signal,
      checkpointer: this.checkpointer,
      checkpointConfig,
      interruptBefore: this.interruptBefore,
      interruptAfter: this.interruptAfter,
      resumeValues,
    });

    return result as S;
  }

  /**
   * Get the current state for a thread (requires checkpointer).
   */
  async getState(configurable: {
    thread_id: string;
    checkpoint_ns?: string;
    checkpoint_id?: string;
  }): Promise<S | undefined> {
    if (!this.checkpointer) {
      throw new Error(
        "Cannot get state without a checkpointer. " +
          'Compile the graph with { checkpointer: new MemorySaver() }.'
      );
    }

    const config: CheckpointConfig = {
      configurable: {
        thread_id: configurable.thread_id,
        checkpoint_ns: configurable.checkpoint_ns ?? "",
        checkpoint_id: configurable.checkpoint_id,
      },
    };

    const checkpoint = await this.checkpointer.get(config);
    if (!checkpoint) return undefined;

    // Extract output channel values from checkpoint
    const result: Record<string, unknown> = {};
    for (const chan of this.outputChannels) {
      if (chan in checkpoint.channel_values) {
        result[chan] = checkpoint.channel_values[chan];
      }
    }

    return result as S;
  }

  /**
   * List checkpoint history for a thread (requires checkpointer).
   */
  async *getStateHistory(configurable: {
    thread_id: string;
    checkpoint_ns?: string;
    limit?: number;
  }): AsyncGenerator<{
    config: CheckpointConfig;
    state: Partial<S>;
    metadata?: Record<string, unknown>;
    parentConfig?: CheckpointConfig;
  }> {
    if (!this.checkpointer) {
      throw new Error(
        "Cannot get state history without a checkpointer."
      );
    }

    const config: CheckpointConfig = {
      configurable: {
        thread_id: configurable.thread_id,
        checkpoint_ns: configurable.checkpoint_ns ?? "",
      },
    };

    for await (const tuple of this.checkpointer.list(config, {
      limit: configurable.limit,
    })) {
      const state: Record<string, unknown> = {};
      for (const chan of this.outputChannels) {
        if (chan in tuple.checkpoint.channel_values) {
          state[chan] = tuple.checkpoint.channel_values[chan];
        }
      }

      yield {
        config: tuple.config,
        state: state as Partial<S>,
        metadata: tuple.metadata as Record<string, unknown> | undefined,
        parentConfig: tuple.parentConfig,
      };
    }
  }
}

/**
 * A graph whose nodes communicate by reading and writing to shared state.
 *
 * Each node receives the full state and returns a partial update.
 * State keys can have custom reducers for merging updates from multiple nodes.
 *
 * @example
 * ```ts
 * const State = Annotation.Root({
 *   query: Annotation<string>(),
 *   results: Annotation<string[]>({
 *     reducer: (a, b) => [...a, ...b],
 *     default: () => [],
 *   }),
 * });
 *
 * const graph = new StateGraph(State)
 *   .addNode("search", searchFn)
 *   .addEdge(START, "search")
 *   .addEdge("search", END)
 *   .compile();
 * ```
 */
export class StateGraph<
  SD extends StateDefinition | AnnotationRoot<StateDefinition> = StateDefinition,
  S = SD extends AnnotationRoot<infer D>
    ? StateType<D>
    : SD extends StateDefinition
      ? StateType<SD>
      : unknown,
  U = SD extends AnnotationRoot<infer D>
    ? UpdateType<D>
    : SD extends StateDefinition
      ? UpdateType<SD>
      : unknown,
  N extends string = typeof START,
> extends Graph<N, S, U> {
  /** State channels. */
  channels: Record<string, BaseChannel> = {};

  /** Fan-in edges: [sources[], target]. */
  waitingEdges: Set<[string[], string]> = new Set();

  /** The state definition. */
  private _stateDefinition: StateDefinition;

  /** Node-specific input definitions. */
  private _nodeInputDefs: Record<string, StateDefinition> = {};

  constructor(state: SD) {
    super();

    // Extract state definition
    const def = this._resolveStateDefinition(state);
    this._stateDefinition = def;

    // Instantiate channels from the state definition
    for (const [key, factory] of Object.entries(def)) {
      this.channels[key] = factory();
    }
  }

  /**
   * Resolve a state argument into a StateDefinition (channel factory map).
   */
  private _resolveStateDefinition(
    state: SD
  ): StateDefinition {
    // AnnotationRoot
    if (state instanceof Object && "spec" in state) {
      return (state as AnnotationRoot<StateDefinition>).spec;
    }

    // Raw StateDefinition (Record<string, ChannelFactory>)
    if (typeof state === "object" && state !== null) {
      // Validate that all values are functions (channel factories)
      for (const [key, val] of Object.entries(state)) {
        if (typeof val !== "function") {
          throw new StateGraphInputError(
            `State key "${key}" must be a channel factory (created via Annotation()). ` +
              `Got ${typeof val}.`
          );
        }
      }
      return state as unknown as StateDefinition;
    }

    throw new StateGraphInputError();
  }

  /**
   * Add a node to the state graph.
   */
  override addNode<K extends string>(
    key: K,
    action: NodeAction<S, U>,
    options?: StateGraphAddNodeOptions
  ): StateGraph<SD, S, U, N | K> {
    // Validate key doesn't conflict with state channels
    if (key in this.channels) {
      throw new GraphValidationError(
        `"${key}" is already a state key, cannot also be a node name.`
      );
    }

    super.addNode(key, action, options);

    // Store per-node input definition if provided
    if (options?.input) {
      this._nodeInputDefs[key] = options.input;
      // Ensure channels for the input definition exist
      for (const [k, factory] of Object.entries(options.input)) {
        if (!(k in this.channels)) {
          this.channels[k] = factory();
        }
      }
    }

    return this as unknown as StateGraph<SD, S, U, N | K>;
  }

  /**
   * Add a static edge. Supports fan-in: addEdge(["a", "b"], "c").
   */
  override addEdge(
    startKey: typeof START | N | N[],
    endKey: N | typeof END
  ): this {
    if (typeof startKey === "string") {
      return super.addEdge(startKey as typeof START | N, endKey) as this;
    }

    // Fan-in edge: multiple sources → one target
    if (Array.isArray(startKey)) {
      for (const start of startKey) {
        if (start === END) {
          throw new GraphValidationError("END cannot be a start node.");
        }
        if (!(start in this.nodes)) {
          throw new GraphValidationError(
            `Need to add a node named "${start}" first.`
          );
        }
      }
      if (endKey === END) {
        throw new GraphValidationError(
          "Fan-in edges to END are not supported."
        );
      }
      if (!(endKey in this.nodes)) {
        throw new GraphValidationError(
          `Need to add a node named "${endKey}" first.`
        );
      }

      this.waitingEdges.add([startKey as string[], endKey as string]);
      return this;
    }

    return super.addEdge(startKey, endKey) as this;
  }

  /**
   * Compile the graph into an executable CompiledStateGraph.
   */
  compile(options?: CompileOptions): CompiledStateGraph<S, U> {
    // Validate
    this.validate();

    // Build compiled nodes
    const compiledNodes: Record<string, CompiledNode<S, U>> = {};
    const compiledChannels: Record<string, BaseChannel> = {
      ...this.channels,
      [START]: new EphemeralValue(),
    };

    // Determine output channels
    const outputKeys = Object.keys(this._stateDefinition);
    const stateKeys = Object.keys(this.channels);

    // ── Compile START node ──
    compiledNodes[START] = this._compileStartNode(outputKeys);

    // ── Compile user nodes ──
    for (const [key, nodeSpec] of Object.entries(this.nodes)) {
      const inputDef = this._nodeInputDefs[key] ?? this._stateDefinition;
      const inputKeys = Object.keys(inputDef);

      // Create branch channel for this node
      const branchChannel = `branch:to:${key}`;
      const defer = (nodeSpec as { metadata?: Record<string, unknown> }).metadata?.defer === true;
      compiledChannels[branchChannel] = defer
        ? new LastValueAfterFinish()
        : new EphemeralValue(false);

      // Build channel mapping for input
      const channelMapping: Record<string, string> = {};
      for (const k of inputKeys) {
        channelMapping[k] = k;
      }

      // Build state write entries (output from user function → state channels)
      const stateWriteEntry: WriteEntry = {
        channel: "__state__", // placeholder, handled by mapper
        value: PASSTHROUGH,
        mapper: (result: unknown) => {
          return this._getUpdates(result, stateKeys);
        },
      };

      compiledNodes[key] = {
        triggers: [branchChannel],
        channels: channelMapping,
        action: nodeSpec.action,
        writers: [stateWriteEntry],
        mapper: (input: Record<string, unknown>) => {
          return Object.fromEntries(
            Object.entries(input).filter(([k]) => k in channelMapping)
          );
        },
        defer,
        metadata: nodeSpec.metadata,
      };
    }

    // ── Compile edges ──
    // Static edges: source → write to branch:to:target
    for (const [start, end] of this.edges) {
      if (end === END) continue; // END edges are no-ops

      const node = compiledNodes[start];
      if (node) {
        node.writers.push({
          channel: `branch:to:${end}`,
          value: null, // trigger value (any non-undefined)
        });
      }
    }

    // Fan-in edges: [sources] → join channel → target
    for (const [starts, end] of this.waitingEdges) {
      const joinChannel = `join:${starts.join("+")}:${end}`;
      const defer = compiledNodes[end]?.defer ?? false;
      compiledChannels[joinChannel] = defer
        ? new NamedBarrierValueAfterFinish(new Set(starts))
        : new NamedBarrierValue(new Set(starts));

      // Add trigger to target
      compiledNodes[end].triggers.push(joinChannel);

      // Add write to each source
      for (const start of starts) {
        compiledNodes[start].writers.push({
          channel: joinChannel,
          value: start, // write the source name for barrier tracking
        });
      }
    }

    // ── Compile conditional edges (branches) ──
    for (const [source, branches] of Object.entries(this.branches)) {
      for (const [_name, branch] of Object.entries(branches)) {
        this._compileBranch(
          source,
          branch,
          compiledNodes,
          compiledChannels,
          stateKeys
        );
      }
    }

    // ── Compile Command-based control flow ──
    // Add control branch to every node (handles Command.goto)
    for (const name of [START, ...Object.keys(this.nodes)]) {
      const node = compiledNodes[name];
      if (!node) continue;

      node.writers.push({
        channel: "__control__",
        value: PASSTHROUGH,
        mapper: (result: unknown) => {
          return this._getControlWrites(result);
        },
      });
    }

    this.compiled = true;

    return new CompiledStateGraph<S, U>({
      nodes: compiledNodes,
      channels: compiledChannels,
      inputChannels: START,
      outputChannels: outputKeys,
      recursionLimit: options?.recursionLimit,
      name: options?.name,
      description: options?.description,
      checkpointer: options?.checkpointer,
      interruptBefore: options?.interruptBefore,
      interruptAfter: options?.interruptAfter,
    });
  }

  /**
   * Compile the START node that routes input to state channels.
   */
  private _compileStartNode(outputKeys: string[]): CompiledNode<S, U> {
    const stateWriteEntry: WriteEntry = {
      channel: "__state__",
      value: PASSTHROUGH,
      mapper: (result: unknown) => {
        if (result == null) return null;
        if (typeof result === "object" && !Array.isArray(result)) {
          return Object.entries(result as Record<string, unknown>).filter(
            ([k]) => outputKeys.includes(k)
          );
        }
        return [[ROOT, result]];
      },
    };

    return {
      triggers: [START],
      channels: [START],
      writers: [stateWriteEntry],
    };
  }

  /**
   * Extract [channel, value][] tuples from a node's return value.
   */
  private _getUpdates(
    result: unknown,
    outputKeys: string[]
  ): [string, unknown][] | null {
    if (result == null) return null;

    // Handle Command objects
    if (isCommand(result)) {
      if (result.graph === (result.constructor as typeof import("../constants.js").Command).PARENT) {
        return null;
      }
      return result
        ._updateAsTuples()
        .filter(([k]) => outputKeys.includes(k));
    }

    // Handle arrays containing Commands
    if (Array.isArray(result) && result.some(isCommand)) {
      const updates: [string, unknown][] = [];
      for (const item of result) {
        if (isCommand(item)) {
          updates.push(
            ...item._updateAsTuples().filter(([k]) => outputKeys.includes(k))
          );
        } else if (typeof item === "object" && item !== null) {
          updates.push(
            ...Object.entries(item).filter(([k]) => outputKeys.includes(k))
          );
        }
      }
      return updates;
    }

    // Handle plain objects
    if (typeof result === "object" && !Array.isArray(result)) {
      return Object.entries(result as Record<string, unknown>).filter(([k]) =>
        outputKeys.includes(k)
      );
    }

    return null;
  }

  /**
   * Extract control flow writes (Command.goto) from a result.
   */
  private _getControlWrites(result: unknown): [string, unknown][] | null {
    const writes: [string, unknown][] = [];

    const processCommand = (cmd: import("../constants.js").Command): void => {
      if (!cmd.goto) return;

      if (typeof cmd.goto === "string") {
        writes.push([`branch:to:${cmd.goto}`, START]);
      } else if (isSend(cmd.goto)) {
        writes.push([TASKS, cmd.goto]);
      } else if (Array.isArray(cmd.goto)) {
        for (const target of cmd.goto) {
          if (typeof target === "string") {
            writes.push([`branch:to:${target}`, START]);
          } else if (isSend(target)) {
            writes.push([TASKS, target]);
          }
        }
      }
    };

    if (isCommand(result)) {
      processCommand(result);
    } else if (Array.isArray(result)) {
      for (const item of result) {
        if (isCommand(item)) {
          processCommand(item);
        }
      }
    }

    return writes.length > 0 ? writes : null;
  }

  /**
   * Compile a conditional branch into write entries on the source node.
   */
  private _compileBranch(
    source: string,
    branch: BranchDef<S>,
    compiledNodes: Record<string, CompiledNode<S, U>>,
    compiledChannels: Record<string, BaseChannel>,
    _stateKeys: string[]
  ): void {
    const sourceNode = compiledNodes[source];
    if (!sourceNode) return;

    // Ensure branch target channels exist
    if (branch.pathMap) {
      for (const target of Object.values(branch.pathMap)) {
        if (target !== END) {
          const branchChan = `branch:to:${target}`;
          if (!compiledChannels[branchChan]) {
            compiledChannels[branchChan] = new EphemeralValue(false);
          }
        }
      }
    }

    // Add a writer that reads state, calls the path function, and writes to branch channels
    sourceNode.writers.push({
      channel: "__branch__",
      value: PASSTHROUGH,
      mapper: undefined, // handled specially in the engine
    });

    // Store branch definition for runtime resolution
    // We add a special action wrapper that handles the branch routing
    const originalAction = sourceNode.action;
    const pathFn = branch.path;
    const pathMap = branch.pathMap;

    sourceNode.action = async (state: S, config?: NodeConfig): Promise<U> => {
      // Execute the original node action (if any)
      let result: U | undefined;
      if (originalAction) {
        result = await originalAction(state, config);
      }

      // Merge the node's output into state so the path function sees updated values
      // This mimics LangGraph's "fresh read" behavior for conditional edges
      const mergedState =
        result && typeof result === "object" && typeof state === "object"
          ? { ...state, ...result }
          : state;

      // Execute the branch path function to determine routing
      const destinations = await pathFn(mergedState, config);
      const resolvedTargets: string[] = [];

      if (typeof destinations === "string") {
        resolvedTargets.push(destinations);
      } else if (Array.isArray(destinations)) {
        resolvedTargets.push(...destinations);
      }

      // Resolve through pathMap if provided
      const finalTargets = resolvedTargets.map((d) => {
        if (pathMap && !Array.isArray(pathMap) && d in pathMap) {
          return pathMap[d];
        }
        return d;
      });

      // Return a special marker that the engine will use for routing
      // We piggyback the routing info onto the result
      const routingResult = result ?? ({} as U);
      (routingResult as Record<string, unknown>).__branch_targets__ =
        finalTargets;
      return routingResult;
    };

    // Remove the placeholder branch writer, replace with actual routing writer
    sourceNode.writers = sourceNode.writers.filter(
      (w) => w.channel !== "__branch__"
    );
    sourceNode.writers.push({
      channel: "__branch_route__",
      value: PASSTHROUGH,
      mapper: (result: unknown): [string, unknown][] | null => {

        const targets = (result as Record<string, unknown>)?.__branch_targets__;
        if (!targets || !Array.isArray(targets)) return null;

        const writes: [string, unknown][] = [];
        for (const target of targets) {
          if (target === END) continue;
          writes.push([`branch:to:${target}`, source]);
        }

        // Clean up the marker
        if (result && typeof result === "object") {
          delete (result as Record<string, unknown>).__branch_targets__;
        }

        return writes.length > 0 ? writes : null;
      },
    });
  }
}
