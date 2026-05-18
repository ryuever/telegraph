import { BaseChannel } from "./base.js";
import { EmptyChannelError } from "../errors.js";

/**
 * A channel that accumulates values as an array.
 * Used for the TASKS channel to collect Send() objects.
 */
export class Topic<V = unknown> extends BaseChannel<V[], V, V[]> {
  readonly name = "Topic";

  private values: V[] = [];
  private accumulate: boolean;

  constructor(accumulate = false) {
    super();
    this.accumulate = accumulate;
  }

  fromCheckpoint(checkpoint?: V[]): Topic<V> {
    const channel = new Topic<V>(this.accumulate);
    if (checkpoint) {
      channel.values = [...checkpoint];
    }
    return channel;
  }

  update(values: V[]): boolean {
    if (!this.accumulate) {
      this.values = [];
    }
    const prevLength = this.values.length;
    for (const v of values) {
      if (Array.isArray(v)) {
        this.values.push(...(v as V[]));
      } else {
        this.values.push(v);
      }
    }
    return this.values.length > prevLength || (!this.accumulate && prevLength > 0);
  }

  get(): V[] {
    if (this.values.length === 0) {
      throw new EmptyChannelError();
    }
    return this.values;
  }

  checkpoint(): V[] {
    return [...this.values];
  }

  isAvailable(): boolean {
    return this.values.length > 0;
  }

  override consume(): boolean {
    if (this.values.length > 0) {
      this.values = [];
      return true;
    }
    return false;
  }
}
