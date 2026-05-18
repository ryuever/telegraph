/**
 * Lightweight state annotation system.
 * Replaces LangGraph's Annotation + @langchain/core schema system.
 *
 * Usage:
 *   const MyState = Annotation.Root({
 *     count: Annotation<number>({ default: () => 0 }),
 *     messages: Annotation<string[]>({
 *       reducer: (a, b) => [...a, ...b],
 *       default: () => [],
 *     }),
 *   });
 */

import { LastValue } from "../channels/last_value.js";
import { BaseChannel } from "../channels/base.js";

/**
 * A channel factory — a function that produces a BaseChannel when called.
 * Used in state definitions.
 */
export type ChannelFactory<V = unknown> = () => BaseChannel<V, unknown, unknown>;

/**
 * Reducer function type.
 * Takes the current value and an update value, returns the new value.
 */
export type Reducer<V, U = V> = (current: V, update: U) => V;

/**
 * Options for defining a single state key's channel behavior.
 */
export interface AnnotationOptions<V, U = V> {
  /** Reducer function to merge multiple values. */
  reducer?: Reducer<V, U>;
  /** Factory function for the default value. */
  default?: () => V;
}

/**
 * A channel that uses a custom reducer function to merge updates.
 */
class ReducerChannel<V, U = V> extends BaseChannel<V, U, V | undefined> {
  readonly name = "ReducerChannel";
  private value: [V] | [] = [];
  private reducerFn: Reducer<V, U>;
  private defaultFactory?: () => V;

  constructor(reducerFn: Reducer<V, U>, defaultFactory?: () => V) {
    super();
    this.reducerFn = reducerFn;
    this.defaultFactory = defaultFactory;
  }

  fromCheckpoint(checkpoint?: V): ReducerChannel<V, U> {
    const channel = new ReducerChannel<V, U>(
      this.reducerFn,
      this.defaultFactory
    );
    if (checkpoint !== undefined) {
      channel.value = [checkpoint];
    } else if (this.defaultFactory) {
      channel.value = [this.defaultFactory()];
    }
    return channel;
  }

  update(values: U[]): boolean {
    if (values.length === 0) return false;

    let current: V;
    if (this.value.length > 0) {
      current = this.value[0] as V;
    } else if (this.defaultFactory) {
      current = this.defaultFactory();
    } else {
      // For the first update with no default, use the first value as the initial
      current = values[0] as unknown as V;
      values = values.slice(1);
      if (values.length === 0) {
        this.value = [current];
        return true;
      }
    }

    for (const val of values) {
      current = this.reducerFn(current, val);
    }

    this.value = [current];
    return true;
  }

  get(): V {
    if (this.value.length === 0) {
      throw new Error("Channel is empty");
    }
    return this.value[0];
  }

  checkpoint(): V | undefined {
    return this.value.length > 0 ? this.value[0] : undefined;
  }

  isAvailable(): boolean {
    return this.value.length > 0;
  }
}

/**
 * State definition: a mapping of key names to channel factories.
 */
export type StateDefinition = Record<string, ChannelFactory>;

/**
 * Extracts the state type (values) from a state definition.
 */
export type StateType<SD extends StateDefinition> = {
  [K in keyof SD]: SD[K] extends () => BaseChannel<infer V, unknown, unknown>
    ? V
    : unknown;
};

/**
 * Extracts the update type (partial) from a state definition.
 */
export type UpdateType<SD extends StateDefinition> = Partial<StateType<SD>>;

/**
 * Root annotation that bundles a state definition.
 */
export class AnnotationRoot<SD extends StateDefinition> {
  readonly spec: SD;

  constructor(spec: SD) {
    this.spec = spec;
  }

  /** The full state type. */
  declare State: StateType<SD>;

  /** The update/partial state type. */
  declare Update: UpdateType<SD>;
}

/**
 * Create a channel factory for a single state key.
 *
 * @example
 * ```ts
 * // Simple value (no reducer, uses LastValue)
 * const name = Annotation<string>();
 *
 * // With reducer and default
 * const messages = Annotation<string[]>({
 *   reducer: (a, b) => [...a, ...b],
 *   default: () => [],
 * });
 * ```
 */
export function Annotation<V, U = V>(
  options?: AnnotationOptions<V, U>
): ChannelFactory<V> {
  if (options?.reducer) {
    const { reducer, default: defaultFactory } = options;
    return () =>
      new ReducerChannel(reducer, defaultFactory) as unknown as BaseChannel<
        V,
        unknown,
        unknown
      >;
  }

  // Default: use LastValue channel
  return () =>
    new LastValue<V>(options?.default) as unknown as BaseChannel<
      V,
      unknown,
      unknown
    >;
}

/**
 * Create a root state annotation from a state definition.
 *
 * @example
 * ```ts
 * const GraphState = Annotation.Root({
 *   query: Annotation<string>(),
 *   results: Annotation<string[]>({
 *     reducer: (a, b) => [...a, ...b],
 *     default: () => [],
 *   }),
 * });
 * ```
 */
Annotation.Root = function <SD extends StateDefinition>(
  spec: SD
): AnnotationRoot<SD> {
  return new AnnotationRoot(spec);
};
