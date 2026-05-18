# @orchestrator/core

Lightweight, standalone graph orchestration engine for TypeScript. Inspired by [LangGraph](https://github.com/langchain-ai/langgraphjs)'s Pregel-based execution model, rebuilt from scratch with **zero external dependencies**.

Define stateful, multi-step workflows as directed graphs. Nodes are plain async functions; edges define the execution flow; state is shared and managed automatically.

## Features

- **Zero dependencies** — pure TypeScript, no `@langchain/*` or other runtime packages
- **Fluent builder API** — chain `.addNode()`, `.addEdge()`, `.compile()` to define workflows
- **Shared state with reducers** — nodes read/write a common state object; custom reducers handle merging
- **Conditional routing** — dynamically choose the next node based on state
- **Parallel fan-out / fan-in** — dispatch to multiple nodes in parallel, wait for all to complete
- **Pregel execution model** — superstep-based parallel execution with channel versioning
- **Command & Send** — advanced control flow primitives for dynamic routing and map-reduce patterns
- **Type-safe** — full TypeScript generics; state shape and update types are inferred from your schema

## Installation

```bash
# From the monorepo
pnpm install

# Or add to your project (once published)
npm install @orchestrator/core
```

**Requirements:** Node.js >= 18, TypeScript >= 5.0

## Quick Start

```ts
import { StateGraph, Annotation, START, END } from "@orchestrator/core";

// 1. Define state schema
const State = Annotation.Root({
  query: Annotation<string>(),
  result: Annotation<string>(),
});

// 2. Build graph
const graph = new StateGraph(State)
  .addNode("process", async (state) => ({
    result: `Processed: ${state.query}`,
  }))
  .addEdge(START, "process")
  .addEdge("process", END)
  .compile();

// 3. Execute
const output = await graph.invoke({ query: "hello" });
console.log(output);
// { query: "hello", result: "Processed: hello" }
```

## Core Concepts

### State & Annotation

State is the shared data structure that all nodes read from and write to. Define it using `Annotation`:

```ts
const ChatState = Annotation.Root({
  // Simple value — stores the last value written (LastValue channel)
  userId: Annotation<string>(),

  // With reducer — merges updates from multiple nodes
  messages: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),

  // With default — provides an initial value
  count: Annotation<number>({
    default: () => 0,
  }),
});
```

Each key in the state becomes a **channel**:

| Configuration | Channel Type | Behavior |
|---|---|---|
| `Annotation<T>()` | `LastValue` | Stores the latest value. Throws if two nodes write in the same superstep. |
| `Annotation<T>({ reducer })` | `ReducerChannel` | Merges multiple writes using the reducer function. |
| `Annotation<T>({ default })` | `LastValue` with default | Provides an initial value so the channel is never empty. |

### Nodes

Nodes are async functions that receive the current state and return a partial update:

```ts
const myNode = async (state: typeof ChatState.State) => {
  // Read from state
  const query = state.messages[state.messages.length - 1];

  // Return partial update — only the keys you want to change
  return {
    messages: [`Response to: ${query}`],
    count: state.count + 1,
  };
};
```

Register nodes with `.addNode()`:

```ts
graph.addNode("myNode", myNode);
```

### Edges

Edges define the execution flow between nodes.

**Static edges** — always follow this path:

```ts
graph.addEdge(START, "nodeA");   // entry point
graph.addEdge("nodeA", "nodeB"); // A always goes to B
graph.addEdge("nodeB", END);     // exit point
```

**Conditional edges** — choose the next node dynamically:

```ts
graph.addConditionalEdges(
  "classifier",                          // source node
  (state) => {                           // routing function
    if (state.sentiment === "negative") return "escalate";
    return "autoReply";
  },
  ["escalate", "autoReply"]              // possible targets
);
```

**Fan-in edges** — wait for multiple nodes to complete:

```ts
// Both searchA and searchB must finish before combine runs
graph.addEdge(["searchA", "searchB"], "combine");
```

### Compile & Execute

Call `.compile()` to validate the graph and produce an executable `CompiledStateGraph`:

```ts
const compiled = graph.compile({
  recursionLimit: 50,  // max supersteps (default: 25)
  name: "my-workflow",
});

// Execute with input
const result = await compiled.invoke(
  { query: "hello" },
  { signal: abortController.signal }  // optional AbortSignal
);
```

## Patterns

### Linear Chain

```
START → A → B → C → END
```

```ts
const graph = new StateGraph(State)
  .addNode("A", stepA)
  .addNode("B", stepB)
  .addNode("C", stepC)
  .addEdge(START, "A")
  .addEdge("A", "B")
  .addEdge("B", "C")
  .addEdge("C", END)
  .compile();
```

### Router (Conditional Branching)

```
START → classify → techHandler  → END
                 → generalHandler → END
```

```ts
const graph = new StateGraph(State)
  .addNode("classify", classifyQuery)
  .addNode("techHandler", handleTechnical)
  .addNode("generalHandler", handleGeneral)
  .addEdge(START, "classify")
  .addConditionalEdges(
    "classify",
    (state) => state.category === "technical" ? "techHandler" : "generalHandler",
    ["techHandler", "generalHandler"]
  )
  .addEdge("techHandler", END)
  .addEdge("generalHandler", END)
  .compile();
```

### Fan-out / Fan-in (Parallel Execution)

```
START → classify ──→ github    ──┐
                 ──→ notion    ──┼→ synthesize → END
                 ──→ slack     ──┘
```

```ts
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

const workflow = new StateGraph(State)
  .addNode("classify", classifyQuery)
  .addNode("github", queryGithub)
  .addNode("notion", queryNotion)
  .addNode("slack", querySlack)
  .addNode("synthesize", synthesizeResults)
  .addEdge(START, "classify")
  .addConditionalEdges("classify", routeToAgents, ["github", "notion", "slack"])
  .addEdge(["github", "notion", "slack"], "synthesize")
  .addEdge("synthesize", END)
  .compile();

const result = await workflow.invoke({ query: "How to deploy?" });
```

### Accumulator (Message History)

```ts
const State = Annotation.Root({
  messages: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
});

const graph = new StateGraph(State)
  .addNode("greet", async () => ({ messages: ["Hello!"] }))
  .addNode("respond", async () => ({ messages: ["How can I help?"] }))
  .addEdge(START, "greet")
  .addEdge("greet", "respond")
  .addEdge("respond", END)
  .compile();

const result = await graph.invoke({ messages: ["User: Hi"] });
// result.messages === ["User: Hi", "Hello!", "How can I help?"]
```

### Command-based Control Flow

Nodes can return `Command` objects to dynamically control routing and state updates:

```ts
import { Command } from "@orchestrator/core";

const myNode = async (state) => {
  return new Command({
    update: { status: "routed" },           // state update
    goto: "nextNode",                        // navigate to specific node
  });
};
```

### Dynamic Fan-out with Send

Use `Send` to dispatch dynamically-determined tasks:

```ts
import { Send } from "@orchestrator/core";

const dispatcher = async (state) => {
  return new Command({
    goto: state.items.map(
      (item) => new Send("processItem", { item })
    ),
  });
};
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  User Code                       │
│  StateGraph → addNode / addEdge → compile()      │
├─────────────────────────────────────────────────┤
│               Graph Builder Layer                │
│  Graph (base) ← StateGraph (state-aware)         │
│  Collects: nodes, edges, branches                │
├─────────────────────────────────────────────────┤
│             Compiled Graph Layer                  │
│  CompiledStateGraph                              │
│  Transforms topology → CompiledNode + Channels   │
├─────────────────────────────────────────────────┤
│              Pregel Engine Layer                  │
│  executePregelGraph()                            │
│  Superstep loop: prepare → execute → apply       │
├─────────────────────────────────────────────────┤
│               Channel Layer                      │
│  LastValue │ EphemeralValue │ NamedBarrierValue   │
│  State primitives with versioning                │
└─────────────────────────────────────────────────┘
```

### Execution Model

The engine uses a **superstep-based Pregel model**:

1. **Initialize** — input is written to channels
2. **Prepare** — find all nodes whose trigger channels have been updated (via version comparison)
3. **Execute** — run all triggered nodes in parallel
4. **Apply** — batch-apply all writes to channels; clear ephemeral channels
5. **Repeat** — go to step 2 until no more nodes are triggered, or recursion limit is hit
6. **Output** — read final values from output channels

Key design decisions:

- **Writes are deferred** — node writes are collected during execution and applied atomically after all nodes in the superstep complete
- **Version-based triggering** — each channel has a version counter; a node triggers when any of its trigger channels have a version newer than what the node last saw
- **Ephemeral channels auto-clear** — edge trigger channels (`branch:to:X`) are `EphemeralValue` channels that clear every superstep, preventing re-triggering
- **Barrier channels for fan-in** — `NamedBarrierValue` channels track which source nodes have written, and only become available when all expected sources have reported

## Project Structure

```
libs/orchestrator/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── index.ts                          # Public API exports
    ├── constants.ts                      # START, END, Send, Command
    ├── errors.ts                         # Error classes
    ├── channels/
    │   ├── base.ts                       # BaseChannel abstract class
    │   ├── last_value.ts                 # LastValue — default state channel
    │   ├── ephemeral_value.ts            # EphemeralValue — edge triggers
    │   ├── named_barrier_value.ts        # NamedBarrierValue — fan-in joins
    │   ├── topic.ts                      # Topic — accumulating list channel
    │   └── index.ts
    ├── state/
    │   ├── annotation.ts                 # Annotation DSL & ReducerChannel
    │   └── index.ts
    ├── graph/
    │   ├── types.ts                      # Core type definitions
    │   ├── graph.ts                      # Base Graph builder class
    │   ├── state.ts                      # StateGraph + CompiledStateGraph
    │   ├── state.test.ts                 # Test suite (9 tests)
    │   └── index.ts
    └── engine/
        ├── pregel.ts                     # Pregel execution engine
        └── index.ts
```

## API Reference

### `Annotation<V>(options?)`

Create a channel factory for a state key.

| Parameter | Type | Description |
|---|---|---|
| `options.reducer` | `(current: V, update: U) => V` | Merge function for concurrent writes |
| `options.default` | `() => V` | Factory for the initial value |

### `Annotation.Root(spec)`

Bundle multiple annotations into a state definition.

```ts
const State = Annotation.Root({
  key1: Annotation<string>(),
  key2: Annotation<number[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
});
```

### `new StateGraph(state)`

Create a new graph builder.

| Parameter | Type | Description |
|---|---|---|
| `state` | `AnnotationRoot` \| `StateDefinition` | State schema |

### `.addNode(name, action, options?)`

Register a node.

| Parameter | Type | Description |
|---|---|---|
| `name` | `string` | Unique node name |
| `action` | `(state: S, config?) => Partial<S> \| Promise<Partial<S>>` | Node function |
| `options.metadata` | `Record<string, unknown>` | Attached metadata |
| `options.defer` | `boolean` | Defer until all non-deferred nodes complete |

Returns `this` for chaining.

### `.addEdge(start, end)`

Add a static edge.

| Parameter | Type | Description |
|---|---|---|
| `start` | `START \| string \| string[]` | Source node(s). Array for fan-in. |
| `end` | `string \| END` | Target node |

Returns `this` for chaining.

### `.addConditionalEdges(source, path, pathMap?)`

Add dynamic routing from a node.

| Parameter | Type | Description |
|---|---|---|
| `source` | `string` | Source node name |
| `path` | `(state: S) => string \| string[]` | Routing function |
| `pathMap` | `string[] \| Record<string, string>` | Optional mapping of return values to node names |

Returns `this` for chaining.

### `.compile(options?)`

Validate and compile the graph.

| Parameter | Type | Description |
|---|---|---|
| `options.recursionLimit` | `number` | Max supersteps (default: 25) |
| `options.name` | `string` | Graph name |
| `options.description` | `string` | Graph description |

Returns `CompiledStateGraph`.

### `CompiledStateGraph.invoke(input, options?)`

Execute the compiled graph.

| Parameter | Type | Description |
|---|---|---|
| `input` | `Partial<S>` | Initial state values |
| `options.recursionLimit` | `number` | Override max supersteps |
| `options.signal` | `AbortSignal` | Cancellation signal |

Returns `Promise<S>` — the final state.

### `Command`

Control flow object returned from nodes.

```ts
new Command({
  update: { key: "value" },     // state updates
  goto: "nodeName",             // target node (string, string[], Send, Send[])
  graph: Command.PARENT,        // target parent graph
  resume: value,                // resume value for interrupt
});
```

### `Send`

Targeted message for dynamic fan-out.

```ts
new Send("nodeName", { custom: "input" });
```

### Error Classes

| Class | When |
|---|---|
| `OrchestratorError` | Base class for all errors |
| `GraphValidationError` | Invalid graph structure (missing nodes, bad edges) |
| `GraphRecursionError` | Exceeded `recursionLimit` supersteps |
| `InvalidUpdateError` | Invalid channel write (e.g., two writes to a LastValue channel) |
| `EmptyChannelError` | Reading a channel that has no value |
| `StateGraphInputError` | Invalid state definition passed to constructor |

## Comparison with LangGraph

| | LangGraph (`@langchain/langgraph`) | `@orchestrator/core` |
|---|---|---|
| Dependencies | `@langchain/core`, `@langchain/langgraph-checkpoint`, `zod`, `uuid` | None |
| State schema | `AnnotationRoot`, `StateSchema`, Zod schemas | `Annotation.Root()` |
| Node type | `RunnableLike` (Runnable, function, object) | Plain `async (state) => update` |
| Checkpointing | Built-in with multiple backends | Not included (add-on ready) |
| Streaming | Full streaming infrastructure | Not included |
| Human-in-the-loop | `interrupt()` / resume | `Command.resume` (structural support) |
| Size | ~10,000+ lines across packages | ~2,700 lines, single package |

## Development

```bash
# Type-check
npx tsc --noEmit

# Run tests
pnpm test

# Watch mode
pnpm test:watch

# Build
pnpm build
```

## License

MIT
