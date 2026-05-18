import { BaseChannel } from "./base.js";
import { EmptyChannelError, InvalidUpdateError } from "../errors.js";

/**
 * A channel that only lives for one superstep.
 * Value is automatically cleared when update([]) is called
 * (which happens for channels that received no writes in a superstep).
 *
 * Used for edge triggers (branch:to:X channels).
 */
export class EphemeralValue<V = unknown> extends BaseChannel<V, V, undefined> {
  readonly name = "EphemeralValue";

  private value: [V] | [] = [];
  private guard: boolean;

  /**
   * @param guard - If true, throws on multiple writes per step.
   */
  constructor(guard = true) {
    super();
    this.guard = guard;
  }

  fromCheckpoint(_checkpoint?: undefined): EphemeralValue<V> {
    // Ephemeral channels always start empty (never restored from checkpoint)
    return new EphemeralValue<V>(this.guard);
  }

  update(values: V[]): boolean {
    if (values.length === 0) {
      // No writes this step — clear the channel
      const wasAvailable = this.value.length > 0;
      this.value = [];
      return wasAvailable;
    }

    if (this.guard && values.length > 1) {
      throw new InvalidUpdateError(
        `EphemeralValue received ${values.length} values. Expected at most 1.`
      );
    }

    this.value = [values[values.length - 1]];
    return true;
  }

  get(): V {
    if (this.value.length === 0) {
      throw new EmptyChannelError();
    }
    return this.value[0];
  }

  checkpoint(): undefined {
    return undefined;
  }

  isAvailable(): boolean {
    return this.value.length > 0;
  }
}
