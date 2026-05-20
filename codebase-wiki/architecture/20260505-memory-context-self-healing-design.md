# Memory, Context, and Self-Healing System Design

**Document ID**: A-007  
**Date**: 2026-05-05  
**Status**: DESIGN (Phase 4-5 Vision)  
**Scope**: Session storage evolution from Phase 3 to Phase 5+

---

> 2026-05-20 对齐注记：本文中出现的 `PiEmbeddedRuntime` 仅作为历史示例名称。
> 新分层中应理解为 Telegraph Native Harness 下的 Embedded Execution Kernel。
> 详见 [D-015](../discussion/20260520-agent-runtime-product-layer-alignment.md)。

## Part 1: Memory Hierarchy & Retention Strategy

### 1.1 Current State (Phase 3)

**Phase 3.2 SessionRepository**: File-based JSON storage
- **Scope**: Single conversation thread per session
- **Granularity**: Message-level (role, content, metadata, timestamp)
- **Retention**: Forever (manual deletion only)
- **Access Pattern**: Linear retrieval (full session load)

```typescript
// Phase 3.2: Simple message history
interface StoredSession {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  messages: Array<{
    role: 'user' | 'assistant' | 'tool';
    content: string;
    ts: number;
    metadata?: Record<string, any>;
  }>;
  metadata: Record<string, any>;
}
```

### 1.2 Multi-Tier Memory Architecture (Phase 4-5 Vision)

Telegraph should evolve to a **tiered memory system** inspired by human cognition:

```
┌─────────────────────────────────────────────────────┐
│                   WORKING MEMORY                     │
│  (Current conversation state - 1-2 KB, hot)         │
│  - Current turn's context                           │
│  - Last 3-5 messages                                │
│  - Active tool calls                                │
│  - Shared variables (session state)                 │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│                  SHORT-TERM MEMORY                   │
│  (Recent conversation - 10-50 KB, warm)             │
│  - Last 20-50 messages                              │
│  - Recent tool results                              │
│  - User preferences from this session               │
│  - Execution decisions made this session            │
│  **TTL**: 24 hours (session timeout)                │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│                 MEDIUM-TERM MEMORY                   │
│  (Consolidated history - 100 KB-1 MB, warm)        │
│  - Summarized conversation arcs                     │
│  - Extracted facts/decisions                        │
│  - Cross-session user patterns                      │
│  - Tool execution analytics                         │
│  **TTL**: 30 days (rolling window)                  │
│  **Storage**: SQLite with compression               │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│                  LONG-TERM MEMORY                    │
│  (Persistent knowledge - Unbounded, cold)          │
│  - User profiles / preferences                      │
│  - Knowledge base / fact store                      │
│  - Learned patterns (ML-backed)                     │
│  - Audit trail / compliance log                     │
│  **TTL**: None (or purge by policy)                 │
│  **Storage**: PostgreSQL + Vector DB                │
│  **Indexing**: Vector embeddings for semantic search│
└─────────────────────────────────────────────────────┘
```

### 1.3 Implementation Roadmap

**Phase 4.1**: Introduce Medium-Term Memory
```typescript
interface ConversationArc {
  arcId: string;
  sessionIds: string[]; // Sessions in this arc
  summary: string; // LLM-generated
  keyDecisions: string[];
  startTs: number;
  endTs: number;
  embedding: number[]; // For semantic search
  metadata: Record<string, any>;
}

interface UserProfile {
  userId: string;
  preferences: Record<string, any>;
  communicationStyle: string;
  knownTools: string[]; // Tools user regularly uses
  skillLevel: 'novice' | 'intermediate' | 'expert';
  lastUpdated: number;
}
```

**Phase 4.2**: Add Long-Term Memory with Vector Store
```typescript
interface KnowledgeEntry {
  id: string;
  text: string;
  type: 'fact' | 'rule' | 'pattern' | 'error_recovery';
  source: string; // Which session/arc learned this?
  embedding: number[];
  confidence: number; // 0-1, based on consistency
  linkedEntries: string[]; // Other entries that reference this
  createdAt: number;
  lastValidated: number;
}
```

### 1.4 Memory Access Patterns

```typescript
// Working memory: instant access
async getWorkingMemory(sessionId: string): Promise<Message[]>
  // Returns last N messages (N=5), with no latency

// Short-term: single session fetch
async getShortTermMemory(sessionId: string): Promise<StoredSession>
  // Returns full session (file read, < 50ms)

// Medium-term: cross-session arc
async getMediumTermMemory(userId: string, days: number): Promise<ConversationArc[]>
  // Returns summarized conversation arcs (SQLite query, < 200ms)

// Long-term: semantic search
async searchLongTermMemory(userId: string, query: string, topK: number): Promise<KnowledgeEntry[]>
  // Vector similarity search (vector DB, < 500ms)
```

---

## Part 2: Context Injection & Expansion Strategy

### 2.1 Context Window Problem

**Current LLM Limits** (as of 2024):
- GPT-4 Turbo: 128K tokens
- Claude 3 Opus: 200K tokens
- Gemini 1.5: 1M tokens

**Telegraph's Challenge**:
- User may have 100 sessions over 1 year
- Each session could be 50+ messages = 5K tokens
- Total: 500K+ tokens of raw history
- Problem: Exceeds context window or incurs massive cost

### 2.2 Context Compression Strategy

**Layer 1: Message Summarization** (Within session)
```typescript
// For sessions > 50 messages, compress older messages
interface CompressedConversationBlock {
  messages: Message[]; // Last N messages (raw)
  summaryBefore: string; // "In the previous 30 messages, user asked about X and we discussed Y"
  messagesBefore: number; // 30
  tokensSaved: number; // Original 3K tokens → 200 token summary
}

async compressSessionHistory(
  sessionId: string,
  keepLastN: number = 20
): Promise<CompressedConversationBlock> {
  // Group older messages into summary blocks
  // Use LLM to generate "context bridge"
}
```

**Layer 2: Cross-Session Extraction** (Beyond single session)
```typescript
// Extract only relevant facts/decisions from history
interface ContextualFact {
  fact: string;
  source: 'user_stated' | 'inferred' | 'system';
  relevanceScore: number; // 0-1
  linkedSessions: string[]; // Where this fact appeared
  lastConfirmed: number;
}

async extractRelevantContext(
  userId: string,
  currentQuery: string,
  maxTokens: number = 2000
): Promise<ContextualFact[]> {
  // 1. Parse current query to extract intent
  // 2. Search long-term memory for relevant facts
  // 3. Score by relevance (BM25 + semantic similarity)
  // 4. Return top K facts that fit in maxTokens
}
```

**Layer 3: Hierarchical Context Retrieval**
```typescript
interface ContextInjectionStrategy {
  strategy: 'none' | 'minimal' | 'balanced' | 'rich';
}

// 'minimal': Only last message + system prompt (< 500 tokens)
// 'balanced': Last 5 messages + 2-3 relevant facts (1K-2K tokens)
// 'rich': Full recent arc + facts + user profile (5K-10K tokens)

async buildContextPrompt(
  sessionId: string,
  strategy: ContextInjectionStrategy,
  modelContextLimit: number
): Promise<{
  workingMemory: Message[];
  contextualFacts: ContextualFact[];
  userProfile: UserProfile;
  estimatedTokens: number;
}> {
  // Build minimal sufficient context to answer query well
}
```

### 2.3 Just-In-Time Context Loading

Don't load full conversation history upfront. Instead:

```typescript
// Phase 4 approach: Lazy loading + async context
async function executeWithContext(
  sessionId: string,
  newMessage: string,
  onContextReady: (context: ContextData) => Promise<void>
) {
  // 1. Immediately get working memory (5 messages)
  const workingMem = await getWorkingMemory(sessionId);
  
  // 2. Start async fetch of contextual facts
  const contextPromise = extractRelevantContext(sessionId, newMessage);
  
  // 3. Begin model execution with working memory
  const partialResult = llm.stream({
    messages: workingMem,
    systemPrompt: BASE_SYSTEM_PROMPT
  });
  
  // 4. Inject contextual facts mid-stream (if model allows)
  contextPromise.then(facts => {
    if (facts.length > 0) {
      // Re-invoke model with enhanced context
      // or append to stream as system context
    }
  });
}
```

---

## Part 3: Self-Healing System Design

### 3.1 What is Self-Healing?

Self-healing refers to the system's ability to:
1. **Detect errors/inconsistencies**: Identify when memory is stale, inaccurate, or contradictory
2. **Validate knowledge**: Check facts against reality (re-run tools, ask user for confirmation)
3. **Auto-correct**: Update memory with accurate information
4. **Learn from failures**: Extract lessons from errors and prevent recurrence

**Example Scenarios**:
- User says "I told you my name is Alice" but session history shows "Bob"
- A tool result conflicts with cached knowledge ("user has 10 credits" but tool says "0")
- User's statement contradicts extracted fact from 2 weeks ago
- Model hallucinates a fact that contradicts long-term memory

### 3.2 Self-Healing Architecture

```
┌─────────────────────────────────────────────────────┐
│            CONSISTENCY VALIDATOR                     │
│  Runs after each model response                     │
│  - Fact-checks against long-term memory             │
│  - Detects contradictions                           │
│  - Flags uncertain claims (confidence < 0.8)        │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│         ACTIVE VERIFICATION ENGINE                   │
│  For flagged inconsistencies:                       │
│  - Ask user for confirmation                        │
│  - Re-execute tools to validate                     │
│  - Query external sources                           │
│  - Combine multiple sources for truth               │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│           MEMORY UPDATE & VERSIONING                 │
│  Atomically update with confidence score            │
│  - Track previous value                             │
│  - Record correction timestamp                      │
│  - Link to verification source                      │
│  - Increment version number                         │
└─────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────┐
│             FEEDBACK LOOP LEARNING                   │
│  Extract lessons from corrections:                  │
│  - Update model instructions                        │
│  - Adjust fact extraction confidence                │
│  - Record as "learned error pattern"                │
│  - Share across users (aggregated, privacy-aware)   │
└─────────────────────────────────────────────────────┘
```

### 3.3 Implementation Example: Fact Validation

```typescript
interface FactCheckResult {
  original: string; // Original statement
  isValid: boolean;
  confidence: number; // 0-1
  evidenceSources: string[]; // Where validation came from
  correction?: string; // If invalid, what's the correct version
  validatedAt: number;
  validator: 'tool' | 'user_confirmation' | 'external_api' | 'llm_reasoning';
}

class SelfHealingValidator {
  async validateFact(
    fact: string,
    context: { userId: string; sessionId: string }
  ): Promise<FactCheckResult> {
    // 1. Check against long-term memory
    const knownFacts = await this.searchLongTermMemory(fact);
    if (knownFacts.some(f => f.text === fact && f.confidence > 0.95)) {
      return { original: fact, isValid: true, confidence: 0.98, ... };
    }

    // 2. If uncertain, ask for user confirmation
    if (knownFacts.some(f => f.confidence < 0.7)) {
      const userConfirmed = await this.askUserForConfirmation(fact, context);
      return {
        original: fact,
        isValid: userConfirmed,
        confidence: userConfirmed ? 0.95 : 0.1,
        validator: 'user_confirmation',
        ...
      };
    }

    // 3. For data-backed facts, re-execute relevant tool
    const dataFact = this.parseAsDataFact(fact); // e.g., "user balance is $100"
    if (dataFact) {
      const toolResult = await this.executeTool(dataFact.toolId, dataFact.params);
      const extractedValue = this.extractValue(toolResult);
      const matches = this.compareValues(fact, extractedValue);
      return {
        original: fact,
        isValid: matches,
        confidence: matches ? 0.99 : 0.01,
        correction: matches ? undefined : `Actual value: ${extractedValue}`,
        validator: 'tool',
        evidenceSources: [dataFact.toolId],
        ...
      };
    }

    // 4. Otherwise, low confidence
    return {
      original: fact,
      isValid: undefined, // Unknown
      confidence: 0.3,
      validator: 'llm_reasoning',
      ...
    };
  }

  private async askUserForConfirmation(
    fact: string,
    context: { sessionId: string }
  ): Promise<boolean> {
    // Emit event to UI, wait for user response
    return this.eventBus.emitAndWait('confirmation_requested', {
      sessionId: context.sessionId,
      question: `Is this correct: "${fact}"?`
    });
  }
}
```

### 3.4 Self-Healing Workflow

```typescript
// After model generates response
async function postProcessWithSelfHealing(
  sessionId: string,
  modelResponse: string,
  memories: MemoryTier[]
) {
  // 1. Extract claims from response
  const claims = await llm.extractClaims(modelResponse);
  // ["User's balance is $500", "They have 2 open tickets", ...]

  // 2. Validate each claim
  const validations: FactCheckResult[] = [];
  for (const claim of claims) {
    const result = await validator.validateFact(claim, { sessionId });
    validations.push(result);

    // 3. If invalid, mark for correction
    if (!result.isValid && result.correction) {
      modelResponse = modelResponse.replace(claim, result.correction);
      
      // Log correction for learning
      await memoryTier.logCorrection({
        originalClaim: claim,
        correctedClaim: result.correction,
        source: result.validator,
        timestamp: Date.now()
      });
    }
  }

  // 4. Return corrected response
  return {
    response: modelResponse,
    validations,
    corrections: validations.filter(v => !v.isValid && v.correction)
  };
}
```

### 3.5 Learning from Corrections

```typescript
class SelfHealingLearner {
  async learnFromCorrection(
    originalClaim: string,
    correctedClaim: string,
    validator: string,
    context: { userId: string; sessionId: string }
  ) {
    // 1. Extract pattern from correction
    const pattern = await this.extractPattern({
      input: originalClaim,
      output: correctedClaim,
      validator
    });
    // e.g., "Model tends to round user balances; always verify with tool"

    // 2. Store as learned pattern
    await this.memoryTier.storeLearned PatternEntry({
      pattern,
      errorType: 'hallucination' | 'stale_data' | 'inconsistency',
      frequency: 1,
      validatorTypes: [validator],
      linkedCorrections: [{ original: originalClaim, corrected: correctedClaim }]
    });

    // 3. Update system instruction hints
    const currentHints = await this.getSystemPromptHints();
    const enhancedHints = this.addLessonToHints(currentHints, pattern);
    await this.updateSystemPrompt(enhancedHints);

    // 4. Aggregate learning across users (privacy-aware)
    await this.aggregateLearningStatistics({
      errorType: 'hallucination',
      frequency: 1,
      pattern: this.anonymizePattern(pattern)
    });
  }

  private anonymizePattern(pattern: object): object {
    // Remove user/session identifiers, keep structural info
    return {
      errorPattern: pattern.errorPattern,
      correctionStrategy: pattern.correctionStrategy,
      validatorType: pattern.validatorType
    };
  }
}
```

---

## Part 4: Integration with Telegraph Runtime

### 4.1 Memory Integration Points

**Phase 3 → Phase 4 Migration**:

```typescript
// Phase 3: Simple session storage
class EmbeddedExecutionKernel {
  async run(input: RuntimeInput) {
    const session = await sessionStore.getSession(input.sessionId);
    // ... execute ...
    await sessionStore.saveSession(session);
  }
}

// Phase 4: Multi-tier memory + context injection
class EmbeddedExecutionKernelV2 {
  async run(input: RuntimeInput) {
    // 1. Get working memory
    const workingMem = await memoryTier.getWorkingMemory(input.sessionId);

    // 2. Async-load contextual facts & user profile
    const contextPromise = memoryTier.extractRelevantContext(
      input.sessionId,
      input.message,
      this.getContextBudget()
    );

    // 3. Build initial context for model
    const initialContext = [
      ...workingMem,
      ...(await contextPromise)
    ];

    // 4. Execute with self-healing post-processing
    const response = await this.executeWithModel(initialContext, input.message);

    // 5. Validate and correct with self-healing
    const correctedResponse = await this.postProcessWithSelfHealing(
      input.sessionId,
      response
    );

    // 6. Update all memory tiers
    await memoryTier.updateWorkingMemory(input.sessionId, {
      userMessage: input.message,
      assistantResponse: correctedResponse.response
    });

    await memoryTier.updateShortTermMemory(input.sessionId, {
      newMessages: [
        { role: 'user', content: input.message },
        { role: 'assistant', content: correctedResponse.response }
      ]
    });

    // 7. Periodically (on session close) update medium-term
    if (this.shouldCompressSession(input.sessionId)) {
      await memoryTier.compressSessionToArc(input.sessionId);
    }
  }
}
```

### 4.2 Memory Tier Configuration

```typescript
interface MemoryTierConfig {
  workingMemory: {
    maxMessages: number; // 3-5
    ttl: number; // None (per-run only)
    storage: 'memory';
  };
  shortTermMemory: {
    maxSessions: number; // 1000
    maxMessagesPerSession: number; // 100
    ttl: 86400000; // 24 hours
    storage: 'file' | 'sqlite';
    compression: {
      enabled: boolean;
      threshold: number; // Compress if > 50 messages
      algorithm: 'llm_summary';
    };
  };
  mediumTermMemory: {
    arcDuration: number; // 86400000 * 30 (30 days)
    maxArcs: number; // Unlimited
    ttl: 86400000 * 30; // 30 days
    storage: 'sqlite';
    indexing: {
      enabled: boolean;
      type: 'bm25' | 'vector';
    };
  };
  longTermMemory: {
    ttl: null; // Unlimited
    storage: 'postgresql' | 'vector_db';
    indexing: {
      type: 'vector';
      model: 'openai:text-embedding-3-large';
      refreshInterval: 604800000; // Weekly
    };
    confidenceThreshold: 0.7; // Only store high-confidence facts
  };
}
```

### 4.3 Storage Schema Evolution

**Phase 3 (Current)**:
```sql
-- sessions (file-based JSON)
sessions/
  └── {sessionId}.json

-- messages embedded in session
{
  "messages": [
    { "role": "user", "content": "...", "ts": ... }
  ]
}
```

**Phase 4 (Medium-term + Self-Healing)**:
```sql
-- SQLite schema
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  compressed_at TIMESTAMP,
  status TEXT, -- 'active', 'closed', 'archived'
  metadata JSONB
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  session_id TEXT REFERENCES sessions,
  role TEXT,
  content TEXT,
  ts TIMESTAMP,
  metadata JSONB,
  validated_at TIMESTAMP,
  validation_status TEXT -- 'unchecked', 'valid', 'invalid'
);

CREATE TABLE conversation_arcs (
  arc_id TEXT PRIMARY KEY,
  user_id TEXT,
  session_ids TEXT[], -- JSON array
  summary TEXT,
  summary_embedding VECTOR(1536),
  key_decisions TEXT[],
  start_ts TIMESTAMP,
  end_ts TIMESTAMP,
  confidence FLOAT,
  created_at TIMESTAMP
);

CREATE TABLE knowledge_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  text TEXT,
  type TEXT, -- 'fact', 'rule', 'pattern'
  embedding VECTOR(1536),
  confidence FLOAT,
  version INT,
  validated_at TIMESTAMP,
  created_at TIMESTAMP,
  UNIQUE(user_id, text, version)
);

CREATE TABLE fact_validations (
  id TEXT PRIMARY KEY,
  knowledge_entry_id TEXT REFERENCES knowledge_entries,
  original_claim TEXT,
  corrected_claim TEXT,
  validator TEXT, -- 'tool', 'user', 'external_api'
  confidence FLOAT,
  created_at TIMESTAMP,
  expires_at TIMESTAMP -- Auto-revalidate if stale
);

CREATE TABLE learned_patterns (
  id TEXT PRIMARY KEY,
  pattern JSONB,
  error_type TEXT,
  frequency INT,
  last_occurrence TIMESTAMP,
  prevention_strategy JSONB,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Indexes
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_messages_session_id ON messages(session_id);
CREATE INDEX idx_knowledge_user_id ON knowledge_entries(user_id);
CREATE INDEX idx_conversation_arcs_embedding ON conversation_arcs USING ivfflat(summary_embedding);
CREATE INDEX idx_knowledge_embedding ON knowledge_entries USING ivfflat(embedding);
```

**Phase 5 (Full Long-Term Memory)**:
```sql
-- PostgreSQL + Vector DB (Pinecone/Weaviate)

-- Core tables (PostgreSQL)
CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  profile JSONB, -- preferences, communication style, etc.
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE TABLE knowledge_base (
  entry_id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users,
  text TEXT,
  type TEXT,
  source TEXT, -- session, arc, tool, external
  confidence FLOAT,
  version INT,
  validated_at TIMESTAMP,
  created_at TIMESTAMP
);

-- Vector DB (external service)
-- Stores embeddings + metadata for semantic search
-- Queries: vector_db.search(query_embedding, topK=10, user_id=...)
```

---

## Part 5: Privacy & Security Considerations

### 5.1 Data Sensitivity Levels

```typescript
enum DataSensitivity {
  PUBLIC = 0,           // Shareable across users
  INTERNAL = 1,         // Shareable within organization
  USER_SPECIFIC = 2,    // Single user only
  PERSONALLY_IDENTIFYING = 3, // PII: name, email, phone
  FINANCIAL = 4,        // Payment info, balances
  MEDICAL = 5,          // Health data
  BIOMETRIC = 6         // Fingerprint, voice, etc.
}

interface MemoryEntry {
  content: string;
  sensitivity: DataSensitivity;
  encryptionKey?: string;
  ownerUserId: string;
  shareableWith?: string[]; // Other user IDs with access
  retentionPolicy: {
    ttl: number;
    deleteWhenEmpty: boolean; // Delete if conversation ends
    archiveAfter: number;
  };
}
```

### 5.2 Encryption & Access Control

```typescript
class SecureMemoryTier {
  async storeSecurely(
    entry: MemoryEntry,
    accessControl: { owner: string; readers?: string[] }
  ) {
    // 1. Encrypt high-sensitivity data
    if (entry.sensitivity >= DataSensitivity.PERSONALLY_IDENTIFYING) {
      entry.content = await this.encryptAES256(
        entry.content,
        await this.deriveKey(accessControl.owner)
      );
    }

    // 2. Store with access metadata
    const stored = {
      ...entry,
      owner: accessControl.owner,
      readers: accessControl.readers || [],
      encryptedAt: Date.now(),
      encryptionVersion: 1
    };

    // 3. Audit log
    await this.auditLog.record({
      action: 'store',
      entryId: entry.id,
      owner: accessControl.owner,
      sensitivity: entry.sensitivity,
      timestamp: Date.now()
    });
  }

  async retrieveSecurely(entryId: string, requesterUserId: string) {
    const entry = await this.getEntry(entryId);

    // 1. Check access
    if (!this.canAccess(entry, requesterUserId)) {
      throw new AccessDeniedError(`User ${requesterUserId} cannot access ${entryId}`);
    }

    // 2. Decrypt if necessary
    if (entry.encryptedAt) {
      entry.content = await this.decryptAES256(
        entry.content,
        await this.deriveKey(entry.owner)
      );
    }

    // 3. Audit log
    await this.auditLog.record({
      action: 'retrieve',
      entryId,
      requester: requesterUserId,
      sensitivity: entry.sensitivity,
      timestamp: Date.now()
    });

    return entry;
  }
}
```

### 5.3 Anonymization for Learning

When aggregating learned patterns across users:

```typescript
class PrivacyPreservingLearner {
  async aggregateLearningAcrossUsers(
    corrections: Array<{ userId: string; pattern: object }>
  ) {
    // 1. Remove all user identifiers
    const anonymized = corrections.map(c => ({
      ...c.pattern,
      userId: this.hash(c.userId), // One-way hash for deduplication
      sourceAggregated: true
    }));

    // 2. Keep only structural info
    const structural = anonymized.map(a => ({
      errorType: a.errorType,
      correctionStrategy: a.correctionStrategy,
      frequency: a.frequency
    }));

    // 3. Store as aggregate statistics
    return this.persistAggregateStatistics(structural);
  }
}
```

---

## Part 6: Phased Implementation Plan

### Phase 4 (Months 1-2): Medium-Term Memory + Self-Healing Basics

**Goals**:
- [ ] Implement conversation arc summarization
- [ ] Implement fact validation engine (tool-based)
- [ ] Implement basic user-confirmation flow
- [ ] Add SQLite for medium-term storage
- [ ] Integrate context compression

**Deliverables**:
- `ConversationArcService.ts` (250 lines)
- `SelfHealingValidator.ts` (300 lines)
- `FactCheckEngine.ts` (200 lines)
- Updated `SessionRepository` with compression
- Integration tests (400 lines)

**Files**:
```
packages/agent/src/memory/
  ├── MemoryTierManager.ts          [250 lines]
  ├── ConversationArcService.ts     [250 lines]
  ├── FactValidationEngine.ts       [200 lines]
  ├── SelfHealingValidator.ts       [300 lines]
  └── __tests__/
      ├── MemoryTierManager.test.ts [300 lines]
      └── SelfHealingValidator.test.ts [400 lines]
```

### Phase 4.5 (Months 2-3): Vector Indexing & Semantic Search

**Goals**:
- [ ] Integrate vector embeddings (OpenAI or self-hosted)
- [ ] Implement semantic search for medium-term memory
- [ ] Add BM25 hybrid search (keyword + semantic)
- [ ] Cache popular queries/results

**Deliverables**:
- `VectorEmbeddingService.ts` (150 lines)
- `SemanticSearchEngine.ts` (200 lines)
- Vector DB integration (Pinecone/Weaviate/Milvus)

### Phase 5 (Months 3-4): Long-Term Memory + Advanced Learning

**Goals**:
- [ ] Migrate to PostgreSQL + Vector DB
- [ ] Implement learned pattern extraction
- [ ] Add system prompt auto-tuning based on patterns
- [ ] Privacy-preserving aggregation across users
- [ ] Advanced fact validation (external APIs)

**Deliverables**:
- `LongTermMemoryService.ts` (300 lines)
- `LearnedPatternExtractor.ts` (250 lines)
- `PrivacyPreservingAggregator.ts` (200 lines)
- Migration scripts

### Phase 5.5 (Months 4-5): Self-Healing Autonomous Correction

**Goals**:
- [ ] Auto-correction without user intervention for high-confidence cases
- [ ] Multi-source validation (tool + external API + ML ensemble)
- [ ] Automatic revalidation of stale facts
- [ ] Real-time consistency monitoring

**Deliverables**:
- `AutonomousCorrectionEngine.ts` (300 lines)
- `MultiSourceValidator.ts` (250 lines)
- Enhanced monitoring/observability

---

## Part 7: Example: End-to-End Self-Healing Flow

### Scenario: User Statement vs. Cached Knowledge

```
User: "I have 5 open tickets"

Memory State (from previous session 5 days ago):
  - Long-term fact: "User has 3 open tickets" (confidence: 0.8)
  - Last tool check: 5 days ago

Self-Healing Flow:
  1. DETECTION: Model extracts claim "I have 5 open tickets"
  2. VALIDATION: Validator finds contradiction
     - Checks long-term memory: "3 open tickets"
     - Confidence mismatch: user says 5, memory says 3
  3. ACTIVE VERIFICATION: Trigger tool execution
     - Call tickets_api.list(user_id=X)
     - Result: 5 open tickets (matches user!)
  4. CORRECTION: Update memory
     - Update fact: "5 open tickets" (confidence: 0.99)
     - Record: "Previous value was stale (5 days old)"
     - Link: correction source = 'tickets_api'
  5. LEARNING:
     - Log pattern: "Tool data gets stale within 5 days"
     - Add reminder: "Validate ticket count tool every 3 days"
     - Update system prompt hint: "Always verify ticket counts"

Result: Model accepts user's claim, memory is corrected, future queries 
        will be more accurate and include "last validated X days ago"
```

### Code Implementation:

```typescript
async function handleUserStatementWithSelfHealing(
  sessionId: string,
  userId: string,
  userStatement: string
): Promise<{
  response: string;
  corrections: FactCheckResult[];
  learnings: LearnedPattern[];
}> {
  // 1. Extract claims
  const claims = await claimExtractor.extract(userStatement);
  // ["I have 5 open tickets"]

  // 2. Check against long-term memory
  const memoryFacts = await longTermMemory.search(claims[0], userId);
  // [{ text: "3 open tickets", confidence: 0.8, age: 5 days }]

  // 3. Detect contradiction
  if (this.isContradictory(claims[0], memoryFacts[0])) {
    // 4. Active verification
    const toolResult = await ticketsAPI.listOpenTickets(userId);
    const extractedCount = toolResult.tickets.length; // 5

    // 5. Determine truth
    const userIsCorrect = extractedCount === 5;
    
    // 6. Update memory
    await longTermMemory.updateFact(
      {
        text: `${extractedCount} open tickets`,
        confidence: 0.99,
        validator: 'tickets_api',
        previousValue: "3 open tickets",
        validatedAt: Date.now()
      },
      userId
    );

    // 7. Learn from correction
    if (!userIsCorrect) {
      // User was wrong, we corrected them
      const learning = {
        pattern: "User may provide stale information",
        correction_frequency: "After tool validation",
        prevention: "Always validate user claims about counts"
      };
      await learnedPatternStore.record(learning);
    } else {
      // User was right, memory was stale
      const learning = {
        pattern: "Long-term facts become stale within 5 days",
        solution: "Revalidate ticket counts more frequently",
        suggested_interval: 259200000 // 3 days
      };
      await learnedPatternStore.record(learning);
    }
  }

  // 8. Return response with self-healed facts
  return {
    response: `You're right, you have ${extractedCount} open tickets.`,
    corrections: [
      {
        original: "3 open tickets (from memory)",
        corrected: `${extractedCount} open tickets (from API)`,
        validator: 'tickets_api'
      }
    ],
    learnings: [
      { pattern: "Long-term facts become stale", interval: 259200000 }
    ]
  };
}
```

---

## Part 8: Comparison Table: Phase 3 vs. Phase 4 vs. Phase 5

| Feature | Phase 3 | Phase 4 | Phase 5 |
|---------|---------|---------|---------|
| **Working Memory** | Last 3-5 messages | Last 3-5 messages | Last 3-5 messages (optimized) |
| **Short-Term Storage** | File JSON | File JSON (compressed) | SQLite |
| **Medium-Term Storage** | None | SQLite + arcs | SQLite + arcs |
| **Long-Term Storage** | None | None | PostgreSQL + Vector DB |
| **Memory Tiers** | 2 | 4 | 4+ |
| **Fact Validation** | None | Tool-based | Multi-source |
| **Self-Healing** | None | Basic (user confirm) | Autonomous |
| **Context Injection** | Full session | Selective (JIT) | Compressed + relevant facts |
| **Privacy** | Basic | Sensitivity levels | Encryption + audit |
| **Learning** | None | Pattern collection | Autonomous optimization |
| **Latency** | < 100ms | < 500ms | < 1000ms (async) |
| **Storage Size** | 1MB / 100 messages | 100MB / 10K sessions | 10GB+ (unlimited) |

---

## Conclusion & Roadmap

Telegraph's storage architecture should evolve as:

1. **Phase 3** (Current): Simple, local, per-session storage
   - Fast, predictable, suitable for MVP

2. **Phase 4** (Next): Multi-tier with self-healing basics
   - Enables better context retention + early error correction

3. **Phase 5**: Full long-term memory with autonomous learning
   - Model becomes progressively smarter per user
   - System learns from every interaction
   - Self-healing becomes proactive, not reactive

**Key Principles**:
- **Tiered storage**: Working → Short → Medium → Long term
- **Context compression**: Fit more history into token budget
- **Active validation**: Detect and correct errors automatically
- **Privacy-first**: Encrypt sensitive data, anonymize aggregate learning
- **Autonomous learning**: System improves without explicit feedback

This design positions Telegraph as not just a runtime host, but a **continually improving agent execution system** that learns from experience and self-corrects.
