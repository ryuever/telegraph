/**
 * BaseCache — Abstract cache for temporary data with optional TTL.
 */

import type { SerializerProtocol } from "../serde/base.js";
import { JsonPlusSerializer } from "../serde/jsonplus.js";

/** A cache namespace (array of strings). */
export type CacheNamespace = string[];

/** A full cache key: [namespace, key]. */
export type CacheFullKey = [namespace: CacheNamespace, key: string];

/**
 * Abstract base class for cache implementations.
 */
export abstract class BaseCache<V = unknown> {
  serde: SerializerProtocol = new JsonPlusSerializer();

  constructor(serde?: SerializerProtocol) {
    this.serde = serde || this.serde;
  }

  /** Get cached values for the given keys. */
  abstract get(
    keys: CacheFullKey[]
  ): Promise<{ key: CacheFullKey; value: V }[]>;

  /** Set cached values with optional TTL (in seconds). */
  abstract set(
    pairs: { key: CacheFullKey; value: V; ttl?: number }[]
  ): Promise<void>;

  /** Clear all entries in the given namespaces. */
  abstract clear(namespaces: CacheNamespace[]): Promise<void>;
}
