/**
 * Core types for the checkpoint system.
 */

/** Pending write value type. */
export type PendingWriteValue = unknown;

/** A pending write: [channel, value]. */
export type PendingWrite<Channel = string> = [Channel, PendingWriteValue];

/** A checkpoint pending write: [taskId, channel, value]. */
export type CheckpointPendingWrite<TaskId = string> = [
  TaskId,
  ...PendingWrite<string>,
];

/**
 * Metadata about a checkpoint, including its source and lineage.
 */
export type CheckpointMetadata<ExtraProperties extends object = object> = {
  /**
   * The source of the checkpoint.
   * - "input": Created from initial input.
   * - "loop": Created from inside the pregel loop.
   * - "update": Created from a manual state update.
   * - "fork": Created as a copy of another checkpoint.
   */
  source: "input" | "loop" | "update" | "fork";

  /**
   * The step number of the checkpoint.
   * -1 for the first "input" checkpoint.
   * 0 for the first "loop" checkpoint.
   */
  step: number;

  /**
   * The IDs of parent checkpoints.
   * Mapping from checkpoint namespace to checkpoint ID.
   */
  parents: Record<string, string>;
} & ExtraProperties;

/**
 * Configurable properties for checkpoint operations.
 * Standalone replacement for @langchain/core's RunnableConfig.
 */
export interface CheckpointConfig {
  /** Configuration parameters for checkpoint storage. */
  configurable?: {
    /** Thread identifier for grouping checkpoints. */
    thread_id?: string;
    /** Checkpoint namespace for isolation. */
    checkpoint_ns?: string;
    /** Specific checkpoint identifier. */
    checkpoint_id?: string;
    /** Legacy alias for checkpoint_id. */
    thread_ts?: string;
    /** Additional configurable properties. */
    [key: string]: unknown;
  };
}
