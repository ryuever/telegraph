/**
 * Constants and sentinel values for the orchestration engine.
 */

/** Sentinel node name representing the graph's entry point. */
export const START = "__start__";

/** Sentinel node name representing the graph's exit point. */
export const END = "__end__";

/** Internal channel name for collecting dynamic Send() tasks. */
export const TASKS = "__pregel_tasks";

/** Tag applied to internal/hidden nodes and writers. */
export const TAG_HIDDEN = "langraph:hidden";

/** Symbol marking a passthrough value in ChannelWrite. */
export const PASSTHROUGH = Symbol("PASSTHROUGH");

/** Symbol marking a value that should skip writing. */
export const SKIP_WRITE = Symbol("SKIP_WRITE");

/**
 * Represents a targeted message to a specific node with custom input.
 * Used for dynamic fan-out patterns (map-reduce).
 */
export class Send {
  readonly node: string;
  readonly args: unknown;

  constructor(node: string, args: unknown) {
    this.node = node;
    this.args = args;
  }
}

/** Type guard for Send instances. */
export function isSend(value: unknown): value is Send {
  return value instanceof Send;
}

/**
 * Command object for controlling graph execution flow from within nodes.
 * Allows nodes to specify goto targets, update state, and resume from interrupts.
 */
export class Command<
  Update = Record<string, unknown>,
  Goto extends string = string,
> {
  /** State updates to apply. */
  readonly update?: Update;

  /** Node(s) to navigate to next. */
  readonly goto?: Goto | Goto[] | Send | Send[];

  /** Whether this command targets the parent graph. */
  readonly graph?: typeof Command.PARENT;

  /** Resume value for interrupt continuation. */
  readonly resume?: unknown;

  static readonly PARENT = Symbol("PARENT");

  constructor(options: {
    update?: Update;
    goto?: Goto | Goto[] | Send | Send[];
    graph?: typeof Command.PARENT;
    resume?: unknown;
  }) {
    this.update = options.update;
    this.goto = options.goto;
    this.graph = options.graph;
    this.resume = options.resume;
  }

  /**
   * Convert the update into [channel, value] tuples for channel writes.
   */
  _updateAsTuples(): [string, unknown][] {
    if (this.update == null) return [];

    if (typeof this.update === "object" && !Array.isArray(this.update)) {
      return Object.entries(this.update as Record<string, unknown>);
    }

    return [["__root__", this.update]];
  }
}

/** Type guard for Command instances. */
export function isCommand(value: unknown): value is Command {
  return value instanceof Command;
}
