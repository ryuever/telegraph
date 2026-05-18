import { BaseChannel } from "./base.js";
import { EmptyChannelError, InvalidUpdateError } from "../errors.js";

/**
 * Stores the last value written. Only one value can be written per superstep.
 * This is the default channel type for state keys without custom reducers.
 */
export class LastValue<V> extends BaseChannel<V, V, V | undefined> {
  readonly name = "LastValue";

  private value: [V] | [] = [];

  constructor(private defaultFactory?: () => V) {
    super();
  }

  fromCheckpoint(checkpoint?: V): LastValue<V> {
    const channel = new LastValue<V>(this.defaultFactory);
    if (checkpoint !== undefined) {
      channel.value = [checkpoint];
    } else if (this.defaultFactory) {
      channel.value = [this.defaultFactory()];
    }
    return channel;
  }

  update(values: V[]): boolean {
    if (values.length === 0) {
      return false;
    }
    if (values.length !== 1) {
      throw new InvalidUpdateError(
        `LastValue channel received ${values.length} values in one step. ` +
          "Expected exactly 1. Use a custom reducer if you need to merge multiple values."
      );
    }
    // eslint-disable-next-line prefer-destructuring
    this.value = [values[0]];
    return true;
  }

  get(): V {
    if (this.value.length === 0) {
      throw new EmptyChannelError();
    }
    return this.value[0];
  }

  checkpoint(): V | undefined {
    return this.value.length > 0 ? this.value[0] : undefined;
  }

  isAvailable(): boolean {
    return this.value.length > 0;
  }

  override equals(other: BaseChannel): boolean {
    return other instanceof LastValue;
  }
}

/**
 * Like LastValue, but only becomes available after `finish()` is called
 * (i.e., when no more nodes will be triggered in the current superstep).
 * Used for deferred nodes.
 */
export class LastValueAfterFinish<V> extends LastValue<V> {
  private finished = false;

  override isAvailable(): boolean {
    return this.finished && super.isAvailable();
  }

  override finish(): boolean {
    if (!this.finished && super.isAvailable()) {
      this.finished = true;
      return true;
    }
    return false;
  }

  override fromCheckpoint(checkpoint?: V): LastValueAfterFinish<V> {
    const channel = new LastValueAfterFinish<V>();
    if (checkpoint !== undefined) {
      (channel as unknown as { value: [V] | [] }).value = [checkpoint];
    }
    return channel;
  }
}
