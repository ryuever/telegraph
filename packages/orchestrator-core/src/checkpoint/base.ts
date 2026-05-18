/**
 * Core checkpoint interfaces and the BaseCheckpointSaver abstract class.
 *
 * Provides state persistence for the Pregel execution engine,
 * enabling time-travel debugging, resumption, and history tracking.
 */

import type { SerializerProtocol } from "./serde/base.js";
import { uuid6 } from "./id.js";
import type {
  PendingWrite,
  CheckpointPendingWrite,
  CheckpointMetadata,
  CheckpointConfig,
} from "./types.js";
import { ERROR, INTERRUPT, RESUME, SCHEDULED } from "./serde/types.js";
import { JsonPlusSerializer } from "./serde/jsonplus.js";

/** Channel version can be a number or string. */
export type ChannelVersion = number | string;

/** Map of channel names to their versions. */
export type ChannelVersions = Record<string, ChannelVersion>;

/**
 * A checkpoint represents a complete snapshot of the graph's state
 * at a given point in execution.
 */
export interface Checkpoint<
  N extends string = string,
  C extends string = string,
> {
  /** Checkpoint format version. Currently 1. */
  v: number;
  /** Unique checkpoint ID (time-ordered UUID). */
  id: string;
  /** ISO timestamp of when the checkpoint was created. */
  ts: string;
  /** Channel values at this point. */
  channel_values: Record<C, unknown>;
  /** Channel version numbers. */
  channel_versions: Record<C, ChannelVersion>;
  /** Per-node record of which channel versions each node has seen. */
  versions_seen: Record<N, Record<C, ChannelVersion>>;
}

/** Readonly version of Checkpoint for type safety. */
export interface ReadonlyCheckpoint extends Readonly<Checkpoint> {
  readonly channel_values: Readonly<Record<string, unknown>>;
  readonly channel_versions: Readonly<Record<string, ChannelVersion>>;
  readonly versions_seen: Readonly<
    Record<string, Readonly<Record<string, ChannelVersion>>>
  >;
}

/**
 * A complete checkpoint tuple with associated metadata and configuration.
 */
export interface CheckpointTuple {
  /** Configuration that identifies this checkpoint. */
  config: CheckpointConfig;
  /** The checkpoint data. */
  checkpoint: Checkpoint;
  /** Optional metadata about the checkpoint. */
  metadata?: CheckpointMetadata;
  /** Configuration for the parent checkpoint. */
  parentConfig?: CheckpointConfig;
  /** Pending writes associated with this checkpoint. */
  pendingWrites?: CheckpointPendingWrite[];
}

/** Options for listing checkpoints. */
export interface CheckpointListOptions {
  /** Maximum number of checkpoints to return. */
  limit?: number;
  /** Return only checkpoints before this config. */
  before?: CheckpointConfig;
  /** Filter checkpoints by metadata. */
  filter?: Record<string, unknown>;
}

/**
 * Deep copy a value.
 */
export function deepCopy<T>(obj: T): T {
  if (typeof obj !== "object" || obj === null) {
    return obj;
  }

  const newObj = Array.isArray(obj)
    ? ([] as unknown[])
    : ({} as Record<PropertyKey, unknown>);

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      (newObj as Record<PropertyKey, unknown>)[key] = deepCopy(
        (obj as Record<string, unknown>)[key]
      );
    }
  }

  return newObj as T;
}

/**
 * Create an empty checkpoint with initial values.
 */
export function emptyCheckpoint(): Checkpoint {
  return {
    v: 1,
    id: uuid6(-2),
    ts: new Date().toISOString(),
    channel_values: {},
    channel_versions: {},
    versions_seen: {},
  };
}

/**
 * Create a mutable copy of a readonly checkpoint.
 */
export function copyCheckpoint(checkpoint: ReadonlyCheckpoint): Checkpoint {
  return {
    v: checkpoint.v,
    id: checkpoint.id,
    ts: checkpoint.ts,
    channel_values: { ...checkpoint.channel_values },
    channel_versions: { ...checkpoint.channel_versions },
    versions_seen: deepCopy(checkpoint.versions_seen),
  };
}

/**
 * Compare two channel versions.
 * @returns negative if a < b, 0 if equal, positive if a > b
 */
export function compareChannelVersions(
  a: ChannelVersion,
  b: ChannelVersion
): number {
  if (typeof a === "number" && typeof b === "number") {
    return Math.sign(a - b);
  }
  return String(a).localeCompare(String(b));
}

/**
 * Return the maximum of the given channel versions.
 */
export function maxChannelVersion(
  ...versions: ChannelVersion[]
): ChannelVersion {
  return versions.reduce((max, version, idx) => {
    if (idx === 0) return version;
    return compareChannelVersions(max, version) >= 0 ? max : version;
  });
}

/**
 * Mapping from special write types to their storage indices.
 * Negative indices prevent conflicts with regular write indices.
 */
export const WRITES_IDX_MAP: Record<string, number> = {
  [ERROR]: -1,
  [SCHEDULED]: -2,
  [INTERRUPT]: -3,
  [RESUME]: -4,
};

/**
 * Extract the checkpoint ID from a config.
 */
export function getCheckpointId(config: CheckpointConfig): string {
  return (
    config.configurable?.checkpoint_id ||
    config.configurable?.thread_ts ||
    ""
  );
}

/**
 * Abstract base class for checkpoint storage backends.
 *
 * Implementations must provide methods for getting, putting, listing,
 * and deleting checkpoints. The MemorySaver is the built-in in-memory
 * implementation.
 *
 * @typeParam V - Version type (number or string)
 */
export abstract class BaseCheckpointSaver<
  V extends string | number = number,
> {
  /** Serializer for checkpoint data. */
  serde: SerializerProtocol = new JsonPlusSerializer();

  constructor(serde?: SerializerProtocol) {
    this.serde = serde || this.serde;
  }

  /**
   * Get the checkpoint data for a given config.
   */
  async get(config: CheckpointConfig): Promise<Checkpoint | undefined> {
    const value = await this.getTuple(config);
    return value ? value.checkpoint : undefined;
  }

  /**
   * Get the full checkpoint tuple (checkpoint + metadata + pending writes).
   */
  abstract getTuple(
    config: CheckpointConfig
  ): Promise<CheckpointTuple | undefined>;

  /**
   * List checkpoints matching the given config and options.
   */
  abstract list(
    config: CheckpointConfig,
    options?: CheckpointListOptions
  ): AsyncGenerator<CheckpointTuple>;

  /**
   * Save a checkpoint with metadata.
   * @returns Updated config with the new checkpoint ID.
   */
  abstract put(
    config: CheckpointConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    newVersions: ChannelVersions
  ): Promise<CheckpointConfig>;

  /**
   * Store intermediate writes linked to a checkpoint.
   */
  abstract putWrites(
    config: CheckpointConfig,
    writes: PendingWrite[],
    taskId: string
  ): Promise<void>;

  /**
   * Delete all checkpoints and writes for a thread.
   */
  abstract deleteThread(threadId: string): Promise<void>;

  /**
   * Generate the next version number for a channel.
   * Override for custom version schemes.
   */
  getNextVersion(current: V | undefined): V {
    if (typeof current === "string") {
      throw new Error("Please override this method to use string versions.");
    }
    return (
      current !== undefined && typeof current === "number" ? current + 1 : 1
    ) as V;
  }
}
