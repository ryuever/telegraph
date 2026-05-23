/**
 * FactRepository - Fact Knowledge Base Storage (Phase 5)
 *
 * Manages persistent storage and retrieval of validated facts:
 * - Fact extraction and normalization
 * - Confidence scoring and source tracking
 * - Automatic validation and confidence updates
 * - Cross-session fact aggregation
 * - TTL-based expiration and refresh
 *
 * Integrates with FactValidationEngine for consistency checking
 */

export interface Fact {
  id: string
  text: string // The fact statement
  confidence: number // 0-1, increases with validations
  source: FactSource
  userId: string
  sessionId?: string
  extractedAt: number
  lastValidatedAt?: number
  validationCount: number // How many times validated
  contradictions: string[] // IDs of contradicting facts
  relatedFacts: string[] // IDs of similar/supporting facts
  ttlMs?: number // Time to live in ms
}

export type FactSource = 'tool_result' | 'user_confirmation' | 'conversation_history' | 'llm_reasoning' | 'memory'

export interface FactValidationRecord {
  factId: string
  isValid: boolean
  timestamp: number
  reason?: string
  source: 'automatic' | 'user_confirmed' | 'tool_verified'
}

export interface FactSearchResult {
  fact: Fact
  relevance: number // 0-1
  matchType: 'exact' | 'semantic' | 'partial'
}

/**
 * FactRepository - Persistent fact knowledge base
 */
export class FactRepository {
  private facts = new Map<string, Fact>()
  private userFacts = new Map<string, Set<string>>() // userId -> fact IDs
  private sessionFacts = new Map<string, Set<string>>() // sessionId -> fact IDs
  private validationHistory = new Map<string, FactValidationRecord[]>()

  /**
   * Add a new fact to the knowledge base
   */
  addFact(fact: Fact): string {
    this.facts.set(fact.id, fact)

    // Index by user
    if (!this.userFacts.has(fact.userId)) {
      this.userFacts.set(fact.userId, new Set())
    }
    this.userFacts.get(fact.userId)!.add(fact.id)

    // Index by session
    if (fact.sessionId) {
      if (!this.sessionFacts.has(fact.sessionId)) {
        this.sessionFacts.set(fact.sessionId, new Set())
      }
      this.sessionFacts.get(fact.sessionId)!.add(fact.id)
    }

    return fact.id
  }

  /**
   * Get fact by ID
   */
  getFact(factId: string): Fact | undefined {
    return this.facts.get(factId)
  }

  /**
   * Get all facts for a user
   */
  getUserFacts(userId: string, minConfidence: number = 0): Fact[] {
    const factIds = this.userFacts.get(userId) || new Set()
    return Array.from(factIds)
      .map((id) => this.facts.get(id)!)
      .filter((fact) => !this.isExpired(fact) && fact.confidence >= minConfidence)
      .sort((a, b) => b.confidence - a.confidence)
  }

  /**
   * Get facts for a specific session
   */
  getSessionFacts(sessionId: string, minConfidence: number = 0): Fact[] {
    const factIds = this.sessionFacts.get(sessionId) || new Set()
    return Array.from(factIds)
      .map((id) => this.facts.get(id)!)
      .filter((fact) => !this.isExpired(fact) && fact.confidence >= minConfidence)
  }

  /**
   * Find similar facts (for contradiction detection)
   */
  findSimilarFacts(factText: string, userId: string, threshold: number = 0.7): FactSearchResult[] {
    const userFactIds = this.userFacts.get(userId) || new Set()

    const results: FactSearchResult[] = []

    for (const factId of userFactIds) {
      const fact = this.facts.get(factId)
      if (!fact || this.isExpired(fact)) {
        continue
      }

      const similarity = this.calculateSimilarity(factText, fact.text)
      if (similarity >= threshold) {
        results.push({
          fact,
          relevance: similarity,
          matchType: similarity === 1 ? 'exact' : 'semantic',
        })
      }
    }

    return results.sort((a, b) => b.relevance - a.relevance)
  }

  /**
   * Find facts by keyword
   */
  findByKeyword(keyword: string, userId: string): Fact[] {
    const userFactIds = this.userFacts.get(userId) || new Set()
    const lowerKeyword = keyword.toLowerCase()

    return Array.from(userFactIds)
      .map((id) => this.facts.get(id)!)
      .filter((fact) => !this.isExpired(fact) && fact.text.toLowerCase().includes(lowerKeyword))
  }

  /**
   * Record fact validation and update confidence
   */
  recordValidation(factId: string, isValid: boolean, source: 'automatic' | 'user_confirmed' | 'tool_verified'): void {
    const fact = this.facts.get(factId)
    if (!fact) {
      return
    }

    // Add validation record
    if (!this.validationHistory.has(factId)) {
      this.validationHistory.set(factId, [])
    }

    this.validationHistory.get(factId)!.push({
      factId,
      isValid,
      timestamp: Date.now(),
      source,
    })

    // Update confidence based on validation
    if (isValid) {
      // Increase confidence on successful validation
      const increase = source === 'tool_verified' ? 0.15 : source === 'user_confirmed' ? 0.1 : 0.05
      fact.confidence = Math.min(1, fact.confidence + increase)
    } else {
      // Decrease confidence on failed validation
      const decrease = source === 'tool_verified' ? 0.25 : source === 'user_confirmed' ? 0.15 : 0.1
      fact.confidence = Math.max(0, fact.confidence - decrease)
    }

    fact.validationCount += 1
    fact.lastValidatedAt = Date.now()
  }

  /**
   * Get validation history for a fact
   */
  getValidationHistory(factId: string): FactValidationRecord[] {
    return this.validationHistory.get(factId) || []
  }

  /**
   * Link contradicting facts
   */
  linkContradiction(factId1: string, factId2: string): void {
    const fact1 = this.facts.get(factId1)
    const fact2 = this.facts.get(factId2)

    if (fact1 && !fact1.contradictions.includes(factId2)) {
      fact1.contradictions.push(factId2)
    }

    if (fact2 && !fact2.contradictions.includes(factId1)) {
      fact2.contradictions.push(factId1)
    }
  }

  /**
   * Get contradicting facts
   */
  getContradictions(factId: string): Fact[] {
    const fact = this.facts.get(factId)
    if (!fact) {
      return []
    }

    return fact.contradictions
      .map((id) => this.facts.get(id))
      .filter((f): f is Fact => f !== undefined && !this.isExpired(f))
  }

  /**
   * Link related facts
   */
  linkRelated(factId1: string, factId2: string): void {
    const fact1 = this.facts.get(factId1)
    const fact2 = this.facts.get(factId2)

    if (fact1 && !fact1.relatedFacts.includes(factId2)) {
      fact1.relatedFacts.push(factId2)
    }

    if (fact2 && !fact2.relatedFacts.includes(factId1)) {
      fact2.relatedFacts.push(factId1)
    }
  }

  /**
   * Get related facts
   */
  getRelatedFacts(factId: string): Fact[] {
    const fact = this.facts.get(factId)
    if (!fact) {
      return []
    }

    return fact.relatedFacts
      .map((id) => this.facts.get(id))
      .filter((f): f is Fact => f !== undefined && !this.isExpired(f))
  }

  /**
   * Clean up expired facts
   */
  cleanupExpired(): { removed: number; affected: number } {
    let removed = 0
    let affected = 0

    const expiredIds: string[] = []
    for (const [id, fact] of this.facts.entries()) {
      if (this.isExpired(fact)) {
        expiredIds.push(id)
      }
    }

    for (const id of expiredIds) {
      const fact = this.facts.get(id)!
      this.facts.delete(id)

      // Remove from indexes
      const userFacts = this.userFacts.get(fact.userId)
      if (userFacts) {
        userFacts.delete(id)
      }

      if (fact.sessionId) {
        const sessionFacts = this.sessionFacts.get(fact.sessionId)
        if (sessionFacts) {
          sessionFacts.delete(id)
        }
      }

      // Remove related links
      for (const relatedId of fact.relatedFacts) {
        const relatedFact = this.facts.get(relatedId)
        if (relatedFact) {
          relatedFact.relatedFacts = relatedFact.relatedFacts.filter((fid) => fid !== id)
          affected++
        }
      }

      for (const contradictId of fact.contradictions) {
        const contradictFact = this.facts.get(contradictId)
        if (contradictFact) {
          contradictFact.contradictions = contradictFact.contradictions.filter((fid) => fid !== id)
          affected++
        }
      }

      removed++
    }

    return { removed, affected }
  }

  /**
   * Get repository statistics
   */
  getStats(): {
    totalFacts: number
    userCount: number
    sessionCount: number
    avgConfidence: number
    highConfidenceFacts: number
    expiredFacts: number
  } {
    const facts = Array.from(this.facts.values())
    const expiredCount = facts.filter((f) => this.isExpired(f)).length
    const activeFacts = facts.filter((f) => !this.isExpired(f))
    const avgConfidence = activeFacts.length > 0
      ? activeFacts.reduce((sum, f) => sum + f.confidence, 0) / activeFacts.length
      : 0

    return {
      totalFacts: facts.length,
      userCount: this.userFacts.size,
      sessionCount: this.sessionFacts.size,
      avgConfidence,
      highConfidenceFacts: activeFacts.filter((f) => f.confidence >= 0.7).length,
      expiredFacts: expiredCount,
    }
  }

  /**
   * Export facts for a user (backup/migration)
   */
  exportUserFacts(userId: string): Fact[] {
    return this.getUserFacts(userId, 0)
  }

  /**
   * Import facts (backup/migration)
   */
  importFacts(facts: Fact[]): void {
    for (const fact of facts) {
      this.addFact(fact)

      const history = this.validationHistory.get(fact.id)
      // Validations should be imported separately
      if (history) {
        this.validationHistory.set(fact.id, history)
      }
    }
  }

  /**
   * Calculate similarity between two fact texts (0-1)
   */
  private calculateSimilarity(text1: string, text2: string): number {
    if (text1 === text2) {
      return 1
    }

    const words1 = new Set(tokenizeFactText(text1))
    const words2 = new Set(tokenizeFactText(text2))

    const intersection = new Set([...words1].filter((w) => words2.has(w)))
    const union = new Set([...words1, ...words2])

    if (union.size === 0) {
      return 0
    }

    const jaccard = intersection.size / union.size
    const overlap = intersection.size / Math.min(words1.size, words2.size)
    return Math.max(jaccard, overlap)
  }

  /**
   * Check if fact has expired
   */
  private isExpired(fact: Fact): boolean {
    if (!fact.ttlMs) {
      return false
    }
    return Date.now() - fact.extractedAt > fact.ttlMs
  }

  /**
   * Clear all facts
   */
  clear(): void {
    this.facts.clear()
    this.userFacts.clear()
    this.sessionFacts.clear()
    this.validationHistory.clear()
  }
}

function tokenizeFactText(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token)
}
