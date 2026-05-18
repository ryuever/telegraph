import { BaseChannel } from "./base.js";
import { EmptyChannelError } from "../errors.js";

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}

/**
 * A barrier channel that waits for all named sources to write
 * before becoming available. Used for fan-in joins (multiple nodes → one node).
 *
 * Only becomes readable when all expected names have been seen.
 * Resets (consumes) after being read.
 */
export class NamedBarrierValue extends BaseChannel<void, string, undefined> {
  readonly name = "NamedBarrierValue";

  /** The set of names we're waiting for. */
  private names: Set<string>;
  /** The set of names we've seen so far. */
  private seen: Set<string>;

  constructor(names: Set<string>) {
    super();
    this.names = names;
    this.seen = new Set();
  }

  fromCheckpoint(_checkpoint?: undefined): NamedBarrierValue {
    const channel = new NamedBarrierValue(this.names);
    channel.seen = new Set();
    return channel;
  }

  update(values: string[]): boolean {
    const prevSize = this.seen.size;
    for (const name of values) {
      if (this.names.has(name)) {
        this.seen.add(name);
      }
    }
    return this.seen.size > prevSize;
  }

  get(): void {
    if (!setsEqual(this.names, this.seen)) {
      throw new EmptyChannelError();
    }
  }

  checkpoint(): undefined {
    return undefined;
  }

  isAvailable(): boolean {
    return setsEqual(this.names, this.seen);
  }

  override consume(): boolean {
    if (setsEqual(this.seen, this.names)) {
      this.seen = new Set();
      return true;
    }
    return false;
  }

  override equals(other: BaseChannel): boolean {
    return (
      other instanceof NamedBarrierValue &&
      setsEqual(this.names, other.names)
    );
  }
}

/**
 * Like NamedBarrierValue, but only becomes available after finish() is called.
 * Used for deferred fan-in joins.
 */
export class NamedBarrierValueAfterFinish extends NamedBarrierValue {
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

  override fromCheckpoint(_checkpoint?: undefined): NamedBarrierValueAfterFinish {
    const channel = new NamedBarrierValueAfterFinish(
      (this as unknown as { names: Set<string> }).names
    );
    return channel;
  }
}
