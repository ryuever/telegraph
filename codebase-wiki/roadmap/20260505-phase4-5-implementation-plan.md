# Phase 4-5 Implementation Roadmap: Memory, Context & Self-Healing

**Document ID**: P-006  
**Date**: 2026-05-05  
**Status**: PLANNING  
**Scope**: 5-6 months (Phase 4 + Phase 5)  
**Effort**: ~3000-4000 lines of code + infrastructure

---

## Executive Summary

Telegraph's storage architecture should evolve through **two major phases** to enable progressive enhancement:

- **Phase 4** (Months 1-3): Multi-tier memory + basic self-healing
- **Phase 5** (Months 4-6): Long-term memory + autonomous learning

This roadmap balances **immediate utility** (Phase 4 delivers value quickly) with **long-term vision** (Phase 5 enables truly autonomous self-improving agents).

---

## Phase 4: Multi-Tier Memory & Active Validation

### 4.1 Scope & Goals

**Timeline**: 8-12 weeks (concurrent with Phase 3.3b-3.4)

**Goals**:
1. ✅ Introduce conversation arc summarization (medium-term memory)
2. ✅ Implement fact validation engine with tool-based checks
3. ✅ Add context compression for long conversations
4. ✅ Integrate user-confirmation flow for uncertain facts
5. ✅ Migrate short-term storage from file to SQLite (optional)
6. ✅ Establish self-healing post-processing pipeline

**Success Criteria**:
- [ ] Context window efficiency improved by 30-50% (same info, fewer tokens)
- [ ] Fact validation accuracy > 90% (verified against tool results)
- [ ] Self-healing catches > 80% of detectable hallucinations
- [ ] User confirmation response time < 2 seconds
- [ ] Zero regression in existing Phase 2-3 functionality

### 4.2 Implementation Breakdown

#### 4.2.1 Memory Tier Manager

```typescript
// packages/agent/src/memory/MemoryTierManager.ts

class MemoryTierManager {
  // Manage multi-tier access, compression, archival
  
  async getWorkingMemory(sessionId: string, lastN: number = 5): Message[] {
    // Fast path: last N messages from in-memory cache
    // < 10ms latency
  }

  async getShortTermMemory(sessionId: string): StoredSession {
    // Single session: file or SQLite
    // < 50ms latency
    // Optional: apply compression if > 50 messages
  }

  async getMediumTermMemory(
    userId: string,
    lookbackDays: number = 30
  ): ConversationArc[] {
    // Summarized conversation arcs
    // < 200ms latency
    // SQLite query with arc summaries
  }

  async compressSessionHistory(
    sessionId: string,
    keepLastN: number = 20
  ): CompressedSession {
    // Older messages → LLM summary
    // Keep last N messages raw
    // Estimate token savings
  }

  async extractRelevantContext(
    sessionId: string,
    newQuery: string,
    maxTokens: number = 2000
  ): ContextualFact[] {
    // BM25 search on historical facts
    // Filter by relevance score
    // Fit within token budget
  }
}
```

**Files to Create**:
- `packages/agent/src/memory/MemoryTierManager.ts` (250 lines)
- `packages/agent/src/memory/types.ts` (100 lines: interfaces)

**Tests**:
- `packages/agent/src/memory/__tests__/MemoryTierManager.test.ts` (300 lines)

#### 4.2.2 Conversation Arc Service

```typescript
// packages/agent/src/memory/ConversationArcService.ts

interface ConversationArc {
  arcId: string;
  userId: string;
  sessionIds: string[];
  summary: string; // LLM-generated
  keyDecisions: string[];
  participants: string[]; // In multi-user, who was involved?
  startTs: number;
  endTs: number;
  topicsTouched: string[];
  toolsUsed: string[];
  createdAt: number;
}

class ConversationArcService {
  async createArcFromSessions(
    sessionIds: string[],
    userId: string
  ): Promise<ConversationArc> {
    // 1. Load all sessions
    // 2. Concatenate messages
    // 3. Use LLM to summarize (with token budget)
    // 4. Extract key decisions (via structured output)
    // 5. Store in SQLite
  }

  async listArcs(userId: string, options: {
    startDate?: Date;
    endDate?: Date;
    topic?: string;
    limit?: number;
    offset?: number;
  }): Promise<ConversationArc[]> {
    // Query SQLite with filters
    // Support topic-based search (post-hoc)
  }

  async getArcSummary(arcId: string): Promise<string> {
    // Cached LLM summary
    // If user wants more detail, load full arc
  }

  async mergeArcsIfRedundant(userId: string): Promise<void> {
    // Detect if multiple arcs discuss same topic
    // Merge to reduce storage/complexity
    // Useful for long-running projects
  }
}
```

**Files to Create**:
- `packages/agent/src/memory/ConversationArcService.ts` (250 lines)

**Tests**:
- `packages/agent/src/memory/__tests__/ConversationArcService.test.ts` (250 lines)

#### 4.2.3 Fact Validation Engine

```typescript
// packages/agent/src/memory/FactValidationEngine.ts

interface FactCheckResult {
  original: string;
  isValid: boolean | undefined; // true/false/unknown
  confidence: number; // 0-1
  evidence: {
    source: 'memory' | 'tool' | 'user_confirmation' | 'reasoning';
    detail: string;
  }[];
  correction?: string; // If invalid
  validatedAt: number;
  expiresAt?: number; // Revalidate after this date
}

class FactValidationEngine {
  async validateFact(
    fact: string,
    context: { userId: string; sessionId?: string }
  ): Promise<FactCheckResult> {
    // 1. Check long-term memory (if available)
    //    - Exact match with high confidence → valid
    //    - Contradictory entry → investigate
    
    // 2. Tool-based validation (for data facts)
    //    - Detect "has N tickets", "balance is $X"
    //    - Execute relevant tool
    //    - Compare result to fact
    
    // 3. Reasoning-based validation
    //    - Use LLM: "Is this claim logically consistent?"
    //    - Low confidence, but useful for sanity checks
    
    // 4. User confirmation (fallback)
    //    - For uncertain/unverifiable facts
    //    - Ask user in next turn
    
    // 5. Return structured result
  }

  async batchValidateFacts(
    facts: string[],
    context: { userId: string; sessionId?: string }
  ): Promise<FactCheckResult[]> {
    // Parallel validation with rate limiting
  }

  private async validateToolBasedFact(
    fact: string
  ): Promise<FactCheckResult | null> {
    // Parse fact like "balance is $1234" → { field: 'balance', value: 1234 }
    // Find matching tool (e.g., 'get_balance_tool')
    // Execute and compare
  }

  private async validateAgainstLongTermMemory(
    fact: string,
    userId: string
  ): Promise<FactCheckResult | null> {
    // Search long-term knowledge base
    // If exact match with high confidence, return valid
    // If contradictory, return invalid
    // If no match, return unknown
  }

  private async askUserForConfirmation(
    fact: string,
    sessionId: string
  ): Promise<boolean> {
    // Emit event to UI
    // Wait for user response (with timeout)
    // Return true/false/timeout
  }
}
```

**Files to Create**:
- `packages/agent/src/memory/FactValidationEngine.ts` (300 lines)

**Tests**:
- `packages/agent/src/memory/__tests__/FactValidationEngine.test.ts` (400 lines)

#### 4.2.4 Self-Healing Validator

```typescript
// packages/agent/src/memory/SelfHealingValidator.ts

class SelfHealingValidator {
  async postProcessResponse(
    sessionId: string,
    userId: string,
    modelResponse: string
  ): Promise<{
    correctedResponse: string;
    corrections: FactCheckResult[];
    learnings: LearnedPattern[];
  }> {
    // 1. Extract claims from response
    const claims = await this.claimExtractor.extract(modelResponse);
    
    // 2. Validate each claim
    const corrections: FactCheckResult[] = [];
    for (const claim of claims) {
      const result = await this.factValidator.validateFact(claim, {
        userId,
        sessionId
      });
      corrections.push(result);
    }

    // 3. Apply corrections to response
    let correctedResponse = modelResponse;
    for (const correction of corrections) {
      if (correction.correction) {
        correctedResponse = correctedResponse.replace(
          correction.original,
          correction.correction
        );
      }
    }

    // 4. Learn from corrections
    const learnings: LearnedPattern[] = [];
    for (const correction of corrections) {
      if (correction.original !== correction.correction) {
        const learning = await this.learnFromCorrection(
          correction.original,
          correction.correction,
          correction.evidence[0].source,
          { userId, sessionId }
        );
        learnings.push(learning);
      }
    }

    return {
      correctedResponse,
      corrections,
      learnings
    };
  }

  private async learnFromCorrection(
    original: string,
    corrected: string,
    validator: string,
    context: { userId: string; sessionId: string }
  ): Promise<LearnedPattern> {
    // Extract pattern: "Model tends to hallucinate X → correct with Y"
    // Store for future reference
    // Update system prompt hints if pattern is frequent
  }
}
```

**Files to Create**:
- `packages/agent/src/memory/SelfHealingValidator.ts` (250 lines)

**Tests**:
- `packages/agent/src/memory/__tests__/SelfHealingValidator.test.ts` (300 lines)

#### 4.2.5 SQLite Schema for Medium-Term Memory

```sql
-- Create tables for Phase 4
CREATE TABLE IF NOT EXISTS conversation_arcs (
  arc_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_ids TEXT NOT NULL, -- JSON array
  summary TEXT NOT NULL,
  key_decisions TEXT NOT NULL, -- JSON array
  topics_touched TEXT, -- JSON array
  tools_used TEXT, -- JSON array
  start_ts INTEGER NOT NULL,
  end_ts INTEGER NOT NULL,
  confidence REAL DEFAULT 0.8,
  created_at INTEGER NOT NULL,
  INDEX idx_user_id (user_id),
  INDEX idx_start_ts (start_ts),
  INDEX idx_confidence (confidence)
);

CREATE TABLE IF NOT EXISTS fact_validations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_id TEXT,
  original_claim TEXT NOT NULL,
  corrected_claim TEXT,
  validator TEXT NOT NULL, -- 'tool', 'user', 'memory', 'reasoning'
  confidence REAL NOT NULL,
  is_valid BOOLEAN,
  created_at INTEGER NOT NULL,
  expires_at INTEGER, -- Revalidate after this date
  INDEX idx_user_id (user_id),
  INDEX idx_created_at (created_at),
  INDEX idx_expires_at (expires_at)
);

CREATE TABLE IF NOT EXISTS learned_patterns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  error_pattern JSONB NOT NULL,
  error_type TEXT, -- 'hallucination', 'stale_data', 'inconsistency'
  frequency INTEGER DEFAULT 1,
  last_occurrence INTEGER,
  prevention_strategy JSONB,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  INDEX idx_user_id (user_id),
  INDEX idx_error_type (error_type),
  INDEX idx_frequency (frequency)
);
```

**Integration**:
- Update `SessionRepository` to use SQLite for sessions (instead of file-based JSON)
- Create migration script from Phase 3 (file) to Phase 4 (SQLite)

### 4.3 Integration with PiEmbeddedRuntime

```typescript
// In packages/agent/src/runtime/PiEmbeddedRuntime.ts

export class PiEmbeddedRuntime extends BaseAgentRuntime {
  private memoryTier: MemoryTierManager;
  private selfHealing: SelfHealingValidator;

  async *run(input: RuntimeInput): AsyncIterable<RuntimeEvent> {
    // ... existing Phase 2B logic ...

    // NEW: Get contextual facts (async, doesn't block model)
    const contextPromise = this.memoryTier.extractRelevantContext(
      input.sessionId,
      input.message
    );

    // ... execute model with working memory ...

    // NEW: Post-process with self-healing
    const { correctedResponse, corrections, learnings } = 
      await this.selfHealing.postProcessResponse(
        input.sessionId,
        input.sessionId.split(':')[0], // Extract userId
        assistantMessage
      );

    // Emit corrections as events
    for (const correction of corrections) {
      yield {
        type: 'runtime_log',
        level: 'info',
        message: `Fact validated: ${correction.isValid ? 'VALID' : 'CORRECTED'}`,
        ts: Date.now(),
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION
      };
    }

    // ... rest of execution ...
  }
}
```

### 4.4 Phase 4 Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Context efficiency | +40% | Same information, 40% fewer tokens |
| Fact validation accuracy | > 90% | Verified against tool results |
| Self-healing detection | > 80% | Hallucinations caught / Total hallucinations |
| User confirmation latency | < 2s | Time from question to answer |
| SQLite query performance | < 200ms | Arc retrieval, medium-term memory |
| No regressions | 100% | All Phase 2-3 tests still pass |

---

## Phase 5: Long-Term Memory & Autonomous Learning

### 5.1 Scope & Goals

**Timeline**: 8-12 weeks (follows Phase 4)

**Goals**:
1. ✅ Migrate to PostgreSQL + Vector DB for long-term storage
2. ✅ Implement semantic search with embeddings
3. ✅ Add autonomous pattern extraction and learning
4. ✅ Implement system prompt auto-tuning
5. ✅ Build privacy-preserving aggregation
6. ✅ Enable automatic revalidation of stale facts

**Success Criteria**:
- [ ] Long-term memory search latency < 500ms
- [ ] Pattern learning captures > 70% of common error types
- [ ] System prompt updates improve accuracy by > 10%
- [ ] Privacy compliance: 100% PII handling correct
- [ ] Autonomous corrections > 50% of valid hallucinations (no user interaction)
- [ ] Cross-user learning benefits > 5% accuracy improvement (privacy-preserved)

### 5.2 Key Components

#### 5.2.1 Vector Embedding Service

```typescript
// packages/agent/src/memory/VectorEmbeddingService.ts

class VectorEmbeddingService {
  private embeddingModel: string; // 'openai:text-embedding-3-large' or self-hosted

  async embedText(text: string): Promise<number[]> {
    // 1-2 second latency for external API
    // Cache common queries to reduce API calls
  }

  async batchEmbed(texts: string[]): Promise<number[][]> {
    // Batch multiple texts efficiently
    // Rate limit handling for external APIs
  }

  async updateEmbeddings(
    userId: string,
    facts: Array<{ id: string; text: string }>
  ): Promise<void> {
    // Periodically refresh embeddings (e.g., weekly)
    // Detect semantic drift
  }
}
```

#### 5.2.2 Semantic Search Engine

```typescript
// packages/agent/src/memory/SemanticSearchEngine.ts

class SemanticSearchEngine {
  async search(
    userId: string,
    query: string,
    topK: number = 10,
    searchType: 'semantic' | 'keyword' | 'hybrid' = 'hybrid'
  ): Promise<KnowledgeEntry[]> {
    // 1. Parse query → extract intent + keywords
    // 2. Semantic: vector similarity (< 200ms)
    // 3. Keyword: BM25 (< 100ms)
    // 4. Hybrid: combine (weighted average)
    // 5. Filter by user access + recency + confidence
  }

  async semanticCluster(
    userId: string,
    facts: KnowledgeEntry[]
  ): Promise<Array<{ cluster: string; facts: KnowledgeEntry[] }>> {
    // Group similar facts together
    // Useful for merging redundant knowledge
  }
}
```

#### 5.2.3 Learned Pattern Extractor

```typescript
// packages/agent/src/memory/LearnedPatternExtractor.ts

interface LearnedPattern {
  id: string;
  pattern: {
    errorType: string; // 'hallucination', 'stale_data', etc.
    condition: string; // "When user asks about tickets..."
    errorBehavior: string; // "Model says N, actual is N-1"
    correctionStrategy: string; // "Always call tickets_api"
  };
  frequency: number;
  lastOccurrence: number;
  successRate: number; // % of times correction helps
  linkedCorrections: string[]; // Correction IDs
}

class LearnedPatternExtractor {
  async extractPatterns(
    corrections: FactCheckResult[],
    context: { userId: string; sessionId: string }
  ): Promise<LearnedPattern[]> {
    // 1. Cluster similar corrections
    // 2. Extract common features
    // 3. Generalize (e.g., "tickets" → "counts")
    // 4. Store with metadata
  }

  async getHighFrequencyPatterns(
    userId: string,
    topK: number = 10
  ): Promise<LearnedPattern[]> {
    // Get patterns that occur often
    // Use to update system prompt
  }

  async suggestSystemPromptUpdates(
    userId: string
  ): Promise<Array<{ pattern: LearnedPattern; suggestion: string }>> {
    // Based on frequent patterns, suggest prompt improvements
    // E.g., "Add to system: 'Always validate ticket counts with tool X'"
  }
}
```

#### 5.2.4 System Prompt Auto-Tuning

```typescript
// packages/agent/src/memory/SystemPromptAutoTuner.ts

class SystemPromptAutoTuner {
  async updateSystemPrompt(
    userId: string,
    learnedPatterns: LearnedPattern[]
  ): Promise<{ before: string; after: string; changes: string[] }> {
    // 1. Get current system prompt
    // 2. Analyze learned patterns
    // 3. Generate prompt modifications
    // 4. Test with small sample (A/B test)
    // 5. Deploy if improvement > threshold
  }

  async analyzePromptEffectiveness(
    userId: string,
    promptVersion: number
  ): Promise<{
    accuracy: number;
    hallucination_rate: number;
    tool_usage_rate: number;
  }> {
    // Measure performance of specific prompt version
    // Track over time
  }

  private async generatePromptModification(
    pattern: LearnedPattern
  ): Promise<string> {
    // Convert learned pattern to natural language prompt addition
    // E.g., LearnedPattern → "Always validate ticket counts by calling tickets_api"
  }
}
```

#### 5.2.5 Privacy-Preserving Aggregation

```typescript
// packages/agent/src/memory/PrivacyPreservingAggregator.ts

class PrivacyPreservingAggregator {
  async aggregatePatterns(
    patterns: Array<{ userId: string; pattern: LearnedPattern }>
  ): Promise<Array<{ pattern: object; frequency: number; anonymityGroupSize: number }>> {
    // 1. Remove user identifiers
    // 2. Hash user IDs (for deduplication, not reversal)
    // 3. Aggregate counts
    // 4. Only share if anonymity group >= 10 (k-anonymity)
  }

  async generateAggregateStatistics(
    allPatterns: LearnedPattern[]
  ): Promise<{
    topErrorTypes: Array<{ type: string; frequency: number }>;
    mostEffectiveStrategies: Array<{ strategy: string; successRate: number }>;
    commonCombinations: Array<{ patterns: string[]; frequency: number }>;
  }> {
    // Aggregate across all users
    // Share only patterns that help everyone
  }

  async personalizeFromAggregates(
    userId: string,
    aggregateStatistics: object
  ): Promise<string> {
    // Use aggregate patterns to personalize system prompt for new user
    // "Based on patterns from 1000+ conversations, we recommend..."
  }
}
```

### 5.3 PostgreSQL + Vector DB Schema

```sql
-- Long-term knowledge base (PostgreSQL)
CREATE TABLE IF NOT EXISTS knowledge_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  type TEXT NOT NULL, -- 'fact', 'rule', 'pattern'
  source TEXT, -- 'session', 'arc', 'tool', 'external'
  confidence REAL DEFAULT 0.7,
  version INTEGER DEFAULT 1,
  validated_at INTEGER,
  embedding_version INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, text, version),
  INDEX idx_user_id (user_id),
  INDEX idx_type (type),
  INDEX idx_confidence (confidence),
  INDEX idx_validated_at (validated_at)
);

-- Vector DB (Pinecone, Weaviate, Milvus, etc.)
-- Namespace: {user_id}/{source}
-- Metadata: { type, source, confidence, created_at, version }
-- Search: similarity(query_embedding, indexed_embeddings) + metadata filtering

CREATE TABLE IF NOT EXISTS learned_patterns (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  error_type TEXT NOT NULL,
  pattern_signature TEXT NOT NULL, -- Hashed pattern for deduplication
  frequency INTEGER DEFAULT 1,
  success_rate REAL DEFAULT 0.5,
  last_occurrence INTEGER,
  suggestions JSONB,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, pattern_signature),
  INDEX idx_user_id (user_id),
  INDEX idx_error_type (error_type),
  INDEX idx_frequency (frequency)
);

CREATE TABLE IF NOT EXISTS aggregate_patterns (
  id TEXT PRIMARY KEY,
  error_type TEXT NOT NULL,
  pattern_structure JSONB NOT NULL,
  frequency INTEGER,
  anonymity_group_size INTEGER, -- k-anonymity
  effectiveness REAL, -- % success
  created_at INTEGER NOT NULL,
  UNIQUE(error_type, pattern_structure),
  INDEX idx_error_type (error_type),
  INDEX idx_frequency (frequency)
);
```

### 5.4 Phase 5 Integration

```typescript
// Updated PiEmbeddedRuntime with Phase 5 features

export class PiEmbeddedRuntimeV3 extends BaseAgentRuntime {
  private longTermMemory: LongTermMemoryService;
  private semanticSearch: SemanticSearchEngine;
  private patternExtractor: LearnedPatternExtractor;
  private promptTuner: SystemPromptAutoTuner;

  async *run(input: RuntimeInput): AsyncIterable<RuntimeEvent> {
    // ... Phase 4 logic + ...

    // NEW (Phase 5): Enhanced context with long-term memory
    const longTermContext = await this.semanticSearch.search(
      userId,
      input.message,
      topK=5
    );

    // NEW (Phase 5): Auto-tuned system prompt per user
    const userSystemPrompt = await this.promptTuner.getUserPrompt(userId);

    // Execute with enhanced context
    const response = await llm.stream({
      messages: [...workingMemory, ...longTermContext],
      systemPrompt: userSystemPrompt // User-specific!
    });

    // NEW (Phase 5): Autonomous correction (no user prompt needed)
    const { correctedResponse, learnings } = 
      await this.selfHealing.postProcessResponseV2(response, {
        autonomousCorrectionThreshold: 0.95 // Only correct if very confident
      });

    // NEW (Phase 5): Async learning (doesn't block response)
    this.patternExtractor.learnAsync(learnings, { userId });

    // Yield response
    yield { ... };
  }
}
```

---

## Phase Comparison & Metrics

### Timeline

```
Now (2026-05)
  └─ Phase 3.0-3.3: COMPLETE (design + implementation)
     └─ Phase 4: Months 1-3 (Month 6-8, 2026)
        └─ Phase 5: Months 4-6 (Month 9-11, 2026)
           └─ Phase 6 (2027): Autonomous agents, multi-agent systems
```

### Feature Matrix

| Feature | Phase 3 | Phase 4 | Phase 5 |
|---------|---------|---------|---------|
| **Working Memory** | 5 messages | 5 messages | 5 messages |
| **Short-Term** | File | SQLite | SQLite |
| **Medium-Term** | None | Arcs (SQLite) | Arcs (SQLite) |
| **Long-Term** | None | None | Knowledge (PostgreSQL + Vector DB) |
| **Tiers** | 2 | 4 | 4 |
| **Validation** | None | Tool-based | Multi-source + autonomous |
| **Learning** | None | Pattern collection | Autonomous pattern extraction |
| **Context Inject** | Full session | Selective | Compressed + semantic |
| **Privacy** | Basic | Sensitivity levels | Encryption + audit + aggregation |
| **Prompt Auto-Tune** | None | None | Per-user system prompt |
| **Token Efficiency** | 1x | 0.6x (40% saving) | 0.5x (50% saving) |
| **Latency (p50)** | 100ms | 200ms | 300ms |
| **Storage** | 1MB / session | 10MB / user | 100MB+ / user |

---

## Effort Estimation

### Phase 4: 8-12 weeks
- MemoryTierManager: 250 lines (1 week)
- ConversationArcService: 250 lines (1 week)
- FactValidationEngine: 300 lines (1.5 weeks)
- SelfHealingValidator: 250 lines (1 week)
- SQLite integration: 200 lines (0.5 weeks)
- Tests: 1200 lines (2 weeks)
- Integration + QA: 1 week
- **Total**: ~2,450 lines, 8-10 weeks

### Phase 5: 8-12 weeks
- VectorEmbeddingService: 150 lines (1 week)
- SemanticSearchEngine: 200 lines (1 week)
- LearnedPatternExtractor: 250 lines (1.5 weeks)
- SystemPromptAutoTuner: 200 lines (1 week)
- PrivacyPreservingAggregator: 200 lines (1 week)
- PostgreSQL + Vector DB setup: 300 lines (1 week)
- Tests: 1000 lines (1.5 weeks)
- Integration + QA: 1 week
- **Total**: ~2,300 lines, 8-10 weeks

**Grand Total**: ~4,750 lines, 16-20 weeks (4-5 months)

---

## Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|-----------|
| PostgreSQL/Vector DB complexity | High | Use managed services (AWS RDS, Pinecone) instead of self-hosted |
| User confirmation latency | Medium | Implement timeouts, fallback to lower confidence |
| Privacy compliance | Critical | Audit all aggregation logic, k-anonymity checks, encryption |
| Token counting accuracy | Medium | Use actual LLM tokenizer, not estimates |
| Learning quality | Medium | Start with conservative thresholds, A/B test updates |
| Performance regression | High | Comprehensive benchmarks before/after each phase |

---

## Success Definition

### Phase 4 Success
- [ ] 30-40% token savings on average user conversation
- [ ] > 90% fact validation accuracy
- [ ] > 80% hallucination detection rate
- [ ] < 2s user confirmation latency
- [ ] Zero regression in Phase 2-3 tests
- [ ] New tests: 100% passing

### Phase 5 Success
- [ ] < 500ms semantic search latency
- [ ] > 70% pattern capture rate
- [ ] > 10% accuracy improvement from auto-tuned prompts
- [ ] 100% privacy compliance
- [ ] > 50% autonomous correction rate
- [ ] > 5% improvement from cross-user learning (privacy-preserved)

---

## Conclusion

This roadmap positions Telegraph for **continuous self-improvement** through:

1. **Phase 4**: Efficient context + error detection
2. **Phase 5**: Autonomous learning + per-user optimization

By **Month 11 of 2026**, Telegraph will be a **self-healing, continually learning agent host** that improves with every interaction.
