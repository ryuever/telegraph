/**
 * InMemoryCache — In-memory cache with TTL support.
 */

import { BaseCache, type CacheFullKey, type CacheNamespace } from "./base.js";

interface CacheEntry {
  enc: string;
  val: Uint8Array | string;
  exp: number | null;
}

/**
 * In-memory cache implementation with TTL expiry.
 */
export class InMemoryCache<V = unknown> extends BaseCache<V> {
  private cache: Record<string, Record<string, CacheEntry>> = {};

  async get(
    keys: CacheFullKey[]
  ): Promise<{ key: CacheFullKey; value: V }[]> {
    const results: { key: CacheFullKey; value: V }[] = [];
    const now = Date.now();

    for (const fullKey of keys) {
      const [namespace, key] = fullKey;
      const nsKey = namespace.join(".");
      const entry = this.cache[nsKey]?.[key];

      if (!entry) continue;

      // Check TTL
      if (entry.exp !== null && entry.exp < now) {
        delete this.cache[nsKey][key];
        continue;
      }

      const value = (await this.serde.loadsTyped(
        entry.enc,
        entry.val
      )) as V;
      results.push({ key: fullKey, value });
    }

    return results;
  }

  async set(
    pairs: { key: CacheFullKey; value: V; ttl?: number }[]
  ): Promise<void> {
    const now = Date.now();

    for (const { key: fullKey, value, ttl } of pairs) {
      const [namespace, key] = fullKey;
      const nsKey = namespace.join(".");

      if (!this.cache[nsKey]) {
        this.cache[nsKey] = {};
      }

      const [enc, val] = await this.serde.dumpsTyped(value);
      this.cache[nsKey][key] = {
        enc,
        val,
        exp: ttl != null ? now + ttl * 1000 : null,
      };
    }
  }

  async clear(namespaces: CacheNamespace[]): Promise<void> {
    for (const namespace of namespaces) {
      const nsKey = namespace.join(".");
      delete this.cache[nsKey];
    }
  }
}
