# Phase 2 Design: Pi-Embedded Runtime & Tool Execution

**Document ID**: D-003  
**Created**: 2026-05-05  
**Status**: Design (in progress)  
**Scope**: Pi-Embedded runtime executor, tool execution, multi-turn sessions

---

> 2026-05-20 对齐注记：本文是历史设计草案。`PiEmbeddedRuntime` 不再作为独立产品层或
> “替代 pi-cli spawn” 的路线表达；新的术语是 **Embedded Execution Kernel**，它只服务
> Telegraph Native Harness。兼容 Pi CLI / pi-subagents 生态时，应走 External Agent Runtime。
> 详见 [D-015](./20260520-agent-runtime-product-layer-alignment.md)。

## Overview

Phase 2 builds on Phase 1's Runtime Adapter pattern to introduce:
1. **Embedded Execution Kernel**: Native Harness 底层的 in-process model/tool loop
2. **Tool Execution**: Tool call / tool result events
3. **Multi-turn Sessions**: Conversation state management

### Key Difference from Phase 1

| Aspect | Phase 1 (Pi-AI) | Phase 2 (Pi-Embedded) |
|--------|---------------|--------------------|
| Execution model | LLM-only streaming | LLM + embedded tool loop |
| Tool support | None | Basic tool call/result |
| Session state | Stateless per-run | Multi-turn context |
| Event types | model_*, run_* | + tool_call, tool_result |
| Extension loading | N/A | Manifest + activation |

---

## Architecture

### 2.1 EmbeddedExecutionKernel Class Structure（历史草案原称 PiEmbeddedRuntime）

```typescript
export class EmbeddedExecutionKernel extends BaseAgentRuntime {
  readonly id = 'native-embedded'
  readonly label = 'Pi Embedded (In-Process + Tools)'

  private toolRegistry: ToolRegistry
  private sessionStore: SessionStore
  private extensionHost: ExtensionHost

  async *run(input: RuntimeInput): AsyncIterable<RuntimeEvent> {
    // 1. Initialize session context
    const session = this.sessionStore.getOrCreate(input.sessionId)
    
    // 2. Emit run_started
    yield { type: 'run_started', ... }
    
    // 3. Main execution loop (tool loop + LLM streaming)
    while (!session.isTerminal) {
      // 3a. Gather context (messages, tools, previous results)
      const context = this.buildContext(session, input.message)
      
      // 3b. Stream LLM response with embedded tool calls
      const toolCalls = []
      for await (const event of this.streamLlmWithTools(context)) {
        if (event.type === 'model_event') {
          yield event
        } else if (event.type === 'tool_call') {
          toolCalls.push(event)
          yield event
        }
      }
      
      // 3c. Execute tool calls (in parallel where safe)
      const results = await this.executeTools(toolCalls, session)
      for (const result of results) {
        yield { type: 'tool_result', ... }
      }
      
      // 3d. Check terminal condition
      if (this.shouldTerminate(session, toolCalls, results)) {
        break
      }
      
      // 3e. Prepare for next loop iteration (update messages, etc.)
      session.addToolResults(results)
    }
    
    // 4. Emit run_completed
    yield { type: 'run_completed', ... }
  }

  private async streamLlmWithTools(
    context: ExecutionContext
  ): AsyncIterable<RuntimeEvent> {
    // Adapt pi-ai streaming + detect tool calls
    // Yield model_event + tool_call interspersed
  }

  private async executeTools(
    toolCalls: ToolCallEvent[],
    session: Session
  ): Promise<ToolResultEvent[]> {
    // Resolve tool definitions from registry
    // Execute with proper error handling
    // Return results
  }

  private buildContext(
    session: Session,
    userMessage: string
  ): ExecutionContext {
    // Combine session history + system prompt + user input
    // Include available tools
  }

  private shouldTerminate(
    session: Session,
    toolCalls: ToolCallEvent[],
    results: ToolResultEvent[]
  ): boolean {
    // Stop if: no tool calls, explicit done signal, or max iterations
  }
}
```

### 2.2 Tool Execution Flow

```
User Input
  │
  ├─ session.addMessage(user_message)
  │
  ├─ context = buildContext(session, available_tools)
  │
  ├─ LLM Stream (with tool_use tokens detected)
  │   ├─ model_event (text chunks)
  │   └─ tool_call (detected tool invocation)
  │
  ├─ Parallel Tool Execution
  │   ├─ toolRegistry.resolve(tool_call.name)
  │   ├─ tool.execute(args)
  │   └─ tool_result (success or error)
  │
  ├─ session.addToolResult(result)
  │
  └─ Next Iteration? (loop or terminate)
       │
       └─ run_completed
```

---

## Event Mapping: Tool Events

### Tool Call Event

**Source**: Parsed from LLM response (tool_use tokens)

```typescript
type ToolCallEvent = {
  type: 'tool_call'
  runId: string
  requestId: string // Link to model_request
  toolId: string    // Unique tool identifier
  name: string      // Display name
  args: Record<string, unknown>
  ts: number
  // Optional
  toolSourceUrl?: string // e.g., 'extension://my-ext/tool/calculator'
}
```

### Tool Result Event

**Source**: After tool execution (success or failure)

```typescript
type ToolResultEvent = {
  type: 'tool_result'
  runId: string
  toolCallId: string // Back-reference to tool_call
  toolId: string
  name: string
  result: unknown    // Serializable output
  error?: {
    code: string
    message: string
  }
  executionMs: number // How long the tool took
  ts: number
}
```

---

## Session State Management

### SessionStore Interface

```typescript
interface Session {
  sessionId: string
  messages: Message[] // History of user/assistant/tool messages
  runs: RunRecord[] // Each user turn may trigger multiple runs
  isTerminal: boolean
  
  addMessage(role: 'user' | 'assistant', content: string): void
  addToolResult(result: ToolResultEvent): void
  getContext(): ExecutionContext
}

interface Message {
  role: 'user' | 'assistant' | 'tool'
  content: string
  ts: number
  metadata?: Record<string, unknown>
}

interface RunRecord {
  runId: string
  startTs: number
  endTs?: number
  events: RuntimeEvent[]
}
```

### Multi-turn Example

```
Turn 1: User asks "What's the weather in NYC?"
  ├─ Run 1: runId='run-001'
  │   ├─ model_request (with weather_tool available)
  │   ├─ tool_call (weather_tool, args={city: 'NYC'})
  │   ├─ tool_result (72°F, sunny)
  │   ├─ model_event ("It's 72°F and sunny in NYC")
  │   └─ run_completed
  │
  └─ session.messages = [
       { role: 'user', content: "What's the weather in NYC?" },
       { role: 'assistant', content: "It's 72°F and sunny in NYC" }
     ]

Turn 2: User asks "And in LA?"
  ├─ Run 2: runId='run-002'
  │   ├─ model_request (context includes NYC convo)
  │   ├─ tool_call (weather_tool, args={city: 'LA'})
  │   ├─ tool_result (68°F, cloudy)
  │   ├─ model_event ("LA is 68°F and cloudy")
  │   └─ run_completed
  │
  └─ session.messages = [
       { role: 'user', content: "What's the weather in NYC?" },
       { role: 'assistant', content: "It's 72°F and sunny in NYC" },
       { role: 'user', content: "And in LA?" },
       { role: 'assistant', content: "LA is 68°F and cloudy" }
     ]
```

---

## Extension Host Integration

### Extension Manifest (Expected Format)

```json
{
  "id": "weather-tools",
  "name": "Weather Tools",
  "version": "1.0.0",
  "activationEvents": ["on-demand"],
  "main": "./dist/extension.js",
  "tools": [
    {
      "id": "weather_tool",
      "name": "weather_tool",
      "description": "Get current weather for a city",
      "parameters": {
        "type": "object",
        "properties": {
          "city": { "type": "string" }
        },
        "required": ["city"]
      }
    }
  ]
}
```

### Extension Host API

```typescript
interface ExtensionHost {
  loadExtension(manifest: ExtensionManifest): Promise<Extension>
  activate(extension: Extension): Promise<void>
  getTools(extensionId: string): ToolDefinition[]
}

interface Extension {
  id: string
  manifest: ExtensionManifest
  activate(): Promise<void>
  deactivate?(): Promise<void>
}
```

---

## Implementation Plan

### Step 1: Core Classes (Week 1)

```
packages/agent/src/runtime/
  ├── EmbeddedExecutionKernel.ts     [NEW]
  ├── sessionManagement/
  │   ├── SessionStore.ts             [NEW]
  │   └── Session.ts                  [NEW]
  └── toolExecution/
      ├── ToolRegistry.ts             [NEW]
      └── ToolExecutor.ts             [NEW]
```

### Step 2: Event Adaptation (Week 1-2)

```
packages/agent/src/runtime/
  └── streamEmbeddedExecutionKernel.ts [NEW - event adapter]
```

Update Event Mapping (R-001) to include tool_call/tool_result.

### Step 3: Extension Host (Week 2)

```
packages/agent/src/extensions/
  ├── ExtensionHost.ts                [NEW]
  ├── ExtensionManifest.ts            [NEW]
  └── ExtensionRegistry.ts            [NEW]
```

### Step 4: Integration & Tests (Week 3)

- Update runtime selection to handle 'native-embedded'
- Integration tests: multi-turn, tool execution, error handling
- Performance baseline

---

## Open Questions & Decisions

### Q1: Tool Execution Parallelism

**Question**: Should multiple tool calls be executed in parallel or sequentially?

**Options**:
- (A) Sequential: Safer, easier debugging, but slower
- (B) Parallel (Promise.all): Faster, but requires tool isolation
- (C) Hybrid: User-configurable per tool

**Recommendation**: **(B) Parallel with sandboxing** — allows tools to declare dependencies; execute in topological order.

### Q2: Error Handling in Tool Calls

**Question**: If a tool call fails, should we:
- (A) Emit tool_result with error, continue loop?
- (B) Emit run_failed and stop?
- (C) User configurable?

**Recommendation**: **(A) Continue** — LLM should handle tool errors and retry. Only terminal if max retries exceeded.

### Q3: Extension Loading Strategy

**Question**: Where should extensions be loaded from?
- (A) Bundled with Telegraph
- (B) User home directory (.telegraph/extensions)
- (C) NPM packages
- (D) All of the above

**Recommendation**: **(D) All of the above**, with precedence: Bundled > User > NPM.

### Q4: Session Storage Backend

**Question**: Persist sessions to disk or keep in-memory?

**Recommendation**: **In-memory for Phase 2**; defer persistent storage to Phase 3 (requires DB schema).

---

## Success Criteria (Phase 2 Exit)

- [ ] EmbeddedExecutionKernel compiles and exports correctly
- [ ] Tool call/result events defined and tested
- [ ] Multi-turn conversation maintains state across runs
- [ ] Extension Host loads and activates extensions
- [ ] Integration tests pass (tool execution, error scenarios)
- [ ] Event Mapping (R-001) updated with tool events
- [ ] Phase 2 completion summary documented

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Pi-AI doesn't expose tool_use tokens | HIGH | Investigate pi-ai streaming API; fallback to string parsing |
| Tool isolation/sandboxing complexity | MEDIUM | Phase 2 assumes safe tools; Phase 3 adds sandboxing |
| Session state explosion (long chats) | MEDIUM | Implement message pruning/summarization in Phase 3 |
| Extension manifest incompatibility | LOW | Define TypeScript interfaces; validate at load time |

---

## References

- A-005: Architecture & long-term vision
- P-002: Phase gates & roadmap
- R-001: Event mapping (will be extended)
- Phase 1 completion: Phase 1 exit validation

---

**Next Step**: Implement Step 1 (Core Classes)
