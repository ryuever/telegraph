# Phase 3: Extension Framework & Multi-Framework Support Design

**Document ID**: A-006  
**Date**: 2026-05-05  
**Phase**: 3.0 Planning  
**Status**: ACTIVE DESIGN

---

> 2026-05-20 对齐注记：本文是历史 Phase 3 设计草案。新的分层见
> [D-015](../discussion/20260520-agent-runtime-product-layer-alignment.md)：External Agent Runtime
> 与 Telegraph Native Harness 是产品层；Embedded Execution Kernel 只作为 Native Harness
> 底层，不再以 `PiEmbeddedRuntime` 作为独立长期主线。

## Executive Summary

Phase 3 extends the Telegraph Agent Runtime from a monolithic embedded executor into a **pluggable multi-framework host** with **persistent session storage** and **dynamic extension loading**. The architecture introduces:

1. **Extension Manifest System**: YAML/JSON-based tool/capability declarations loaded from filesystem or app bundle
2. **Persistent SQLite Backend**: Multi-turn conversation storage, session recovery, query-based history
3. **Framework Adapter Pattern**: Runtime adapters for LangGraph, Vercel AI SDK, Mastra (beyond pi-ai / embedded kernel)
4. **Tool Coordination**: Dependency resolution, rate limiting, permission-based execution
5. **Observability Layer**: Execution timeline, metrics, tracing for UI visualization

---

## Architecture Overview

### Component Topology

```
Telegraph Agent Runtime (Phase 3)
│
├─ Extension System
│  ├─ ExtensionManifest (YAML/JSON loader)
│  ├─ ExtensionRegistry (lifecycle: load, validate, unload)
│  ├─ DynamicToolLoader (from manifest → ToolRegistry)
│  └─ ExtensionSandbox (permission boundaries)
│
├─ Persistence Layer
│  ├─ SessionRepository (SQLite backend)
│  ├─ ConversationStore (sessions + message history)
│  ├─ RunArtifactStore (logs, tool results, traces)
│  └─ Migrations (schema versioning)
│
├─ Framework Adapters
│  ├─ RuntimeAdapterFactory (dispatch by framework type)
│  ├─ PiAiRuntime (existing, no changes)
│  ├─ EmbeddedExecutionKernel (Native Harness 底层)
│  ├─ LangGraphRuntime (new)
│  ├─ VercelAiRuntime (new)
│  └─ MastraRuntime (new, low priority)
│
├─ Tool Coordination
│  ├─ DependencyGraph (tool → dependencies)
│  ├─ TopologicalSort (execution ordering)
│  ├─ RateLimiter (per-tool concurrency control)
│  └─ PermissionValidator (capability checks)
│
└─ Observability
   ├─ ExecutionTimeline (tool start/end/duration)
   ├─ MetricsCollector (latency, success rate, token usage)
   ├─ TraceStore (structured logs for debugging)
   └─ UIBridge (emit timeline events to renderer)
```

---

## Phase 3.1: Extension Framework (Priority: CRITICAL)

### Design: ExtensionManifest

An extension is declared via a **manifest file** (`extension.yml` or `extension.json`):

```yaml
# ~/.telegraph/extensions/my-tools/extension.yml
name: my-tools
version: 1.0.0
description: Custom tools for data processing
author: user@example.com

tools:
  - id: fetch-data
    name: Fetch Data
    description: Fetch data from API
    input_schema:
      type: object
      properties:
        url:
          type: string
          description: API endpoint
        timeout:
          type: integer
          default: 5000
      required: [url]
    executable:
      type: node  # 'node', 'python', 'binary', 'http'
      path: ./lib/fetch-data.js  # relative to extension dir
      handler: fetchData  # export function name (node/python only)
    
    # Tool coordination metadata
    dependencies: []  # other tool IDs this tool depends on
    maxConcurrency: 1  # if > 1, tool can run in parallel with self
    timeout: 10000  # ms
    retryPolicy:
      maxAttempts: 2
      backoffMs: 1000
    
    # Permissions & sandbox
    permissions:
      - network  # HTTP/HTTPS
      - filesystem:read:/data  # specific path read
      - environment:API_KEY  # env var access
    
  - id: process-data
    name: Process Data
    description: Transform data with filters
    input_schema: {...}
    executable:
      type: http
      endpoint: http://localhost:3001/process  # webhook
    dependencies: [fetch-data]  # runs after fetch-data
    timeout: 30000

# Optional: LLM-specific hints
llmHints:
  model: gpt-4-turbo
  temperature: 0.3
  systemPrompt: |
    You are a data analyst. Use the provided tools to fetch and process data.
```

### Implementation: ExtensionRegistry

```typescript
// packages/agent/src/extensions/ExtensionRegistry.ts

interface ExtensionManifest {
  name: string;
  version: string;
  description: string;
  author: string;
  tools: ToolDefinition[];
  llmHints?: LLMHints;
}

interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  inputSchema: JSONSchema;
  executable: ExecutableConfig;
  dependencies?: string[];
  maxConcurrency?: number;
  timeout?: number;
  retryPolicy?: RetryPolicy;
  permissions?: Permission[];
}

type ExecutableConfig = 
  | { type: 'node'; path: string; handler: string }
  | { type: 'python'; path: string; handler: string }
  | { type: 'binary'; path: string; args?: string[] }
  | { type: 'http'; endpoint: string };

class ExtensionRegistry {
  private extensions: Map<string, LoadedExtension> = new Map();
  private extensionDirs: string[] = [];

  constructor(private toolRegistry: ToolRegistry) {}

  // Lifecycle: load extensions from dirs
  async loadExtensionsFromDirs(dirs: string[]): Promise<void> {
    this.extensionDirs = dirs;
    for (const dir of dirs) {
      await this.scanAndLoadDir(dir);
    }
  }

  private async scanAndLoadDir(dir: string): Promise<void> {
    // Scan for extension.yml or extension.json files
    // Parse manifest, validate, load tools
  }

  async loadExtension(manifestPath: string): Promise<void> {
    const manifest = await this.parseManifest(manifestPath);
    await this.validateManifest(manifest);
    
    const extension: LoadedExtension = {
      manifest,
      baseDir: dirname(manifestPath),
      tools: new Map(),
      status: 'loaded'
    };

    // Register tools with ToolRegistry
    for (const toolDef of manifest.tools) {
      const tool = await this.createToolFromDef(toolDef, extension.baseDir);
      extension.tools.set(toolDef.id, tool);
      this.toolRegistry.register(tool);
    }

    this.extensions.set(manifest.name, extension);
  }

  async unloadExtension(name: string): Promise<void> {
    const ext = this.extensions.get(name);
    if (!ext) throw new Error(`Extension ${name} not loaded`);

    // Unregister tools
    for (const toolId of ext.tools.keys()) {
      this.toolRegistry.unregister(toolId);
    }

    ext.status = 'unloaded';
    this.extensions.delete(name);
  }

  getLoadedExtensions(): LoadedExtension[] {
    return Array.from(this.extensions.values());
  }

  private async createToolFromDef(
    toolDef: ToolDefinition,
    baseDir: string
  ): Promise<Tool> {
    // Create executor based on executable.type
    const executor = await this.createExecutor(toolDef.executable, baseDir);
    
    return {
      id: toolDef.id,
      name: toolDef.name,
      description: toolDef.description,
      inputSchema: toolDef.inputSchema,
      execute: executor,
      metadata: {
        dependencies: toolDef.dependencies || [],
        maxConcurrency: toolDef.maxConcurrency || 10,
        timeout: toolDef.timeout || 30000,
        retryPolicy: toolDef.retryPolicy,
        permissions: toolDef.permissions || []
      }
    };
  }

  private async createExecutor(
    config: ExecutableConfig,
    baseDir: string
  ): Promise<(input: Record<string, any>) => Promise<any>> {
    switch (config.type) {
      case 'node': {
        // Dynamic require/import from baseDir/config.path
        const mod = await import(resolve(baseDir, config.path));
        const handler = mod[config.handler];
        return handler;
      }
      case 'python': {
        // Shell out to python subprocess
        return async (input) => {
          // Execute via child_process
        };
      }
      case 'http': {
        // POST to endpoint
        return async (input) => {
          const resp = await fetch(config.endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input)
          });
          return resp.json();
        };
      }
    }
  }

  private async parseManifest(path: string): Promise<ExtensionManifest> {
    const content = await fs.promises.readFile(path, 'utf-8');
    if (path.endsWith('.yml') || path.endsWith('.yaml')) {
      return YAML.parse(content);
    } else {
      return JSON.parse(content);
    }
  }

  private async validateManifest(manifest: ExtensionManifest): Promise<void> {
    // Validate required fields, schema, circular dependencies
    if (!manifest.name || !manifest.version) {
      throw new Error('Manifest missing required fields: name, version');
    }
    
    // Check for circular tool dependencies
    const graph = this.buildDependencyGraph(manifest.tools);
    if (this.hasCycle(graph)) {
      throw new Error('Tool dependencies contain cycles');
    }
  }
}
```

### Files to Create (Phase 3.1)

```
packages/agent/src/extensions/
  ├── ExtensionRegistry.ts              [180 lines, main class]
  ├── ExtensionManifest.ts              [100 lines, types + parser]
  ├── ExecutableConfig.ts               [120 lines, executor factories]
  ├── __tests__/
  │   ├── ExtensionRegistry.test.ts     [250 lines, unit tests]
  │   └── fixtures/
  │       └── my-extension/
  │           ├── extension.yml
  │           └── lib/
  │               └── sample-tool.js
```

---

## Phase 3.2: Persistent Storage (SQLite)

### Design: SessionRepository

```typescript
// packages/agent/src/persistence/SessionRepository.ts

interface StoredSession {
  sessionId: string;
  createdAt: Date;
  updatedAt: Date;
  messages: StoredMessage[];
  metadata: Record<string, any>;
}

interface StoredMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: Date;
  metadata?: {
    toolId?: string;
    toolInput?: Record<string, any>;
    toolOutput?: any;
    modelName?: string;
    finishReason?: string;
  };
}

class SessionRepository {
  private db: Database;

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath);
    this.runMigrations();
  }

  async saveSession(session: Session): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO sessions (session_id, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?)
    `);
    
    stmt.run(
      session.id,
      session.createdAt.toISOString(),
      new Date().toISOString(),
      JSON.stringify(session.metadata)
    );

    // Insert messages
    const msgStmt = this.db.prepare(`
      INSERT INTO messages (session_id, message_id, role, content, timestamp, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const msg of session.messages) {
      msgStmt.run(
        session.id,
        msg.id,
        msg.role,
        msg.content,
        msg.timestamp.toISOString(),
        JSON.stringify(msg.metadata || {})
      );
    }
  }

  async getSession(sessionId: string): Promise<StoredSession | null> {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions WHERE session_id = ?
    `);
    
    const row = stmt.get(sessionId) as any;
    if (!row) return null;

    const msgStmt = this.db.prepare(`
      SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC
    `);
    
    const messages = msgStmt.all(sessionId) as any[];

    return {
      sessionId: row.session_id,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      messages: messages.map(m => ({
        id: m.message_id,
        role: m.role,
        content: m.content,
        timestamp: new Date(m.timestamp),
        metadata: JSON.parse(m.metadata || '{}')
      })),
      metadata: JSON.parse(row.metadata || '{}')
    };
  }

  async listSessions(limit = 50, offset = 0): Promise<StoredSession[]> {
    // SELECT with LIMIT, ORDER BY updated_at DESC
  }

  async deleteSession(sessionId: string): Promise<void> {
    // Cascade delete: sessions + messages
  }

  private runMigrations(): void {
    // V1: Create sessions, messages tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
        message_id TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        UNIQUE(session_id, message_id)
      );

      CREATE INDEX idx_messages_session_id ON messages(session_id);
      CREATE INDEX idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX idx_sessions_updated_at ON sessions(updated_at);
    `);
  }
}
```

### Files to Create (Phase 3.2)

```
packages/agent/src/persistence/
  ├── SessionRepository.ts              [200 lines, main class]
  ├── RunArtifactStore.ts               [150 lines, logs/traces/results]
  ├── migrations/
  │   ├── 001_initial_schema.sql
  │   └── 002_add_indexes.sql
  └── __tests__/
      └── SessionRepository.test.ts     [200 lines, CRUD tests]
```

---

## Phase 3.3: Multi-Framework Adapters

### Design: LangGraphRuntime

LangGraph (from LangChain) is a state-machine graph framework. Adapter pattern maps LangGraph execution to RuntimeExecutor:

```typescript
// packages/agent/src/runtime/LangGraphRuntime.ts

import { Graph, StateGraph } from '@langchain/langgraph';

interface LangGraphSettings {
  graphConfig: StateGraph;
  modelName: string;
  timeout?: number;
}

export class LangGraphRuntime extends BaseAgentRuntime {
  private graph: Graph;
  
  constructor(
    private settings: LangGraphSettings,
    private eventBus: RuntimeEventBus
  ) {
    super();
    this.graph = settings.graphConfig.compile();
  }

  async run(input: RunInput): Promise<void> {
    const startTime = Date.now();
    
    this.eventBus.emit('run_started', {
      timestamp: new Date(),
      input
    });

    try {
      // LangGraph runs as state transitions + tool calls
      const state = { messages: [{ role: 'user', content: input.query }] };
      
      for await (const event of this.graph.stream(state, {
        streamMode: 'updates'
      })) {
        // Event = { node_id: string, updates: Record<string, any> }
        if (event.updates.messages) {
          const msg = event.updates.messages[0];
          
          if (msg.type === 'ai') {
            this.eventBus.emit('model_event', {
              timestamp: new Date(),
              content: msg.content
            });
          } else if (msg.type === 'tool') {
            // Tool call detected
            this.eventBus.emit('tool_call', {
              timestamp: new Date(),
              toolId: msg.tool_name,
              input: msg.tool_input
            });
          }
        }
      }

      this.eventBus.emit('run_completed', {
        timestamp: new Date(),
        duration: Date.now() - startTime
      });
    } catch (error) {
      this.eventBus.emit('run_failed', {
        timestamp: new Date(),
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
```

### Files to Create (Phase 3.3)

```
packages/agent/src/runtime/
  ├── LangGraphRuntime.ts               [150 lines]
  ├── VercelAiRuntime.ts                [140 lines]
  ├── MastraRuntime.ts                  [120 lines, low priority]
  └── __tests__/
      └── LangGraphRuntime.integration.test.ts [200 lines]
```

---

## Phase 3.4: Tool Coordination (Dependencies & Topological Sort)

### Design: DependencyGraph + TopologicalSort

```typescript
// packages/agent/src/runtime/toolExecution/DependencyGraph.ts

class DependencyGraph {
  private graph: Map<string, Set<string>> = new Map(); // toolId → dependencies

  addTool(toolId: string, dependencies: string[] = []): void {
    if (!this.graph.has(toolId)) {
      this.graph.set(toolId, new Set());
    }
    for (const dep of dependencies) {
      this.graph.get(toolId)!.add(dep);
    }
  }

  // Kahn's algorithm for topological sort
  topologicalSort(toolIds: string[]): string[] {
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    // Build adjacency list
    for (const toolId of toolIds) {
      if (!inDegree.has(toolId)) inDegree.set(toolId, 0);
      if (!adj.has(toolId)) adj.set(toolId, []);

      const deps = this.graph.get(toolId) || new Set();
      inDegree.set(toolId, deps.size);

      for (const dep of deps) {
        if (!adj.has(dep)) adj.set(dep, []);
        adj.get(dep)!.push(toolId);
      }
    }

    const queue: string[] = [];
    for (const [toolId, degree] of inDegree) {
      if (degree === 0) queue.push(toolId);
    }

    const result: string[] = [];
    while (queue.length > 0) {
      const toolId = queue.shift()!;
      result.push(toolId);

      for (const neighbor of adj.get(toolId) || []) {
        inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
        if (inDegree.get(neighbor) === 0) {
          queue.push(neighbor);
        }
      }
    }

    if (result.length !== toolIds.length) {
      throw new Error('Tool dependencies contain a cycle');
    }

    return result;
  }

  hasCycle(toolIds: string[]): boolean {
    try {
      this.topologicalSort(toolIds);
      return false;
    } catch {
      return true;
    }
  }
}
```

### Files to Create (Phase 3.4)

```
packages/agent/src/runtime/toolExecution/
  ├── DependencyGraph.ts                [100 lines]
  ├── RateLimiter.ts                    [120 lines, token bucket per tool]
  ├── PermissionValidator.ts            [150 lines, capability checks]
  └── __tests__/
      └── DependencyGraph.test.ts       [150 lines]
```

---

## Phase 3.5: Observability & UI Integration

### Design: ExecutionTimeline

```typescript
// packages/agent/src/runtime/observability/ExecutionTimeline.ts

interface TimelineEvent {
  id: string;
  type: 'tool_start' | 'tool_end' | 'tool_error' | 'model_start' | 'model_end';
  toolId?: string;
  timestamp: Date;
  duration?: number; // ms
  metadata?: Record<string, any>;
}

class ExecutionTimeline {
  private events: TimelineEvent[] = [];

  recordToolStart(toolId: string): string {
    const id = crypto.randomUUID();
    this.events.push({
      id,
      type: 'tool_start',
      toolId,
      timestamp: new Date()
    });
    return id;
  }

  recordToolEnd(eventId: string, result: any): void {
    const event = this.events.find(e => e.id === eventId);
    if (event) {
      event.type = 'tool_end';
      event.duration = Date.now() - event.timestamp.getTime();
      event.metadata = { result };
    }
  }

  getTimeline(): TimelineEvent[] {
    return [...this.events];
  }

  toJSON() {
    return this.events.map(e => ({
      ...e,
      timestamp: e.timestamp.toISOString()
    }));
  }
}
```

### Emit Timeline to Renderer

```typescript
// In EmbeddedExecutionKernel or any native harness executor
import { ExecutionTimeline } from './observability/ExecutionTimeline';

class EmbeddedExecutionKernel extends BaseAgentRuntime {
  private timeline = new ExecutionTimeline();

  async executeToolCalls(toolCalls: ToolCall[]): Promise<void> {
    for (const toolCall of toolCalls) {
      const timelineId = this.timeline.recordToolStart(toolCall.toolId);
      
      try {
        const result = await this.toolExecutor.execute(toolCall);
        this.timeline.recordToolEnd(timelineId, result);
        
        // Emit to UI
        this.eventBus.emit('timeline_update', {
          timeline: this.timeline.toJSON()
        });
      } catch (error) {
        // Record error...
      }
    }
  }
}
```

### Files to Create (Phase 3.5)

```
packages/agent/src/runtime/observability/
  ├── ExecutionTimeline.ts              [100 lines]
  ├── MetricsCollector.ts               [150 lines, latency/success rate]
  ├── TraceStore.ts                     [130 lines, structured logs]
  └── __tests__/
      └── ExecutionTimeline.test.ts     [120 lines]

apps/telegraph/src/services/agent/observability/
  └── UIBridgeEmitter.ts                [100 lines, forward timeline to renderer]
```

---

## Implementation Roadmap

### Phase 3.1 (Week 1): Extension Framework
- [ ] ExtensionRegistry + manifest parser
- [ ] Tool loader from extension.yml
- [ ] Unit tests for manifest validation
- [ ] Extension directory scanning

### Phase 3.2 (Week 2): SQLite Persistence
- [ ] SessionRepository with CRUD
- [ ] Migrations + schema
- [ ] Session recovery on startup
- [ ] Replace in-memory SessionStore

### Phase 3.3 (Week 3): Multi-Framework Adapters
- [ ] LangGraphRuntime scaffold
- [ ] VercelAiRuntime scaffold
- [ ] Framework dispatch in createRuntime()
- [ ] Integration tests

### Phase 3.4 (Week 4): Tool Coordination
- [ ] DependencyGraph + topological sort
- [ ] Rate limiter per tool
- [ ] Permission validator
- [ ] Circular dependency detection

### Phase 3.5 (Week 5): Observability
- [ ] ExecutionTimeline data structure
- [ ] MetricsCollector integration
- [ ] UI bridge emitter
- [ ] Renderer UI for timeline

---

## Key Decisions

### Extension Manifest Format: YAML > JSON
- **Pro**: Human-readable, less quote overhead, comments supported
- **Con**: Requires YAML parser (lightweight)
- **Decision**: Support both; prefer YAML for documentation

### Persistence: SQLite > PostgreSQL
- **Pro**: Zero-config, embedded, single file, great for desktop
- **Con**: Single-writer, file-based
- **Decision**: SQLite for Phase 3; can migrate to PostgreSQL in Phase 4 if needed

### Tool Executor Types: Node + HTTP > Python + Binary
- **Pro**: Node (native in Electron), HTTP (language-agnostic via webhooks)
- **Con**: Python/binary require system setup
- **Decision**: Implement Node + HTTP in Phase 3.1; defer Python to Phase 3.2

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Extension code injection | Critical | Validate manifest schema, sandbox execution, permission system |
| SQLite locking in multi-process | High | Use `WAL` mode, connection pooling, async queries |
| Circular tool dependencies | Medium | Detect in manifest validation, topological sort before execution |
| LangGraph API churn | Medium | Wrap LangGraph calls in adapter, version compatibility matrix |

---

## Success Criteria

- [x] Architecture document complete (this file)
- [ ] Phase 3.1: Extension registry working, 10 unit tests passing
- [ ] Phase 3.2: SQLite repo passing CRUD tests, session recovery working
- [ ] Phase 3.3: LangGraphRuntime compiles, adapter pattern proven
- [ ] Phase 3.4: Circular dependency detection working, topological sort tested
- [ ] Phase 3.5: Timeline events flowing to renderer, UI displays tool execution chart

---

## References

- **A-005**: Telegraph Agent Runtime Extension Host Theory
- **P-002**: Agent Runtime Extension Host Phase Gates
- **D-002**: IPC Trace Channel Separation
- **D-003**: Phase 2 Pi-Embedded Design
