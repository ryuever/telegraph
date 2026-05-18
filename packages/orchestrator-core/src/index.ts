/**
 * @orchestrator/core — Lightweight graph orchestration engine
 *
 * A standalone, zero-dependency implementation of the Pregel-based
 * graph execution model. Provides:
 *
 * - StateGraph: Builder API for defining stateful workflows
 * - Annotation: State schema definition with reducers
 * - Pregel Engine: Superstep-based parallel execution
 * - Checkpoint: State persistence, time-travel, and history
 *
 * @example
 * ```ts
 * import { StateGraph, Annotation, START, END, MemorySaver } from "@orchestrator/core";
 *
 * const State = Annotation.Root({
 *   query: Annotation<string>(),
 *   result: Annotation<string>(),
 * });
 *
 * const graph = new StateGraph(State)
 *   .addNode("process", async (state) => ({ result: `Processed: ${state.query}` }))
 *   .addEdge(START, "process")
 *   .addEdge("process", END)
 *   .compile({ checkpointer: new MemorySaver() });
 *
 * const output = await graph.invoke(
 *   { query: "hello" },
 *   { configurable: { thread_id: "my-thread" } }
 * );
 * ```
 */

// Constants
export { START, END, Send, Command, isSend, isCommand } from "./constants.js";

// Errors
export {
  OrchestratorError,
  EmptyChannelError,
  InvalidUpdateError,
  GraphValidationError,
  GraphRecursionError,
  StateGraphInputError,
} from "./errors.js";

// Interrupt — Human-in-the-Loop primitives
export {
  interrupt,
  GraphInterrupt,
  NodeInterrupt,
  isGraphInterrupt,
  type InterruptInfo,
  type InterruptContext,
} from "./interrupt.js";

// State / Annotation
export {
  Annotation,
  AnnotationRoot,
  type StateDefinition,
  type StateType,
  type UpdateType,
  type ChannelFactory,
  type Reducer,
} from "./state/index.js";

// Channels (for advanced use)
export {
  BaseChannel,
  LastValue,
  EphemeralValue,
  NamedBarrierValue,
  Topic,
} from "./channels/index.js";

// Graph builder & compiled graph
export {
  Graph,
  StateGraph,
  CompiledStateGraph,
  type InvokeOptions,
  type CompiledNode,
  type NodeAction,
  type NodeConfig,
  type CompileOptions,
} from "./graph/index.js";

// Engine (for advanced/custom use)
export { executePregelGraph } from "./engine/index.js";

// Swarm (multi-agent orchestration)
export {
  createSwarm,
  SwarmState,
  createHandoffAction,
  getHandoffDestinations,
  METADATA_KEY_HANDOFF_DESTINATION,
  type SwarmAgent,
  type CreateSwarmParams,
  type CreateHandoffParams,
} from "./swarm/index.js";

// Runnables — composable execution units
export {
  // Config
  type RunnableConfig,
  type RetryOptions,
  mergeConfig,
  // Base
  Runnable,
  coerceToRunnable,
  type RunnableLike,
  // Concrete implementations
  RunnableLambda,
  RunnableSequence,
  RunnableParallel,
  type RunnableParallelSpec,
  RunnableBranch,
  type BranchCondition,
  type BranchEntry,
  RunnablePassthrough,
  RunnableBinding,
  RunnableWithFallbacks,
  RunnableRetry,
  // Graph adapter
  RunnableGraph,
  toNodeAction,
} from "./runnables/index.js";

// ── Checkpoint — State persistence ──
export {
  // Core checkpoint types
  BaseCheckpointSaver,
  type Checkpoint,
  type ReadonlyCheckpoint,
  type CheckpointTuple,
  type CheckpointListOptions,
  type ChannelVersion,
  type ChannelVersions,
  deepCopy,
  emptyCheckpoint,
  copyCheckpoint,
  compareChannelVersions,
  maxChannelVersion,
  getCheckpointId,
  WRITES_IDX_MAP,
  // In-memory saver
  MemorySaver,
  // Types
  type PendingWrite,
  type PendingWriteValue,
  type CheckpointPendingWrite,
  type CheckpointMetadata,
  type CheckpointConfig,
  // UUID
  uuid6,
  uuid5,
  // Serialization
  type SerializerProtocol,
  JsonPlusSerializer,
  // Store
  BaseStore,
  InMemoryStore,
  MemoryStore,
  type Item as StoreItem,
  type SearchItem,
  type SearchOptions,
  type ListNamespacesOptions,
  // Cache
  BaseCache,
  InMemoryCache,
  type CacheNamespace,
  type CacheFullKey,
} from "./checkpoint/index.js";
