/**
 * Base channel interface for state management primitives.
 *
 * Channels are the fundamental communication mechanism in the Pregel execution
 * model. Each channel holds a value that can be updated, read, and consumed
 * during graph execution.
 */

export abstract class BaseChannel<
  Value = unknown,
  Update = unknown,
  Checkpoint = unknown,
> {
  abstract readonly name: string;

  /**
   * Reset the channel from a checkpoint value. If no checkpoint is provided,
   * reset to the default/empty state.
   */
  abstract fromCheckpoint(checkpoint?: Checkpoint): BaseChannel<Value, Update, Checkpoint>;

  /**
   * Apply a batch of updates to the channel.
   * @returns true if the channel value changed.
   */
  abstract update(values: Update[]): boolean;

  /**
   * Read the current value of the channel.
   * @throws EmptyChannelError if no value is available.
   */
  abstract get(): Value;

  /**
   * Serialize the current state for checkpointing.
   */
  abstract checkpoint(): Checkpoint;

  /**
   * Whether the channel currently has a readable value.
   */
  abstract isAvailable(): boolean;

  /**
   * Consume the current value (used by barrier channels).
   * @returns true if the channel state changed.
   */
  consume(): boolean {
    return false;
  }

  /**
   * Notify the channel that the current superstep is the last one
   * (no more nodes will be triggered). Used by "AfterFinish" variants.
   * @returns true if the channel state changed.
   */
  finish(): boolean {
    return false;
  }

  /**
   * Check structural equality with another channel.
   */
  equals(other: BaseChannel): boolean {
    return this.constructor === other.constructor;
  }
}
