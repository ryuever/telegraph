import { describe, it, expect } from "vitest";
import { StateGraph, CompiledStateGraph } from "./state.js";
import { Annotation } from "../state/annotation.js";
import { START, END } from "../constants.js";

// ═══════════════════════════════════════════════════════════════
//  Test 1: Simple linear graph (START → A → END)
// ═══════════════════════════════════════════════════════════════

describe("StateGraph - Simple Linear", () => {
  const SimpleState = Annotation.Root({
    input: Annotation<string>(),
    output: Annotation<string>(),
  });

  it("should execute a single node graph", async () => {
    const graph = new StateGraph(SimpleState)
      .addNode("process", async (state) => {
        return { output: `Processed: ${state.input}` };
      })
      .addEdge(START, "process")
      .addEdge("process", END)
      .compile();

    const result = await graph.invoke({ input: "hello" });

    expect(result.input).toBe("hello");
    expect(result.output).toBe("Processed: hello");
  });

  it("should execute a multi-node linear chain", async () => {
    const ChainState = Annotation.Root({
      value: Annotation<number>(),
    });

    const graph = new StateGraph(ChainState)
      .addNode("double", async (state) => ({ value: state.value * 2 }))
      .addNode("addTen", async (state) => ({ value: state.value + 10 }))
      .addEdge(START, "double")
      .addEdge("double", "addTen")
      .addEdge("addTen", END)
      .compile();

    const result = await graph.invoke({ value: 5 });

    // 5 * 2 = 10, then 10 + 10 = 20
    expect(result.value).toBe(20);
  });
});

// ═══════════════════════════════════════════════════════════════
//  Test 2: Conditional edges (branching)
// ═══════════════════════════════════════════════════════════════

describe("StateGraph - Conditional Edges", () => {
  const RouterState = Annotation.Root({
    query: Annotation<string>(),
    category: Annotation<string>(),
    result: Annotation<string>(),
  });

  it("should route to different nodes based on condition", async () => {
    const graph = new StateGraph(RouterState)
      .addNode("classify", async (state) => {
        const category = state.query.includes("code") ? "technical" : "general";
        return { category };
      })
      .addNode("techHandler", async (state) => {
        return { result: `Technical answer for: ${state.query}` };
      })
      .addNode("generalHandler", async (state) => {
        return { result: `General answer for: ${state.query}` };
      })
      .addEdge(START, "classify")
      .addConditionalEdges(
        "classify",
        (state) => {
          return state.category === "technical" ? "techHandler" : "generalHandler";
        },
        ["techHandler", "generalHandler"]
      )
      .addEdge("techHandler", END)
      .addEdge("generalHandler", END)
      .compile();

    // Technical query
    const result1 = await graph.invoke({ query: "How to write code?" });
    expect(result1.category).toBe("technical");
    expect(result1.result).toBe("Technical answer for: How to write code?");

    // General query
    const result2 = await graph.invoke({ query: "What is the weather?" });
    expect(result2.category).toBe("general");
    expect(result2.result).toBe("General answer for: What is the weather?");
  });
});

// ═══════════════════════════════════════════════════════════════
//  Test 3: Reducer (accumulating state)
// ═══════════════════════════════════════════════════════════════

describe("StateGraph - Reducers", () => {
  it("should accumulate values using a reducer", async () => {
    const AccumState = Annotation.Root({
      messages: Annotation<string[]>({
        reducer: (current, update) => [...current, ...update],
        default: () => [],
      }),
    });

    const graph = new StateGraph(AccumState)
      .addNode("greet", async () => {
        return { messages: ["Hello!"] };
      })
      .addNode("respond", async () => {
        return { messages: ["How can I help you?"] };
      })
      .addEdge(START, "greet")
      .addEdge("greet", "respond")
      .addEdge("respond", END)
      .compile();

    const result = await graph.invoke({ messages: ["User: Hi"] });

    expect(result.messages).toEqual([
      "User: Hi",
      "Hello!",
      "How can I help you?",
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════
//  Test 4: Fan-in (multiple sources → one target)
// ═══════════════════════════════════════════════════════════════

describe("StateGraph - Fan-in (waiting edges)", () => {
  it("should wait for all sources before executing target", async () => {
    const FanInState = Annotation.Root({
      query: Annotation<string>(),
      results: Annotation<string[]>({
        reducer: (current, update) => [...current, ...update],
        default: () => [],
      }),
      summary: Annotation<string>(),
    });

    const graph = new StateGraph(FanInState)
      .addNode("searchA", async (state) => {
        return { results: [`A: result for "${state.query}"`] };
      })
      .addNode("searchB", async (state) => {
        return { results: [`B: result for "${state.query}"`] };
      })
      .addNode("combine", async (state) => {
        return { summary: state.results.join(" | ") };
      })
      .addEdge(START, "searchA")
      .addEdge(START, "searchB")
      .addEdge(["searchA", "searchB"] as any, "combine")
      .addEdge("combine", END)
      .compile();

    const result = await graph.invoke({ query: "test" });

    expect(result.results).toHaveLength(2);
    expect(result.results).toContain('A: result for "test"');
    expect(result.results).toContain('B: result for "test"');
    expect(result.summary).toContain("A:");
    expect(result.summary).toContain("B:");
  });
});

// ═══════════════════════════════════════════════════════════════
//  Test 5: The user's Router pattern
// ═══════════════════════════════════════════════════════════════

describe("StateGraph - Router Pattern (user example)", () => {
  interface RouterState {
    query: string;
    classification: string;
    githubResults: string[];
    notionResults: string[];
    slackResults: string[];
    synthesis: string;
  }

  it("should handle the classify → fan-out → synthesize pattern", async () => {
    const State = Annotation.Root({
      query: Annotation<string>(),
      classification: Annotation<string>(),
      githubResults: Annotation<string[]>({
        reducer: (a, b) => [...a, ...b],
        default: () => [],
      }),
      notionResults: Annotation<string[]>({
        reducer: (a, b) => [...a, ...b],
        default: () => [],
      }),
      slackResults: Annotation<string[]>({
        reducer: (a, b) => [...a, ...b],
        default: () => [],
      }),
      synthesis: Annotation<string>(),
    });

    const classifyQuery = async (state: { query: string }) => {
      // Determine which agents to query based on classification
      return { classification: "all" };
    };

    const queryGithub = async (state: { query: string }) => {
      return { githubResults: [`GitHub: found issue for "${state.query}"`] };
    };

    const queryNotion = async (state: { query: string }) => {
      return { notionResults: [`Notion: found doc for "${state.query}"`] };
    };

    const querySlack = async (state: { query: string }) => {
      return { slackResults: [`Slack: found thread for "${state.query}"`] };
    };

    const synthesizeResults = async (state: {
      githubResults: string[];
      notionResults: string[];
      slackResults: string[];
    }) => {
      const all = [
        ...state.githubResults,
        ...state.notionResults,
        ...state.slackResults,
      ];
      return { synthesis: `Combined ${all.length} results: ${all.join("; ")}` };
    };

    const routeToAgents = (state: { classification: string }) => {
      // Route to all agents
      return ["github", "notion", "slack"];
    };

    const workflow = new StateGraph(State)
      .addNode("classify", classifyQuery)
      .addNode("github", queryGithub)
      .addNode("notion", queryNotion)
      .addNode("slack", querySlack)
      .addNode("synthesize", synthesizeResults)
      .addEdge(START, "classify")
      .addConditionalEdges("classify", routeToAgents, [
        "github",
        "notion",
        "slack",
      ])
      .addEdge(["github", "notion", "slack"] as any, "synthesize")
      .addEdge("synthesize", END)
      .compile();

    const result = await workflow.invoke({ query: "How to deploy?" });

    expect(result.classification).toBe("all");
    expect(result.githubResults).toHaveLength(1);
    expect(result.notionResults).toHaveLength(1);
    expect(result.slackResults).toHaveLength(1);
    expect(result.synthesis).toContain("Combined 3 results");
    expect(result.synthesis).toContain("GitHub");
    expect(result.synthesis).toContain("Notion");
    expect(result.synthesis).toContain("Slack");
  });
});

// ═══════════════════════════════════════════════════════════════
//  Test 6: Graph validation errors
// ═══════════════════════════════════════════════════════════════

describe("StateGraph - Validation", () => {
  const SimpleState = Annotation.Root({
    value: Annotation<string>(),
  });

  it("should throw when adding duplicate node names", () => {
    const graph = new StateGraph(SimpleState);
    graph.addNode("myNode", async () => ({}));

    expect(() => {
      graph.addNode("myNode", async () => ({}));
    }).toThrow(/already exists/);
  });

  it("should throw when using reserved names", () => {
    const graph = new StateGraph(SimpleState);

    expect(() => {
      graph.addNode(START, async () => ({}));
    }).toThrow(/reserved/);

    expect(() => {
      graph.addNode(END, async () => ({}));
    }).toThrow(/reserved/);
  });

  it("should throw when edge references non-existent node", () => {
    const graph = new StateGraph(SimpleState);

    expect(() => {
      graph.addEdge(START, "nonexistent" as any);
    }).toThrow(/Need to add a node/);
  });
});
