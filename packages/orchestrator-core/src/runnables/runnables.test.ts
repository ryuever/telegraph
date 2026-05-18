/**
 * Comprehensive tests for the Runnables module.
 */

import { describe, it, expect } from "vitest";
import {
  RunnableLambda,
  RunnableSequence,
  RunnableParallel,
  RunnableBranch,
  RunnablePassthrough,
  RunnableBinding,
  RunnableWithFallbacks,
  RunnableRetry,
  RunnableGraph,
  toNodeAction,
  coerceToRunnable,
  mergeConfig,
} from "./index.js";
import { StateGraph, Annotation, START, END } from "../index.js";

// ═══════════════════════════════════════════════════════════════
//  RunnableLambda
// ═══════════════════════════════════════════════════════════════
describe("RunnableLambda", () => {
  it("wraps a sync function", async () => {
    const r = new RunnableLambda((x: number) => x * 2);
    expect(await r.invoke(5)).toBe(10);
  });

  it("wraps an async function", async () => {
    const r = new RunnableLambda(async (x: string) => x.toUpperCase());
    expect(await r.invoke("hello")).toBe("HELLO");
  });

  it("static from() factory works", async () => {
    const r = RunnableLambda.from((x: number) => x + 1, "increment");
    expect(r.name).toBe("increment");
    expect(await r.invoke(9)).toBe(10);
  });

  it("passes config to the function", async () => {
    const r = new RunnableLambda((x: number, config) => {
      return x + (config?.configurable?.bonus as number ?? 0);
    });
    expect(await r.invoke(5, { configurable: { bonus: 10 } })).toBe(15);
  });

  it("respects AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort();
    const r = new RunnableLambda((x: number) => x);
    await expect(r.invoke(1, { signal: controller.signal })).rejects.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
//  RunnableSequence
// ═══════════════════════════════════════════════════════════════
describe("RunnableSequence", () => {
  it("chains two runnables", async () => {
    const a = RunnableLambda.from((x: number) => x + 1);
    const b = RunnableLambda.from((x: number) => x * 10);
    const seq = new RunnableSequence<number, number>([a, b]);
    expect(await seq.invoke(5)).toBe(60); // (5+1)*10
  });

  it("chains three runnables", async () => {
    const seq = RunnableSequence.from<number, string>([
      (x: unknown) => (x as number) + 1,
      (x: unknown) => (x as number) * 2,
      (x: unknown) => `result: ${x}`,
    ]);
    expect(await seq.invoke(3)).toBe("result: 8"); // (3+1)*2 = 8
  });

  it("rejects fewer than 2 steps", () => {
    expect(() => new RunnableSequence([RunnableLambda.from((x: unknown) => x)])).toThrow(
      "at least 2 steps"
    );
  });

  it("pipe() creates a sequence", async () => {
    const pipeline = RunnableLambda.from((x: number) => x + 1)
      .pipe((x) => x * 2)
      .pipe((x) => `v=${x}`);
    expect(await pipeline.invoke(4)).toBe("v=10"); // (4+1)*2 = 10
  });

  it("pipe() flattens nested sequences", async () => {
    const a = RunnableLambda.from((x: number) => x + 1);
    const b = RunnableLambda.from((x: number) => x * 2);
    const c = RunnableLambda.from((x: number) => x - 3);

    const seq1 = a.pipe(b); // [a, b]
    const seq2 = seq1.pipe(c); // should be [a, b, c], not [[a,b], c]
    expect(seq2.steps.length).toBe(3);
    expect(await seq2.invoke(5)).toBe(9); // (5+1)*2 - 3 = 9
  });

  it("stream yields from the last step", async () => {
    const seq = RunnableLambda.from((x: number) => x + 1)
      .pipe((x) => x * 10);

    const chunks: number[] = [];
    for await (const chunk of seq.stream(5)) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([60]);
  });

  it("first and last accessors work", () => {
    const a = RunnableLambda.from((x: number) => x, "A");
    const b = RunnableLambda.from((x: number) => x, "B");
    const c = RunnableLambda.from((x: number) => x, "C");
    const seq = new RunnableSequence<number, number>([a, b, c]);
    expect(seq.first.name).toBe("A");
    expect(seq.last.name).toBe("C");
  });
});

// ═══════════════════════════════════════════════════════════════
//  RunnableParallel
// ═══════════════════════════════════════════════════════════════
describe("RunnableParallel", () => {
  it("executes branches in parallel and merges output", async () => {
    const r = new RunnableParallel<string>({
      upper: RunnableLambda.from((s: string) => s.toUpperCase()),
      len: RunnableLambda.from((s: string) => s.length),
      reversed: (s: string) => s.split("").reverse().join(""),
    });

    const result = await r.invoke("hello");
    expect(result).toEqual({
      upper: "HELLO",
      len: 5,
      reversed: "olleh",
    });
  });

  it("static from() factory works", async () => {
    const r = RunnableParallel.from<number>({
      doubled: (x: number) => x * 2,
      halved: (x: number) => x / 2,
    });
    expect(await r.invoke(10)).toEqual({ doubled: 20, halved: 5 });
  });
});

// ═══════════════════════════════════════════════════════════════
//  RunnableBranch
// ═══════════════════════════════════════════════════════════════
describe("RunnableBranch", () => {
  it("routes to the first matching condition", async () => {
    const r = new RunnableBranch<number, string>(
      [
        [(x) => x > 0, (x) => `positive: ${x}`],
        [(x) => x < 0, (x) => `negative: ${x}`],
      ],
      () => "zero"
    );

    expect(await r.invoke(5)).toBe("positive: 5");
    expect(await r.invoke(-3)).toBe("negative: -3");
    expect(await r.invoke(0)).toBe("zero");
  });

  it("supports async conditions", async () => {
    const r = RunnableBranch.from<string, string>(
      [
        [async (s) => s.length > 5, (s) => `long: ${s}`],
      ],
      (s) => `short: ${s}`
    );

    expect(await r.invoke("hello world")).toBe("long: hello world");
    expect(await r.invoke("hi")).toBe("short: hi");
  });
});

// ═══════════════════════════════════════════════════════════════
//  RunnablePassthrough
// ═══════════════════════════════════════════════════════════════
describe("RunnablePassthrough", () => {
  it("passes input through unchanged", async () => {
    const r = new RunnablePassthrough();
    const input = { x: 1, y: "hello" };
    expect(await r.invoke(input)).toEqual(input);
  });

  it("assign() merges computed fields", async () => {
    const r = RunnablePassthrough.assign({
      doubled: (input: { x: number }) => input.x * 2,
      greeting: (input: { x: number }) => `x is ${input.x}`,
    });

    const result = await r.invoke({ x: 5 });
    expect(result).toEqual({ x: 5, doubled: 10, greeting: "x is 5" });
  });

  it("assign() preserves existing fields", async () => {
    const r = RunnablePassthrough.assign({
      computed: (input: { a: number; b: number }) => input.a + input.b,
    });

    const result = await r.invoke({ a: 3, b: 7 });
    expect(result).toEqual({ a: 3, b: 7, computed: 10 });
  });
});

// ═══════════════════════════════════════════════════════════════
//  RunnableBinding
// ═══════════════════════════════════════════════════════════════
describe("RunnableBinding", () => {
  it("merges bound config with invocation config", async () => {
    const inner = new RunnableLambda((x: number, config) => {
      const tags = config?.tags ?? [];
      return `${x}:${tags.join(",")}`;
    });

    const bound = inner.bind({ tags: ["prod"] });
    expect(await bound.invoke(42)).toBe("42:prod");
    expect(await bound.invoke(42, { tags: ["extra"] })).toBe("42:prod,extra");
  });

  it("batch delegates correctly", async () => {
    const inner = RunnableLambda.from((x: number) => x * 2);
    const bound = new RunnableBinding(inner, {});
    const results = await bound.batch([1, 2, 3]);
    expect(results).toEqual([2, 4, 6]);
  });
});

// ═══════════════════════════════════════════════════════════════
//  RunnableWithFallbacks
// ═══════════════════════════════════════════════════════════════
describe("RunnableWithFallbacks", () => {
  it("returns primary result if it succeeds", async () => {
    const primary = RunnableLambda.from((x: number) => x * 2);
    const fallback = RunnableLambda.from(() => -1);
    const r = primary.withFallbacks([fallback]);
    expect(await r.invoke(5)).toBe(10);
  });

  it("falls back on primary failure", async () => {
    const primary = RunnableLambda.from((): number => {
      throw new Error("fail");
    });
    const fallback = RunnableLambda.from(() => 42);
    const r = primary.withFallbacks([fallback]);
    expect(await r.invoke(0)).toBe(42);
  });

  it("tries multiple fallbacks in order", async () => {
    const primary = RunnableLambda.from((): string => { throw new Error("p"); });
    const fb1 = RunnableLambda.from((): string => { throw new Error("fb1"); });
    const fb2 = RunnableLambda.from(() => "fb2 ok");
    const r = primary.withFallbacks([fb1, fb2]);
    expect(await r.invoke(0)).toBe("fb2 ok");
  });

  it("throws last error if all fail", async () => {
    const primary = RunnableLambda.from((): string => { throw new Error("p"); });
    const fb1 = RunnableLambda.from((): string => { throw new Error("fb1 err"); });
    const r = primary.withFallbacks([fb1]);
    await expect(r.invoke(0)).rejects.toThrow("fb1 err");
  });
});

// ═══════════════════════════════════════════════════════════════
//  RunnableRetry
// ═══════════════════════════════════════════════════════════════
describe("RunnableRetry", () => {
  it("retries on failure and eventually succeeds", async () => {
    let attempt = 0;
    const flaky = RunnableLambda.from((x: number) => {
      attempt++;
      if (attempt < 3) throw new Error(`attempt ${attempt}`);
      return x * 10;
    });

    const r = flaky.withRetry({ maxAttempts: 5, delayMs: 10, backoffFactor: 1 });
    expect(await r.invoke(5)).toBe(50);
    expect(attempt).toBe(3);
  });

  it("throws after exhausting max attempts", async () => {
    const alwaysFails = RunnableLambda.from((): number => {
      throw new Error("always fails");
    });
    const r = alwaysFails.withRetry({ maxAttempts: 2, delayMs: 10 });
    await expect(r.invoke(1)).rejects.toThrow("always fails");
  });

  it("respects retryOn predicate", async () => {
    let attempt = 0;
    const flaky = RunnableLambda.from((): number => {
      attempt++;
      throw new Error("non-retryable");
    });

    const r = flaky.withRetry({
      maxAttempts: 5,
      delayMs: 10,
      retryOn: (e) => e.message !== "non-retryable",
    });

    await expect(r.invoke(1)).rejects.toThrow("non-retryable");
    expect(attempt).toBe(1); // no retries
  });
});

// ═══════════════════════════════════════════════════════════════
//  batch()
// ═══════════════════════════════════════════════════════════════
describe("batch()", () => {
  it("processes all inputs", async () => {
    const r = RunnableLambda.from((x: number) => x * 2);
    const results = await r.batch([1, 2, 3, 4, 5]);
    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it("respects maxConcurrency", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const r = RunnableLambda.from(async (x: number) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 50));
      concurrent--;
      return x;
    });

    await r.batch([1, 2, 3, 4, 5, 6], { maxConcurrency: 2 });
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════════════════
//  stream()
// ═══════════════════════════════════════════════════════════════
describe("stream()", () => {
  it("default implementation yields single chunk", async () => {
    const r = RunnableLambda.from((x: number) => x * 3);
    const chunks: number[] = [];
    for await (const chunk of r.stream(7)) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([21]);
  });
});

// ═══════════════════════════════════════════════════════════════
//  coerceToRunnable
// ═══════════════════════════════════════════════════════════════
describe("coerceToRunnable", () => {
  it("returns existing Runnable as-is", () => {
    const r = RunnableLambda.from((x: number) => x);
    expect(coerceToRunnable(r)).toBe(r);
  });

  it("wraps a function into RunnableLambda", async () => {
    const r = coerceToRunnable((x: number) => x + 1);
    expect(r).toBeInstanceOf(RunnableLambda);
    expect(await r.invoke(5)).toBe(6);
  });

  it("throws on invalid input", () => {
    expect(() => coerceToRunnable(42 as never)).toThrow("Cannot coerce");
  });
});

// ═══════════════════════════════════════════════════════════════
//  mergeConfig
// ═══════════════════════════════════════════════════════════════
describe("mergeConfig", () => {
  it("merges tags and metadata", () => {
    const result = mergeConfig(
      { tags: ["a"], metadata: { x: 1 } },
      { tags: ["b"], metadata: { y: 2 } }
    );
    expect(result.tags).toEqual(["a", "b"]);
    expect(result.metadata).toEqual({ x: 1, y: 2 });
  });

  it("b overrides signal and maxConcurrency", () => {
    const signalA = new AbortController().signal;
    const signalB = new AbortController().signal;
    const result = mergeConfig(
      { signal: signalA, maxConcurrency: 5 },
      { signal: signalB, maxConcurrency: 10 }
    );
    expect(result.signal).toBe(signalB);
    expect(result.maxConcurrency).toBe(10);
  });

  it("handles undefined inputs", () => {
    expect(mergeConfig(undefined, undefined)).toEqual({});
    expect(mergeConfig({ tags: ["a"] }, undefined)).toEqual({ tags: ["a"] });
    expect(mergeConfig(undefined, { tags: ["b"] })).toEqual({ tags: ["b"] });
  });
});

// ═══════════════════════════════════════════════════════════════
//  Complex composition patterns
// ═══════════════════════════════════════════════════════════════
describe("composition patterns", () => {
  it("sequence + parallel + branch", async () => {
    // Input → classify → { sentiment, length } → format
    const classify = RunnableLambda.from((text: string) => ({
      text,
      isPositive: text.includes("good") || text.includes("great"),
    }));

    const analyze = new RunnableParallel<{ text: string; isPositive: boolean }>({
      sentiment: (input) => input.isPositive ? "positive" : "negative",
      wordCount: (input) => input.text.split(" ").length,
    });

    const format = RunnableLambda.from(
      (data: { sentiment: string; wordCount: number }) =>
        `${data.sentiment} (${data.wordCount} words)`
    );

    const pipeline = classify.pipe(analyze).pipe(format);
    expect(await pipeline.invoke("this is a good day")).toBe("positive (5 words)");
    expect(await pipeline.invoke("this is bad")).toBe("negative (3 words)");
  });

  it("passthrough.assign in a pipeline", async () => {
    const pipeline = RunnablePassthrough.assign({
      doubled: (input: { value: number }) => input.value * 2,
    }).pipe(
      (input) => `value=${input.value}, doubled=${input.doubled}`
    );

    expect(await pipeline.invoke({ value: 7 })).toBe("value=7, doubled=14");
  });

  it("retry + fallbacks combined", async () => {
    let callCount = 0;
    const unstable = RunnableLambda.from((): string => {
      callCount++;
      throw new Error("unstable");
    });
    const safe = RunnableLambda.from(() => "fallback");

    const r = unstable.withRetry({ maxAttempts: 2, delayMs: 10 }).withFallbacks([safe]);
    const result = await r.invoke(0);
    expect(result).toBe("fallback");
    expect(callCount).toBe(2); // retried twice before falling back
  });
});

// ═══════════════════════════════════════════════════════════════
//  Graph adapter: RunnableGraph + toNodeAction
// ═══════════════════════════════════════════════════════════════
describe("graph adapter", () => {
  it("RunnableGraph wraps a compiled graph", async () => {
    const State = Annotation.Root({
      value: Annotation<string>(),
      processed: Annotation<string>(),
    });

    const compiled = new StateGraph(State)
      .addNode("process", async (s: { value: string }) => ({
        processed: s.value.toUpperCase(),
      }))
      .addEdge(START, "process")
      .addEdge("process", END)
      .compile();

    const runnable = new RunnableGraph(compiled);
    const result = await runnable.invoke({ value: "hello" });
    expect(result.processed).toBe("HELLO");
  });

  it("RunnableGraph can be piped with other runnables", async () => {
    const State = Annotation.Root({
      input: Annotation<string>(),
      output: Annotation<string>(),
    });

    const compiled = new StateGraph(State)
      .addNode("transform", async (s: { input: string }) => ({
        output: s.input.trim().toUpperCase(),
      }))
      .addEdge(START, "transform")
      .addEdge("transform", END)
      .compile();

    const pipeline = RunnableLambda.from((raw: string) => ({ input: raw }))
      .pipe(new RunnableGraph(compiled))
      .pipe((state) => (state as { output: string }).output);

    expect(await pipeline.invoke("  hello  ")).toBe("HELLO");
  });

  it("toNodeAction adapts a Runnable for use in StateGraph", async () => {
    const innerPipeline = RunnableLambda.from((s: { raw: string }) => s.raw.trim())
      .pipe((s) => s.toUpperCase())
      .pipe((s) => ({ processed: s }));

    const State = Annotation.Root({
      raw: Annotation<string>(),
      processed: Annotation<string>(),
    });

    const graph = new StateGraph(State)
      .addNode("pipeline", toNodeAction(innerPipeline) as any)
      .addEdge(START, "pipeline")
      .addEdge("pipeline", END)
      .compile();

    const result = await graph.invoke({ raw: "  hello world  " });
    expect(result.processed).toBe("HELLO WORLD");
  });
});
