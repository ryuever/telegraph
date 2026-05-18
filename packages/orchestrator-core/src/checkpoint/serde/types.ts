/**
 * Special channel constants and protocol interfaces for checkpoint serialization.
 */

/** Internal channel name for collecting dynamic Send() tasks. */
export const TASKS = "__pregel_tasks";

/** Error channel marker. */
export const ERROR = "__error__";

/** Scheduled channel marker. */
export const SCHEDULED = "__scheduled__";

/** Interrupt channel marker. */
export const INTERRUPT = "__interrupt__";

/** Resume channel marker. */
export const RESUME = "__resume__";

/**
 * Mirrors BaseChannel interface for serialization purposes.
 */
export interface ChannelProtocol<
  ValueType = unknown,
  UpdateType = unknown,
  CheckpointType = unknown,
> {
  ValueType: ValueType;
  UpdateType: UpdateType;

  /** The name of the channel. */
  lc_graph_name: string;

  /** Restore from checkpoint. */
  fromCheckpoint(checkpoint?: CheckpointType): this;

  /** Apply updates. */
  update(values: UpdateType[]): void;

  /** Get current value. */
  get(): ValueType;

  /** Get checkpoint value. */
  checkpoint(): CheckpointType | undefined;
}

/**
 * Send protocol interface.
 */
export interface SendProtocol {
  node: string;
  args: unknown;
}
