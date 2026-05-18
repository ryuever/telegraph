/**
 * BaseStore — Abstract key-value store for persistent data across threads.
 *
 * Provides a namespace-based key-value storage abstraction that can be
 * used for cross-thread memory, user preferences, and other persistent data.
 */

/**
 * A stored item with metadata.
 */
export interface Item {
  /** The stored value. */
  value: Record<string, unknown>;
  /** The item key within its namespace. */
  key: string;
  /** The namespace path. */
  namespace: string[];
  /** When the item was first created. */
  createdAt: Date;
  /** When the item was last updated. */
  updatedAt: Date;
}

/**
 * A search result item with optional relevance score.
 */
export interface SearchItem extends Item {
  /** Relevance score (for vector/semantic search). */
  score?: number;
}

/** Get operation: retrieve a single item by namespace and key. */
export interface GetOperation {
  namespace: string[];
  key: string;
}

/** Search operation: find items matching criteria. */
export interface SearchOperation {
  namespacePrefix: string[];
  filter?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  query?: string;
}

/** Put operation: store or delete an item. */
export interface PutOperation {
  namespace: string[];
  key: string;
  /** The value to store. null means delete. */
  value: Record<string, unknown> | null;
}

/** List namespaces operation. */
export interface ListNamespacesOperation {
  matchConditions?: MatchCondition[];
  maxDepth?: number;
  limit: number;
  offset: number;
}

/** Condition for matching namespaces. */
export interface MatchCondition {
  matchType: "prefix" | "suffix";
  path: string[];
}

/** Union type for all batch operations. */
export type Operation =
  | GetOperation
  | SearchOperation
  | PutOperation
  | ListNamespacesOperation;

/** Search options for the convenience method. */
export interface SearchOptions {
  filter?: Record<string, unknown>;
  limit?: number;
  offset?: number;
  query?: string;
}

/** Options for listing namespaces. */
export interface ListNamespacesOptions {
  prefix?: string[];
  suffix?: string[];
  maxDepth?: number;
  limit?: number;
  offset?: number;
}

/**
 * Abstract base class for key-value stores.
 *
 * Provides both batch and convenience methods for CRUD operations
 * on namespace-organized data.
 */
export abstract class BaseStore {
  /**
   * Execute a batch of operations atomically.
   */
  abstract batch(operations: Operation[]): Promise<unknown[]>;

  /**
   * Get a single item by namespace and key.
   */
  async get(namespace: string[], key: string): Promise<Item | null> {
    const results = await this.batch([{ namespace, key } as GetOperation]);
    return (results[0] as Item | null) ?? null;
  }

  /**
   * Search for items matching the given criteria.
   */
  async search(
    namespacePrefix: string[],
    options?: SearchOptions
  ): Promise<SearchItem[]> {
    const results = await this.batch([
      {
        namespacePrefix,
        ...options,
      } as SearchOperation,
    ]);
    return (results[0] as SearchItem[]) ?? [];
  }

  /**
   * Store an item.
   */
  async put(
    namespace: string[],
    key: string,
    value: Record<string, unknown>
  ): Promise<void> {
    await this.batch([{ namespace, key, value } as PutOperation]);
  }

  /**
   * Delete an item.
   */
  async delete(namespace: string[], key: string): Promise<void> {
    await this.batch([{ namespace, key, value: null } as PutOperation]);
  }

  /**
   * List namespaces matching the given options.
   */
  async listNamespaces(
    options?: ListNamespacesOptions
  ): Promise<string[][]> {
    const matchConditions: MatchCondition[] = [];
    if (options?.prefix) {
      matchConditions.push({ matchType: "prefix", path: options.prefix });
    }
    if (options?.suffix) {
      matchConditions.push({ matchType: "suffix", path: options.suffix });
    }
    const results = await this.batch([
      {
        matchConditions,
        maxDepth: options?.maxDepth,
        limit: options?.limit ?? 100,
        offset: options?.offset ?? 0,
      } as ListNamespacesOperation,
    ]);
    return (results[0] as string[][]) ?? [];
  }

  /** Optional lifecycle hook for startup. */
  start(): void | Promise<void> {
    // no-op by default
  }

  /** Optional lifecycle hook for shutdown. */
  stop(): void | Promise<void> {
    // no-op by default
  }
}
