/**
 * Checkpoint module — State persistence for the orchestration engine.
 *
 * Provides checkpoint saving/loading, serialization, key-value storage,
 * and caching. All implementations are zero-dependency.
 */

// Core checkpoint types and base class
export {
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
} from "./base.js";

// In-memory checkpoint saver
export { MemorySaver } from "./memory.js";

// Types
export type {
  PendingWrite,
  PendingWriteValue,
  CheckpointPendingWrite,
  CheckpointMetadata,
  CheckpointConfig,
} from "./types.js";

// UUID utilities
export { uuid6, uuid5 } from "./id.js";

// Serialization
export type { SerializerProtocol } from "./serde/base.js";
export { JsonPlusSerializer } from "./serde/jsonplus.js";
export {
  TASKS as CHECKPOINT_TASKS,
  ERROR as CHECKPOINT_ERROR,
  SCHEDULED as CHECKPOINT_SCHEDULED,
  INTERRUPT as CHECKPOINT_INTERRUPT,
  RESUME as CHECKPOINT_RESUME,
  type ChannelProtocol,
  type SendProtocol,
} from "./serde/types.js";

// Store
export {
  BaseStore,
  InMemoryStore,
  MemoryStore,
  type Item,
  type SearchItem,
  type Operation as StoreOperation,
  type GetOperation,
  type SearchOperation,
  type PutOperation,
  type ListNamespacesOperation,
  type MatchCondition,
  type SearchOptions,
  type ListNamespacesOptions,
} from "./store/index.js";

// Cache
export {
  BaseCache,
  InMemoryCache,
  type CacheNamespace,
  type CacheFullKey,
} from "./cache/index.js";
