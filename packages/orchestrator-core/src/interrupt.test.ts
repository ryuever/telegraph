import { describe, it, expect } from "vitest";
import {
  StateGraph,
  Annotation,
  START,
  END,
  Command,
  MemorySaver,
  interrupt,
  GraphInterrupt,
  isGraphInterrupt,
} from "./index.js";

// ═══════════════════════════════════════════════════════════════
//  Test state definitions
// ═══════════════════════════════════════════════════════════════

const SimpleState = Annotation.Root({
  value: Annotation<string>(),
  approved: Annotation<boolean>(),
});

const MultiState = Annotation.Root({
  value: Annotation<string>(),
  name: Annotation<string>(),
  age: Annotation<number>(),
});

const CounterState = Annotation.Root({
  count: Annotation<number>(),
  log: Annotation<string[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
});

// ═══════════════════════════════════════════════════════════════
//  interrupt() function tests
// ═══════════════════════════════════════════════════════════════

describe("interrupt()", () => {
  it("should throw GraphInterrupt when no resume value is available", async () => {
    const graph = new StateGraph(SimpleState)
      .addNode("review", async (state) => {
        const response = interrupt("Please approve this action");
        return { value: state.value, approved: response === "yes" };
      })
      .addEdge(START, "review")
      .addEdge("review", END)
      .compile({ checkpointer: new MemorySaver() });

    try {
      await graph.invoke(
        { value: "test", approved: false },
        { configurable: { thread_id: "t1" } }
      );
      expect.unreachable("Should have thrown GraphInterrupt");
    } catch (e) {
      expect(isGraphInterrupt(e)).toBe(true);
      const gi = e as GraphInterrupt;
      expect(gi.interrupts).toHaveLength(1);
      expect(gi.interrupts[0].value).toBe("Please approve this action");
      expect(gi.interrupts[0].resumable).toBe(true);
    }
  });

  it("should return resume value on second invocation", async () => {
    const graph = new StateGraph(SimpleState)
      .addNode("review", async (state) => {
        const response = interrupt("Please approve") as string;
        return { value: state.value, approved: response === "yes" };
      })
      .addEdge(START, "review")
      .addEdge("review", END)
      .compile({ checkpointer: new MemorySaver() });

    // First invocation — should interrupt
    try {
      await graph.invoke(
        { value: "hello", approved: false },
        { configurable: { thread_id: "t2" } }
      );
      expect.unreachable("Should have thrown GraphInterrupt");
    } catch (e) {
      expect(isGraphInterrupt(e)).toBe(true);
    }

    // Resume with approval
    const result = await graph.invoke(
      new Command({ resume: "yes" }),
      { configurable: { thread_id: "t2" } }
    );

    expect(result.approved).toBe(true);
    expect(result.value).toBe("hello");
  });

  it("should support structured interrupt payloads", async () => {
    const graph = new StateGraph(SimpleState)
      .addNode("review", async () => {
        const response = interrupt({
          type: "approval",
          action: "delete_file",
          path: "/important.txt",
        }) as { approved: boolean };
        return { value: "done", approved: response.approved };
      })
      .addEdge(START, "review")
      .addEdge("review", END)
      .compile({ checkpointer: new MemorySaver() });

    // First invocation — check the payload
    try {
      await graph.invoke(
        { value: "", approved: false },
        { configurable: { thread_id: "t3" } }
      );
      expect.unreachable();
    } catch (e) {
      const gi = e as GraphInterrupt;
      expect(gi.interrupts[0].value).toEqual({
        type: "approval",
        action: "delete_file",
        path: "/important.txt",
      });
    }

    // Resume with structured response
    const result = await graph.invoke(
      new Command({ resume: { approved: true } }),
      { configurable: { thread_id: "t3" } }
    );

    expect(result.approved).toBe(true);
  });

  it("should support multiple interrupts in one node", async () => {
    const graph = new StateGraph(MultiState)
      .addNode("survey", async () => {
        const name = interrupt("What is your name?") as string;
        const age = interrupt("What is your age?") as number;
        return { value: "done", name, age };
      })
      .addEdge(START, "survey")
      .addEdge("survey", END)
      .compile({ checkpointer: new MemorySaver() });

    // First invocation — first interrupt
    try {
      await graph.invoke(
        { value: "", name: "", age: 0 },
        { configurable: { thread_id: "t4" } }
      );
      expect.unreachable();
    } catch (e) {
      expect(isGraphInterrupt(e)).toBe(true);
      const gi = e as GraphInterrupt;
      expect(gi.interrupts[0].value).toBe("What is your name?");
    }

    // Resume with both values
    const result = await graph.invoke(
      new Command({ resume: ["Alice", 30] }),
      { configurable: { thread_id: "t4" } }
    );

    expect(result.name).toBe("Alice");
    expect(result.age).toBe(30);
  });

  it("should throw error when called outside execution context", async () => {
    expect(() => interrupt("test")).toThrow(
      "interrupt() called outside of a graph execution context"
    );
  });
});

// ═══════════════════════════════════════════════════════════════
//  interruptBefore tests
// ═══════════════════════════════════════════════════════════════

describe("interruptBefore", () => {
  it("should interrupt before the specified node", async () => {
    const graph = new StateGraph(CounterState)
      .addNode("step1", async (state) => ({
        count: state.count + 1,
        log: ["step1"],
      }))
      .addNode("step2", async (state) => ({
        count: state.count + 10,
        log: ["step2"],
      }))
      .addEdge(START, "step1")
      .addEdge("step1", "step2")
      .addEdge("step2", END)
      .compile({
        checkpointer: new MemorySaver(),
        interruptBefore: ["step2"],
      });

    // Should execute step1 then interrupt before step2
    try {
      await graph.invoke(
        { count: 0 },
        { configurable: { thread_id: "t5" } }
      );
      expect.unreachable();
    } catch (e) {
      expect(isGraphInterrupt(e)).toBe(true);
      const gi = e as GraphInterrupt;
      expect(gi.interrupts[0].value).toEqual({
        type: "interrupt_before",
        node: "step2",
      });
    }

    // Check intermediate state — step1 should have run
    const state = await graph.getState({ thread_id: "t5" });
    expect(state?.count).toBe(1);
    expect(state?.log).toContain("step1");
  });
});

// ═══════════════════════════════════════════════════════════════
//  interruptAfter tests
// ═══════════════════════════════════════════════════════════════

describe("interruptAfter", () => {
  it("should interrupt after the specified node", async () => {
    const graph = new StateGraph(CounterState)
      .addNode("step1", async (state) => ({
        count: state.count + 1,
        log: ["step1"],
      }))
      .addNode("step2", async (state) => ({
        count: state.count + 10,
        log: ["step2"],
      }))
      .addEdge(START, "step1")
      .addEdge("step1", "step2")
      .addEdge("step2", END)
      .compile({
        checkpointer: new MemorySaver(),
        interruptAfter: ["step1"],
      });

    // Should execute step1 then interrupt after it
    try {
      await graph.invoke(
        { count: 0 },
        { configurable: { thread_id: "t6" } }
      );
      expect.unreachable();
    } catch (e) {
      expect(isGraphInterrupt(e)).toBe(true);
      const gi = e as GraphInterrupt;
      expect(gi.interrupts[0].value).toEqual({
        type: "interrupt_after",
        node: "step1",
      });
    }

    // Check state — step1 should have completed, step2 should not have run
    const state = await graph.getState({ thread_id: "t6" });
    expect(state?.count).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
//  GraphInterrupt class tests
// ═══════════════════════════════════════════════════════════════

describe("GraphInterrupt", () => {
  it("should have proper error properties", () => {
    const gi = new GraphInterrupt([
      { id: "i1", value: "test", resumable: true },
    ]);
    expect(gi.name).toBe("GraphInterrupt");
    expect(gi.interrupts).toHaveLength(1);
    expect(gi.message).toContain("Graph interrupted");
    expect(gi instanceof Error).toBe(true);
  });

  it("should be detected by isGraphInterrupt", () => {
    const gi = new GraphInterrupt([
      { id: "i1", value: "test", resumable: true },
    ]);
    expect(isGraphInterrupt(gi)).toBe(true);
    expect(isGraphInterrupt(new Error("test"))).toBe(false);
    expect(isGraphInterrupt("not an error")).toBe(false);
  });
});
