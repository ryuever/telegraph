/**
 * InMemoryStore — In-memory key-value store implementation.
 *
 * Stores all data in memory. Suitable for development and testing.
 * Supports namespace-based organization, filtering, and search.
 */

import {
  BaseStore,
  type Item,
  type SearchItem,
  type Operation,
  type GetOperation,
  type SearchOperation,
  type PutOperation,
  type ListNamespacesOperation,
  type MatchCondition,
} from "./base.js";

/**
 * In-memory implementation of BaseStore.
 * All data is stored in a nested Map structure.
 */
export class InMemoryStore extends BaseStore {
  private data: Map<string, Map<string, Item>> = new Map();

  async batch(operations: Operation[]): Promise<unknown[]> {
    const results: unknown[] = [];

    for (const op of operations) {
      if ("key" in op && "namespace" in op && !("namespacePrefix" in op)) {
        if ("value" in op) {
          // PutOperation
          results.push(await this._handlePut(op as PutOperation));
        } else {
          // GetOperation
          results.push(await this._handleGet(op as GetOperation));
        }
      } else if ("namespacePrefix" in op) {
        // SearchOperation
        results.push(await this._handleSearch(op as SearchOperation));
      } else if ("matchConditions" in op || "maxDepth" in op) {
        // ListNamespacesOperation
        results.push(
          await this._handleListNamespaces(op as ListNamespacesOperation)
        );
      } else {
        results.push(null);
      }
    }

    return results;
  }

  private async _handleGet(op: GetOperation): Promise<Item | null> {
    const nsKey = op.namespace.join(".");
    const nsMap = this.data.get(nsKey);
    if (!nsMap) return null;
    return nsMap.get(op.key) ?? null;
  }

  private async _handleSearch(op: SearchOperation): Promise<SearchItem[]> {
    const prefix = op.namespacePrefix.join(".");
    const results: SearchItem[] = [];
    const limit = op.limit ?? 10;
    const offset = op.offset ?? 0;

    for (const [nsKey, nsMap] of this.data) {
      if (!nsKey.startsWith(prefix) && prefix !== "") continue;

      for (const item of nsMap.values()) {
        // Apply filter if provided
        if (op.filter && !_matchesFilter(item.value, op.filter)) {
          continue;
        }

        results.push({ ...item });
      }
    }

    // Sort by updatedAt descending
    results.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    return results.slice(offset, offset + limit);
  }

  private async _handlePut(op: PutOperation): Promise<void> {
    const nsKey = op.namespace.join(".");

    if (op.value === null) {
      // Delete
      const nsMap = this.data.get(nsKey);
      if (nsMap) {
        nsMap.delete(op.key);
        if (nsMap.size === 0) {
          this.data.delete(nsKey);
        }
      }
      return;
    }

    if (!this.data.has(nsKey)) {
      this.data.set(nsKey, new Map());
    }

    const nsMap = this.data.get(nsKey)!;
    const existing = nsMap.get(op.key);
    const now = new Date();

    nsMap.set(op.key, {
      value: op.value,
      key: op.key,
      namespace: op.namespace,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  private async _handleListNamespaces(
    op: ListNamespacesOperation
  ): Promise<string[][]> {
    const allNamespaces: string[][] = [];

    for (const nsKey of this.data.keys()) {
      const parts = nsKey.split(".");

      if (op.matchConditions) {
        const matches = op.matchConditions.every((cond) =>
          _matchNamespace(parts, cond)
        );
        if (!matches) continue;
      }

      if (op.maxDepth !== undefined) {
        allNamespaces.push(parts.slice(0, op.maxDepth));
      } else {
        allNamespaces.push(parts);
      }
    }

    // Deduplicate
    const unique = _deduplicateNamespaces(allNamespaces);

    return unique.slice(op.offset, op.offset + op.limit);
  }
}

/**
 * Check if an item's value matches a filter.
 */
function _matchesFilter(
  value: Record<string, unknown>,
  filter: Record<string, unknown>
): boolean {
  for (const [key, filterValue] of Object.entries(filter)) {
    const itemValue = value[key];

    // Support basic comparison operators
    if (
      filterValue !== null &&
      typeof filterValue === "object" &&
      !Array.isArray(filterValue)
    ) {
      const ops = filterValue as Record<string, unknown>;
      if ("$eq" in ops && itemValue !== ops.$eq) return false;
      if ("$ne" in ops && itemValue === ops.$ne) return false;
      if (
        "$gt" in ops &&
        (typeof itemValue !== "number" ||
          itemValue <= (ops.$gt as number))
      )
        return false;
      if (
        "$gte" in ops &&
        (typeof itemValue !== "number" ||
          itemValue < (ops.$gte as number))
      )
        return false;
      if (
        "$lt" in ops &&
        (typeof itemValue !== "number" ||
          itemValue >= (ops.$lt as number))
      )
        return false;
      if (
        "$lte" in ops &&
        (typeof itemValue !== "number" ||
          itemValue > (ops.$lte as number))
      )
        return false;
      if (
        "$in" in ops &&
        (!Array.isArray(ops.$in) ||
          !ops.$in.includes(itemValue))
      )
        return false;
      if (
        "$nin" in ops &&
        Array.isArray(ops.$nin) &&
        ops.$nin.includes(itemValue)
      )
        return false;
    } else {
      // Direct equality
      if (itemValue !== filterValue) return false;
    }
  }
  return true;
}

/**
 * Check if a namespace matches a condition.
 */
function _matchNamespace(
  parts: string[],
  condition: MatchCondition
): boolean {
  if (condition.matchType === "prefix") {
    return condition.path.every((p, i) => parts[i] === p);
  }
  if (condition.matchType === "suffix") {
    const offset = parts.length - condition.path.length;
    if (offset < 0) return false;
    return condition.path.every((p, i) => parts[offset + i] === p);
  }
  return true;
}

/**
 * Deduplicate namespace arrays.
 */
function _deduplicateNamespaces(namespaces: string[][]): string[][] {
  const seen = new Set<string>();
  const result: string[][] = [];
  for (const ns of namespaces) {
    const key = ns.join(".");
    if (!seen.has(key)) {
      seen.add(key);
      result.push(ns);
    }
  }
  return result;
}

/** Alias for backward compatibility. */
export const MemoryStore = InMemoryStore;
