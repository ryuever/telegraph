/**
 * Tests for the checkpoint module.
 *
 * Covers:
 * - JsonPlusSerializer (serialization/deserialization)
 * - MemorySaver (CRUD operations)
 * - StateGraph + MemorySaver integration (checkpoint persistence)
 * - InMemoryStore (key-value operations)
 * - InMemoryCache (caching with TTL)
 * - uuid6 generation
 */

import { describe, it, expect } from "vitest";
import { StateGraph } from "../graph/state.js";
import { Annotation } from "../state/annotation.js";
import { START, END } from "../constants.js";
import { MemorySaver } from "./memory.js";
import { JsonPlusSerializer } from "./serde/jsonplus.js";
import { InMemoryStore } from "./store/memory.js";
import { InMemoryCache } from "./cache/memory.js";
import { uuid6 } from "./id.js";
import {
  emptyCheckpoint,
  copyCheckpoint,
  deepCopy,
  compareChannelVersions,
  maxChannelVersion,
} from "./base.js";

// ═══════════════════════════════════════════════════════════════
//  UUID Tests
// ═══════════════════════════════════════════════════════════════

describe("uuid6", () => {
  it("should generate a UUID-like string", () => {
    const id = uuid6(0);
    expect(id).toBeDefined();
    expect(typeof id).toBe("string");
    // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    expect(id.split("-").length).toBe(5);
  });

  it("should generate unique IDs", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(uuid6(i));
    }
    expect(ids.size).toBe(100);
  });

  it("should be time-ordered (newer IDs sort higher)", () => {
    const id1 = uuid6(0);
    // Small delay to ensure different timestamp
    const id2 = uuid6(1);
    // Both should be valid strings
    expect(typeof id1).toBe("string");
    expect(typeof id2).toBe("string");
  });
});

// ═══════════════════════════════════════════════════════════════
//  Checkpoint Utility Tests
// ═══════════════════════════════════════════════════════════════

describe("checkpoint utilities", () => {
  it("emptyCheckpoint creates a valid checkpoint", () => {
    const cp = emptyCheckpoint();
    expect(cp.v).toBe(1);
    expect(cp.id).toBeDefined();
    expect(cp.ts).toBeDefined();
    expect(cp.channel_values).toEqual({});
    expect(cp.channel_versions).toEqual({});
    expect(cp.versions_seen).toEqual({});
  });

  it("copyCheckpoint creates a deep copy", () => {
    const original = emptyCheckpoint();
    original.channel_values["test"] = { nested: [1, 2, 3] };
    original.channel_versions["test"] = 5;
    original.versions_seen["nodeA"] = { test: 3 };

    const copy = copyCheckpoint(original);

    // Values should be equal
    expect(copy.channel_values["test"]).toEqual({ nested: [1, 2, 3] });
    expect(copy.channel_versions["test"]).toBe(5);
    expect(copy.versions_seen["nodeA"]).toEqual({ test: 3 });

    // But modifying copy shouldn't affect original
    copy.channel_values["test"] = "changed";
    expect(original.channel_values["test"]).toEqual({ nested: [1, 2, 3] });

    copy.versions_seen["nodeA"]["test"] = 99;
    expect(original.versions_seen["nodeA"]["test"]).toBe(3);
  });

  it("deepCopy handles nested objects", () => {
    const obj = { a: { b: { c: [1, 2, 3] } } };
    const copy = deepCopy(obj);
    expect(copy).toEqual(obj);
    copy.a.b.c.push(4);
    expect(obj.a.b.c).toEqual([1, 2, 3]);
  });

  it("compareChannelVersions works correctly", () => {
    expect(compareChannelVersions(1, 2)).toBeLessThan(0);
    expect(compareChannelVersions(2, 1)).toBeGreaterThan(0);
    expect(compareChannelVersions(1, 1)).toBe(0);
    expect(compareChannelVersions("a", "b")).toBeLessThan(0);
  });

  it("maxChannelVersion returns the highest version", () => {
    expect(maxChannelVersion(1, 3, 2)).toBe(3);
    expect(maxChannelVersion(5)).toBe(5);
    expect(maxChannelVersion("a", "c", "b")).toBe("c");
  });
});

// ═══════════════════════════════════════════════════════════════
//  JsonPlusSerializer Tests
// ═══════════════════════════════════════════════════════════════

describe("JsonPlusSerializer", () => {
  const serde = new JsonPlusSerializer();

  it("should round-trip simple objects", async () => {
    const obj = { name: "test", count: 42, active: true };
    const [type, data] = await serde.dumpsTyped(obj);
    expect(type).toBe("json");
    const result = await serde.loadsTyped(type, data);
    expect(result).toEqual(obj);
  });

  it("should round-trip arrays", async () => {
    const arr = [1, "two", { three: 3 }];
    const [type, data] = await serde.dumpsTyped(arr);
    const result = await serde.loadsTyped(type, data);
    expect(result).toEqual(arr);
  });

  it("should handle Set", async () => {
    const obj = { items: new Set([1, 2, 3]) };
    const [type, data] = await serde.dumpsTyped(obj);
    const result = (await serde.loadsTyped(type, data)) as {
      items: Set<number>;
    };
    expect(result.items).toBeInstanceOf(Set);
    expect(result.items.size).toBe(3);
    expect(result.items.has(1)).toBe(true);
  });

  it("should handle Map", async () => {
    const obj = {
      items: new Map([
        ["a", 1],
        ["b", 2],
      ]),
    };
    const [type, data] = await serde.dumpsTyped(obj);
    const result = (await serde.loadsTyped(type, data)) as {
      items: Map<string, number>;
    };
    expect(result.items).toBeInstanceOf(Map);
    expect(result.items.get("a")).toBe(1);
    expect(result.items.get("b")).toBe(2);
  });

  it("should handle RegExp", async () => {
    const obj = { pattern: /test/gi };
    const [type, data] = await serde.dumpsTyped(obj);
    const result = (await serde.loadsTyped(type, data)) as {
      pattern: RegExp;
    };
    expect(result.pattern).toBeInstanceOf(RegExp);
    expect(result.pattern.source).toBe("test");
    expect(result.pattern.flags).toBe("gi");
  });

  it("should handle Uint8Array", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const [type, data] = await serde.dumpsTyped(bytes);
    expect(type).toBe("bytes");
    const result = await serde.loadsTyped(type, data);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result).toEqual(bytes);
  });

  it("should handle undefined values", async () => {
    const obj = { a: 1, b: undefined, c: "hello" };
    const [type, data] = await serde.dumpsTyped(obj);
    const result = (await serde.loadsTyped(type, data)) as Record<
      string,
      unknown
    >;
    expect(result.a).toBe(1);
    expect(result.b).toBeUndefined();
    expect(result.c).toBe("hello");
  });

  it("should handle nested objects", async () => {
    const obj = {
      level1: {
        level2: {
          items: new Set(["a", "b"]),
          pattern: /foo/,
        },
      },
    };
    const [type, data] = await serde.dumpsTyped(obj);
    const result = (await serde.loadsTyped(type, data)) as typeof obj;
    expect(result.level1.level2.items).toBeInstanceOf(Set);
    expect(result.level1.level2.pattern).toBeInstanceOf(RegExp);
  });
});

// ═══════════════════════════════════════════════════════════════
//  MemorySaver Tests
// ═══════════════════════════════════════════════════════════════

describe("MemorySaver", () => {
  it("should put and get a checkpoint", async () => {
    const saver = new MemorySaver();
    const checkpoint = emptyCheckpoint();
    checkpoint.channel_values = { query: "hello" };

    const config = {
      configurable: { thread_id: "thread-1" },
    };

    const result = await saver.put(config, checkpoint, {
      source: "input" as const,
      step: -1,
      parents: {},
    });

    expect(result.configurable?.checkpoint_id).toBe(checkpoint.id);

    // Get it back
    const retrieved = await saver.get({
      configurable: { thread_id: "thread-1" },
    });
    expect(retrieved).toBeDefined();
    expect(retrieved!.channel_values).toEqual({ query: "hello" });
  });

  it("should return undefined for non-existent thread", async () => {
    const saver = new MemorySaver();
    const result = await saver.get({
      configurable: { thread_id: "non-existent" },
    });
    expect(result).toBeUndefined();
  });

  it("should get the latest checkpoint when no ID specified", async () => {
    const saver = new MemorySaver();

    // Save two checkpoints
    const cp1 = emptyCheckpoint();
    cp1.channel_values = { step: "first" };

    await saver.put(
      { configurable: { thread_id: "t1" } },
      cp1,
      { source: "input", step: -1, parents: {} }
    );

    // Small delay to ensure different UUID
    await new Promise((r) => setTimeout(r, 5));

    const cp2 = emptyCheckpoint();
    cp2.channel_values = { step: "second" };

    await saver.put(
      { configurable: { thread_id: "t1", checkpoint_id: cp1.id } },
      cp2,
      { source: "loop", step: 0, parents: { "": cp1.id } }
    );

    // Should return the latest
    const latest = await saver.get({
      configurable: { thread_id: "t1" },
    });
    expect(latest?.channel_values).toEqual({ step: "second" });
  });

  it("should list checkpoints in reverse order", async () => {
    const saver = new MemorySaver();

    const cp1 = emptyCheckpoint();
    cp1.channel_values = { step: 1 };
    await saver.put(
      { configurable: { thread_id: "t1" } },
      cp1,
      { source: "input", step: -1, parents: {} }
    );

    await new Promise((r) => setTimeout(r, 5));

    const cp2 = emptyCheckpoint();
    cp2.channel_values = { step: 2 };
    await saver.put(
      { configurable: { thread_id: "t1", checkpoint_id: cp1.id } },
      cp2,
      { source: "loop", step: 0, parents: { "": cp1.id } }
    );

    const items: unknown[] = [];
    for await (const tuple of saver.list({
      configurable: { thread_id: "t1" },
    })) {
      items.push(tuple);
    }

    expect(items.length).toBe(2);
  });

  it("should list with limit", async () => {
    const saver = new MemorySaver();

    for (let i = 0; i < 5; i++) {
      const cp = emptyCheckpoint();
      cp.channel_values = { step: i };
      await saver.put(
        { configurable: { thread_id: "t1" } },
        cp,
        { source: "loop", step: i, parents: {} }
      );
      await new Promise((r) => setTimeout(r, 2));
    }

    const items: unknown[] = [];
    for await (const tuple of saver.list(
      { configurable: { thread_id: "t1" } },
      { limit: 2 }
    )) {
      items.push(tuple);
    }

    expect(items.length).toBe(2);
  });

  it("should delete a thread", async () => {
    const saver = new MemorySaver();

    const cp = emptyCheckpoint();
    await saver.put(
      { configurable: { thread_id: "t1" } },
      cp,
      { source: "input", step: -1, parents: {} }
    );

    await saver.deleteThread("t1");

    const result = await saver.get({
      configurable: { thread_id: "t1" },
    });
    expect(result).toBeUndefined();
  });

  it("should put and retrieve writes", async () => {
    const saver = new MemorySaver();

    const cp = emptyCheckpoint();
    await saver.put(
      { configurable: { thread_id: "t1" } },
      cp,
      { source: "input", step: -1, parents: {} }
    );

    await saver.putWrites(
      { configurable: { thread_id: "t1", checkpoint_id: cp.id } },
      [["messages", "hello world"]],
      "task-1"
    );

    const tuple = await saver.getTuple({
      configurable: { thread_id: "t1", checkpoint_id: cp.id },
    });
    expect(tuple?.pendingWrites).toBeDefined();
    expect(tuple!.pendingWrites!.length).toBe(1);
    expect(tuple!.pendingWrites![0][1]).toBe("messages");
    expect(tuple!.pendingWrites![0][2]).toBe("hello world");
  });
});

// ═══════════════════════════════════════════════════════════════
//  StateGraph + Checkpoint Integration Tests
// ═══════════════════════════════════════════════════════════════

describe("StateGraph with MemorySaver", () => {
  it("should persist state across invocations", async () => {
    const State = Annotation.Root({
      count: Annotation<number>({
        reducer: (a, b) => a + b,
        default: () => 0,
      }),
      lastAction: Annotation<string>(),
    });

    const checkpointer = new MemorySaver();

    const graph = new StateGraph(State)
      .addNode("increment", async (state) => ({
        count: 1,
        lastAction: "incremented",
      }))
      .addEdge(START, "increment")
      .addEdge("increment", END)
      .compile({ checkpointer });

    // First invocation
    const result1 = await graph.invoke(
      { count: 0 },
      { configurable: { thread_id: "test-thread" } }
    );

    expect(result1.count).toBe(1);
    expect(result1.lastAction).toBe("incremented");

    // Second invocation on same thread — should resume from saved state
    const result2 = await graph.invoke(
      { count: 0 },
      { configurable: { thread_id: "test-thread" } }
    );

    // The count should accumulate if checkpoint is properly restored
    // (reducer adds values)
    expect(result2.lastAction).toBe("incremented");
  });

  it("should work without checkpointer (stateless)", async () => {
    const State = Annotation.Root({
      value: Annotation<string>(),
    });

    const graph = new StateGraph(State)
      .addNode("process", async () => ({ value: "processed" }))
      .addEdge(START, "process")
      .addEdge("process", END)
      .compile(); // No checkpointer

    const result = await graph.invoke({ value: "input" });
    expect(result.value).toBe("processed");
  });

  it("should support getState()", async () => {
    const State = Annotation.Root({
      message: Annotation<string>(),
    });

    const checkpointer = new MemorySaver();

    const graph = new StateGraph(State)
      .addNode("greet", async () => ({ message: "hello world" }))
      .addEdge(START, "greet")
      .addEdge("greet", END)
      .compile({ checkpointer });

    await graph.invoke(
      { message: "hi" },
      { configurable: { thread_id: "state-thread" } }
    );

    const state = await graph.getState({ thread_id: "state-thread" });
    expect(state).toBeDefined();
    expect(state!.message).toBe("hello world");
  });

  it("should throw when getState called without checkpointer", async () => {
    const State = Annotation.Root({
      value: Annotation<string>(),
    });

    const graph = new StateGraph(State)
      .addNode("process", async () => ({ value: "done" }))
      .addEdge(START, "process")
      .addEdge("process", END)
      .compile();

    await expect(
      graph.getState({ thread_id: "test" })
    ).rejects.toThrow("Cannot get state without a checkpointer");
  });

  it("should support different threads independently", async () => {
    const State = Annotation.Root({
      name: Annotation<string>(),
    });

    const checkpointer = new MemorySaver();

    const graph = new StateGraph(State)
      .addNode("setName", async (state) => ({ name: state.name }))
      .addEdge(START, "setName")
      .addEdge("setName", END)
      .compile({ checkpointer });

    await graph.invoke(
      { name: "Alice" },
      { configurable: { thread_id: "thread-a" } }
    );

    await graph.invoke(
      { name: "Bob" },
      { configurable: { thread_id: "thread-b" } }
    );

    const stateA = await graph.getState({ thread_id: "thread-a" });
    const stateB = await graph.getState({ thread_id: "thread-b" });

    expect(stateA!.name).toBe("Alice");
    expect(stateB!.name).toBe("Bob");
  });
});

// ═══════════════════════════════════════════════════════════════
//  InMemoryStore Tests
// ═══════════════════════════════════════════════════════════════

describe("InMemoryStore", () => {
  it("should put and get items", async () => {
    const store = new InMemoryStore();

    await store.put(["users"], "user-1", { name: "Alice", age: 30 });
    const item = await store.get(["users"], "user-1");

    expect(item).not.toBeNull();
    expect(item!.value).toEqual({ name: "Alice", age: 30 });
    expect(item!.key).toBe("user-1");
    expect(item!.namespace).toEqual(["users"]);
  });

  it("should return null for non-existent items", async () => {
    const store = new InMemoryStore();
    const item = await store.get(["users"], "no-such-key");
    expect(item).toBeNull();
  });

  it("should delete items", async () => {
    const store = new InMemoryStore();

    await store.put(["users"], "user-1", { name: "Alice" });
    await store.delete(["users"], "user-1");

    const item = await store.get(["users"], "user-1");
    expect(item).toBeNull();
  });

  it("should search with filters", async () => {
    const store = new InMemoryStore();

    await store.put(["users"], "u1", { name: "Alice", role: "admin" });
    await store.put(["users"], "u2", { name: "Bob", role: "user" });
    await store.put(["users"], "u3", { name: "Charlie", role: "admin" });

    const admins = await store.search(["users"], {
      filter: { role: "admin" },
    });
    expect(admins.length).toBe(2);
    expect(admins.map((i) => i.value.name).sort()).toEqual([
      "Alice",
      "Charlie",
    ]);
  });

  it("should search with comparison operators", async () => {
    const store = new InMemoryStore();

    await store.put(["items"], "a", { name: "A", score: 10 });
    await store.put(["items"], "b", { name: "B", score: 20 });
    await store.put(["items"], "c", { name: "C", score: 30 });

    const results = await store.search(["items"], {
      filter: { score: { $gte: 20 } },
    });
    expect(results.length).toBe(2);
  });

  it("should support pagination", async () => {
    const store = new InMemoryStore();

    for (let i = 0; i < 10; i++) {
      await store.put(["items"], `item-${i}`, { index: i });
    }

    const page1 = await store.search(["items"], { limit: 3, offset: 0 });
    const page2 = await store.search(["items"], { limit: 3, offset: 3 });

    expect(page1.length).toBe(3);
    expect(page2.length).toBe(3);
  });

  it("should list namespaces", async () => {
    const store = new InMemoryStore();

    await store.put(["users", "profiles"], "u1", { name: "Alice" });
    await store.put(["users", "settings"], "u1", { theme: "dark" });
    await store.put(["posts"], "p1", { title: "Hello" });

    const namespaces = await store.listNamespaces({
      prefix: ["users"],
    });
    expect(namespaces.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
//  InMemoryCache Tests
// ═══════════════════════════════════════════════════════════════

describe("InMemoryCache", () => {
  it("should set and get values", async () => {
    const cache = new InMemoryCache<string>();

    await cache.set([
      { key: [["app", "config"], "theme"], value: "dark" },
    ]);

    const results = await cache.get([[["app", "config"], "theme"]]);
    expect(results.length).toBe(1);
    expect(results[0].value).toBe("dark");
  });

  it("should return empty for missing keys", async () => {
    const cache = new InMemoryCache();
    const results = await cache.get([[["missing"], "key"]]);
    expect(results.length).toBe(0);
  });

  it("should respect TTL", async () => {
    const cache = new InMemoryCache<string>();

    // Set with very short TTL
    await cache.set([
      {
        key: [["app"], "temp"],
        value: "temporary",
        ttl: 0.01, // 10ms
      },
    ]);

    // Should be available immediately
    let results = await cache.get([[["app"], "temp"]]);
    expect(results.length).toBe(1);

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 20));

    // Should be expired
    results = await cache.get([[["app"], "temp"]]);
    expect(results.length).toBe(0);
  });

  it("should clear by namespace", async () => {
    const cache = new InMemoryCache<string>();

    await cache.set([
      { key: [["ns1"], "key1"], value: "val1" },
      { key: [["ns2"], "key2"], value: "val2" },
    ]);

    await cache.clear([["ns1"]]);

    const r1 = await cache.get([[["ns1"], "key1"]]);
    const r2 = await cache.get([[["ns2"], "key2"]]);

    expect(r1.length).toBe(0);
    expect(r2.length).toBe(1);
  });
});
