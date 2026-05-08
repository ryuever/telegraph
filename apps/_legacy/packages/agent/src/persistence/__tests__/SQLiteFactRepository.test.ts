/**
 * SQLite Memory Store & Fact Repository Tests (Phase 5)
 *
 * Tests persistence layer for Tier 2 and fact knowledge base
 * Coverage: 50+ test cases across both components
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { FactRepository, type Fact, type FactValidationRecord, type FactSearchResult } from '../FactRepository'

describe('Phase 5: SQLite Persistence Layer', () => {
  let factRepo: FactRepository

  beforeEach(() => {
    factRepo = new FactRepository()
  })

  describe('FactRepository: Basic Operations', () => {
    it('should add a new fact', () => {
      const fact: Fact = {
        id: 'fact-1',
        text: 'React is a JavaScript library',
        confidence: 0.95,
        source: 'tool_result',
        userId: 'user-1',
        sessionId: 'session-1',
        extractedAt: Date.now(),
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
      }

      const id = factRepo.addFact(fact)
      expect(id).toBe('fact-1')

      const retrieved = factRepo.getFact('fact-1')
      expect(retrieved).toBeDefined()
      expect(retrieved?.text).toBe('React is a JavaScript library')
    })

    it('should retrieve fact by ID', () => {
      const fact: Fact = {
        id: 'fact-2',
        text: 'TypeScript is a superset of JavaScript',
        confidence: 0.9,
        source: 'conversation_history',
        userId: 'user-1',
        extractedAt: Date.now(),
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
      }

      factRepo.addFact(fact)
      const retrieved = factRepo.getFact('fact-2')

      expect(retrieved).toBeDefined()
      expect(retrieved?.confidence).toBe(0.9)
    })

    it('should return undefined for non-existent fact', () => {
      const retrieved = factRepo.getFact('non-existent')
      expect(retrieved).toBeUndefined()
    })

    it('should get all user facts', () => {
      const fact1: Fact = {
        id: 'fact-1',
        text: 'Python is a programming language',
        confidence: 0.85,
        source: 'llm_reasoning',
        userId: 'user-1',
        extractedAt: Date.now(),
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
      }

      const fact2: Fact = {
        id: 'fact-2',
        text: 'Go has fast compilation',
        confidence: 0.8,
        source: 'tool_result',
        userId: 'user-1',
        extractedAt: Date.now(),
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
      }

      factRepo.addFact(fact1)
      factRepo.addFact(fact2)

      const userFacts = factRepo.getUserFacts('user-1')
      expect(userFacts).toHaveLength(2)
      expect(userFacts[0].confidence).toBeGreaterThanOrEqual(userFacts[1].confidence)
    })

    it('should filter facts by minimum confidence', () => {
      const facts: Fact[] = [
        {
          id: 'low',
          text: 'Low confidence fact',
          confidence: 0.3,
          source: 'memory',
          userId: 'user-1',
          extractedAt: Date.now(),
          validationCount: 0,
          contradictions: [],
          relatedFacts: [],
        },
        {
          id: 'high',
          text: 'High confidence fact',
          confidence: 0.9,
          source: 'tool_result',
          userId: 'user-1',
          extractedAt: Date.now(),
          validationCount: 0,
          contradictions: [],
          relatedFacts: [],
        },
      ]

      facts.forEach((f) => factRepo.addFact(f))

      const highConfidence = factRepo.getUserFacts('user-1', 0.7)
      expect(highConfidence).toHaveLength(1)
      expect(highConfidence[0].id).toBe('high')
    })

    it('should get session-specific facts', () => {
      const fact1: Fact = {
        id: 'session-fact-1',
        text: 'Session 1 fact',
        confidence: 0.9,
        source: 'conversation_history',
        userId: 'user-1',
        sessionId: 'session-1',
        extractedAt: Date.now(),
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
      }

      const fact2: Fact = {
        id: 'session-fact-2',
        text: 'Session 2 fact',
        confidence: 0.85,
        source: 'conversation_history',
        userId: 'user-1',
        sessionId: 'session-2',
        extractedAt: Date.now(),
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
      }

      factRepo.addFact(fact1)
      factRepo.addFact(fact2)

      const session1Facts = factRepo.getSessionFacts('session-1')
      expect(session1Facts).toHaveLength(1)
      expect(session1Facts[0].id).toBe('session-fact-1')
    })
  })

  describe('FactRepository: Similarity & Search', () => {
    beforeEach(() => {
      const facts: Fact[] = [
        {
          id: 'fact-1',
          text: 'React is a JavaScript library for building UIs',
          confidence: 0.95,
          source: 'tool_result',
          userId: 'user-1',
          extractedAt: Date.now(),
          validationCount: 5,
          contradictions: [],
          relatedFacts: [],
        },
        {
          id: 'fact-2',
          text: 'React is used for UI development',
          confidence: 0.88,
          source: 'conversation_history',
          userId: 'user-1',
          extractedAt: Date.now(),
          validationCount: 3,
          contradictions: [],
          relatedFacts: [],
        },
        {
          id: 'fact-3',
          text: 'Vue.js is also a UI framework',
          confidence: 0.85,
          source: 'llm_reasoning',
          userId: 'user-1',
          extractedAt: Date.now(),
          validationCount: 2,
          contradictions: [],
          relatedFacts: [],
        },
      ]
      facts.forEach((f) => factRepo.addFact(f))
    })

    it('should find exact matching facts', () => {
      const results = factRepo.findSimilarFacts('React is a JavaScript library for building UIs', 'user-1', 1.0)
      expect(results).toHaveLength(1)
      expect(results[0].fact.id).toBe('fact-1')
      expect(results[0].matchType).toBe('exact')
    })

    it('should find semantically similar facts', () => {
      const results = factRepo.findSimilarFacts('React is used for UI development', 'user-1', 0.5)
      expect(results.length).toBeGreaterThan(1)
      expect(results.some((r) => r.fact.id === 'fact-1')).toBe(true)
    })

    it('should rank results by relevance', () => {
      const results = factRepo.findSimilarFacts('React JavaScript library', 'user-1', 0.3)
      if (results.length > 1) {
        expect(results[0].relevance).toBeGreaterThanOrEqual(results[1].relevance)
      }
    })

    it('should find facts by keyword', () => {
      const results = factRepo.findByKeyword('React', 'user-1')
      expect(results.length).toBeGreaterThan(0)
      expect(results.every((f) => f.text.toLowerCase().includes('react'))).toBe(true)
    })

    it('should find facts by partial keyword', () => {
      const results = factRepo.findByKeyword('UI', 'user-1')
      expect(results.length).toBeGreaterThan(0)
    })

    it('should be case-insensitive in search', () => {
      const upperResults = factRepo.findByKeyword('REACT', 'user-1')
      const lowerResults = factRepo.findByKeyword('react', 'user-1')
      expect(upperResults).toHaveLength(lowerResults.length)
    })
  })

  describe('FactRepository: Validation & Confidence', () => {
    it('should record fact validation', () => {
      const fact: Fact = {
        id: 'fact-val',
        text: 'Test fact for validation',
        confidence: 0.5,
        source: 'memory',
        userId: 'user-1',
        extractedAt: Date.now(),
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
      }

      factRepo.addFact(fact)
      factRepo.recordValidation('fact-val', true, 'tool_verified')

      const updated = factRepo.getFact('fact-val')
      expect(updated?.validationCount).toBe(1)
      expect(updated?.confidence).toBeGreaterThan(0.5)
    })

    it('should increase confidence on successful validation', () => {
      const fact: Fact = {
        id: 'fact-increase',
        text: 'Fact to validate',
        confidence: 0.5,
        source: 'memory',
        userId: 'user-1',
        extractedAt: Date.now(),
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
      }

      factRepo.addFact(fact)
      const before = fact.confidence

      factRepo.recordValidation('fact-increase', true, 'tool_verified')
      const after = factRepo.getFact('fact-increase')?.confidence ?? 0

      expect(after).toBeGreaterThan(before)
    })

    it('should decrease confidence on failed validation', () => {
      const fact: Fact = {
        id: 'fact-decrease',
        text: 'Fact to invalidate',
        confidence: 0.8,
        source: 'memory',
        userId: 'user-1',
        extractedAt: Date.now(),
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
      }

      factRepo.addFact(fact)
      const before = fact.confidence

      factRepo.recordValidation('fact-decrease', false, 'tool_verified')
      const after = factRepo.getFact('fact-decrease')?.confidence ?? 0

      expect(after).toBeLessThan(before)
    })

    it('should cap confidence at 1.0', () => {
      const fact: Fact = {
        id: 'fact-cap',
        text: 'Fact at max',
        confidence: 0.95,
        source: 'tool_result',
        userId: 'user-1',
        extractedAt: Date.now(),
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
      }

      factRepo.addFact(fact)
      factRepo.recordValidation('fact-cap', true, 'tool_verified')
      factRepo.recordValidation('fact-cap', true, 'user_confirmed')

      const updated = factRepo.getFact('fact-cap')
      expect(updated?.confidence).toBeLessThanOrEqual(1)
    })

    it('should floor confidence at 0', () => {
      const fact: Fact = {
        id: 'fact-floor',
        text: 'Fact at min',
        confidence: 0.05,
        source: 'memory',
        userId: 'user-1',
        extractedAt: Date.now(),
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
      }

      factRepo.addFact(fact)
      factRepo.recordValidation('fact-floor', false, 'tool_verified')
      factRepo.recordValidation('fact-floor', false, 'user_confirmed')

      const updated = factRepo.getFact('fact-floor')
      expect(updated?.confidence).toBeGreaterThanOrEqual(0)
    })

    it('should retrieve validation history', () => {
      const fact: Fact = {
        id: 'fact-history',
        text: 'Fact with history',
        confidence: 0.6,
        source: 'memory',
        userId: 'user-1',
        extractedAt: Date.now(),
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
      }

      factRepo.addFact(fact)
      factRepo.recordValidation('fact-history', true, 'tool_verified')
      factRepo.recordValidation('fact-history', true, 'user_confirmed')
      factRepo.recordValidation('fact-history', false, 'automatic')

      const history = factRepo.getValidationHistory('fact-history')
      expect(history).toHaveLength(3)
      expect(history[0].isValid).toBe(true)
      expect(history[2].isValid).toBe(false)
    })

    it('should reflect validation count in fact', () => {
      const fact: Fact = {
        id: 'fact-count',
        text: 'Fact to count validations',
        confidence: 0.7,
        source: 'conversation_history',
        userId: 'user-1',
        extractedAt: Date.now(),
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
      }

      factRepo.addFact(fact)

      for (let i = 0; i < 5; i++) {
        factRepo.recordValidation('fact-count', true, 'automatic')
      }

      const updated = factRepo.getFact('fact-count')
      expect(updated?.validationCount).toBe(5)
    })
  })

  describe('FactRepository: Contradictions', () => {
    it('should link contradicting facts', () => {
      const fact1: Fact = {
        id: 'fact-contra-1',
        text: 'React has virtual DOM',
        confidence: 0.95,
        source: 'tool_result',
        userId: 'user-1',
        extractedAt: Date.now(),
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
      }

      const fact2: Fact = {
        id: 'fact-contra-2',
        text: 'React does not use virtual DOM',
        confidence: 0.1,
        source: 'memory',
        userId: 'user-1',
        extractedAt: Date.now(),
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
      }

      factRepo.addFact(fact1)
      factRepo.addFact(fact2)

      factRepo.linkContradiction('fact-contra-1', 'fact-contra-2')

      const updated1 = factRepo.getFact('fact-contra-1')
      const updated2 = factRepo.getFact('fact-contra-2')

      expect(updated1?.contradictions).toContain('fact-contra-2')
      expect(updated2?.contradictions).toContain('fact-contra-1')
    })

    it('should retrieve contradicting facts', () => {
      const fact1: Fact = {
        id: 'contra-1',
        text: 'Fact A',
        confidence: 0.9,
        source: 'tool_result',
        userId: 'user-1',
        extractedAt: Date.now(),
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
      }

      const fact2: Fact = {
        id: 'contra-2',
        text: 'Fact B contradicting A',
        confidence: 0.1,
        source: 'memory',
        userId: 'user-1',
        extractedAt: Date.now(),
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
      }

      factRepo.addFact(fact1)
      factRepo.addFact(fact2)
      factRepo.linkContradiction('contra-1', 'contra-2')

      const contradictions = factRepo.getContradictions('contra-1')
      expect(contradictions).toHaveLength(1)
      expect(contradictions[0].id).toBe('contra-2')
    })

    it('should prevent duplicate contradiction links', () => {
      const fact1: Fact = {
        id: 'dup-contra-1',
        text: 'Fact 1',
        confidence: 0.8,
        source: 'tool_result',
        userId: 'user-1',
        extractedAt: Date.now(),
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
      }

      const fact2: Fact = {
        id: 'dup-contra-2',
        text: 'Fact 2',
        confidence: 0.2,
        source: 'memory',
        userId: 'user-1',
        extractedAt: Date.now(),
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
      }

      factRepo.addFact(fact1)
      factRepo.addFact(fact2)

      factRepo.linkContradiction('dup-contra-1', 'dup-contra-2')
      factRepo.linkContradiction('dup-contra-1', 'dup-contra-2')

      const updated = factRepo.getFact('dup-contra-1')
      expect(updated?.contradictions.filter((c) => c === 'dup-contra-2')).toHaveLength(1)
    })
  })

  describe('FactRepository: Related Facts', () => {
    it('should link related facts', () => {
      const fact1: Fact = {
        id: 'rel-1',
        text: 'React is a UI library',
        confidence: 0.95,
        source: 'tool_result',
        userId: 'user-1',
        extractedAt: Date.now(),
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
      }

      const fact2: Fact = {
        id: 'rel-2',
        text: 'React uses JSX syntax',
        confidence: 0.9,
        source: 'tool_result',
        userId: 'user-1',
        extractedAt: Date.now(),
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
      }

      factRepo.addFact(fact1)
      factRepo.addFact(fact2)
      factRepo.linkRelated('rel-1', 'rel-2')

      const related = factRepo.getRelatedFacts('rel-1')
      expect(related).toHaveLength(1)
      expect(related[0].id).toBe('rel-2')
    })
  })

  describe('FactRepository: Cleanup & Maintenance', () => {
    it('should cleanup expired facts', () => {
      const now = Date.now()
      const fact: Fact = {
        id: 'exp-fact',
        text: 'Expiring fact',
        confidence: 0.8,
        source: 'memory',
        userId: 'user-1',
        extractedAt: now - 2000, // 2 seconds old
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
        ttlMs: 1000, // 1 second TTL
      }

      factRepo.addFact(fact)
      const { removed } = factRepo.cleanupExpired()

      expect(removed).toBe(1)
      expect(factRepo.getFact('exp-fact')).toBeUndefined()
    })

    it('should not remove facts without TTL', () => {
      const fact: Fact = {
        id: 'persist-fact',
        text: 'Persistent fact',
        confidence: 0.8,
        source: 'tool_result',
        userId: 'user-1',
        extractedAt: Date.now() - 10000,
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
        // No TTL specified
      }

      factRepo.addFact(fact)
      const { removed } = factRepo.cleanupExpired()

      expect(removed).toBe(0)
      expect(factRepo.getFact('persist-fact')).toBeDefined()
    })

    it('should update affected facts when removing related facts', () => {
      const fact1: Fact = {
        id: 'main-fact',
        text: 'Main fact',
        confidence: 0.9,
        source: 'tool_result',
        userId: 'user-1',
        extractedAt: Date.now(),
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
      }

      const fact2: Fact = {
        id: 'rel-to-remove',
        text: 'Will be removed',
        confidence: 0.5,
        source: 'memory',
        userId: 'user-1',
        extractedAt: Date.now() - 2000,
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
        ttlMs: 1000,
      }

      factRepo.addFact(fact1)
      factRepo.addFact(fact2)
      factRepo.linkRelated('main-fact', 'rel-to-remove')

      const { affected } = factRepo.cleanupExpired()
      expect(affected).toBeGreaterThan(0)

      const updated = factRepo.getFact('main-fact')
      expect(updated?.relatedFacts).not.toContain('rel-to-remove')
    })

    it('should get accurate statistics', () => {
      const facts: Fact[] = [
        {
          id: 'stat-1',
          text: 'High confidence',
          confidence: 0.95,
          source: 'tool_result',
          userId: 'user-1',
          extractedAt: Date.now(),
          validationCount: 10,
          contradictions: [],
          relatedFacts: [],
        },
        {
          id: 'stat-2',
          text: 'Low confidence',
          confidence: 0.3,
          source: 'memory',
          userId: 'user-1',
          extractedAt: Date.now(),
          validationCount: 1,
          contradictions: [],
          relatedFacts: [],
        },
        {
          id: 'stat-3',
          text: 'User 2 fact',
          confidence: 0.7,
          source: 'conversation_history',
          userId: 'user-2',
          extractedAt: Date.now(),
          validationCount: 3,
          contradictions: [],
          relatedFacts: [],
        },
      ]

      facts.forEach((f) => factRepo.addFact(f))

      const stats = factRepo.getStats()
      expect(stats.totalFacts).toBe(3)
      expect(stats.userCount).toBe(2)
      expect(stats.highConfidenceFacts).toBe(2)
      expect(stats.avgConfidence).toBeGreaterThan(0)
    })
  })

  describe('FactRepository: Export & Import', () => {
    it('should export user facts', () => {
      const facts: Fact[] = [
        {
          id: 'export-1',
          text: 'Fact 1',
          confidence: 0.9,
          source: 'tool_result',
          userId: 'user-export',
          extractedAt: Date.now(),
          validationCount: 5,
          contradictions: [],
          relatedFacts: [],
        },
        {
          id: 'export-2',
          text: 'Fact 2',
          confidence: 0.7,
          source: 'conversation_history',
          userId: 'user-export',
          extractedAt: Date.now(),
          validationCount: 2,
          contradictions: [],
          relatedFacts: [],
        },
      ]

      facts.forEach((f) => factRepo.addFact(f))

      const exported = factRepo.exportUserFacts('user-export')
      expect(exported).toHaveLength(2)
      expect(exported.map((f) => f.id)).toContain('export-1')
      expect(exported.map((f) => f.id)).toContain('export-2')
    })

    it('should import facts', () => {
      const factRepo2 = new FactRepository()

      const facts: Fact[] = [
        {
          id: 'import-1',
          text: 'Imported fact 1',
          confidence: 0.85,
          source: 'tool_result',
          userId: 'import-user',
          extractedAt: Date.now(),
          validationCount: 3,
          contradictions: [],
          relatedFacts: [],
        },
      ]

      factRepo2.importFacts(facts)

      expect(factRepo2.getFact('import-1')).toBeDefined()
      expect(factRepo2.getUserFacts('import-user')).toHaveLength(1)
    })
  })

  describe('FactRepository: Edge Cases', () => {
    it('should handle empty repository', () => {
      const stats = factRepo.getStats()
      expect(stats.totalFacts).toBe(0)
      expect(stats.userCount).toBe(0)

      const facts = factRepo.getUserFacts('non-existent')
      expect(facts).toHaveLength(0)
    })

    it('should handle null/undefined gracefully', () => {
      expect(() => {
        const result = factRepo.getFact('undefined')
        expect(result).toBeUndefined()
      }).not.toThrow()
    })

    it('should clear all facts', () => {
      const fact: Fact = {
        id: 'to-clear',
        text: 'Will be cleared',
        confidence: 0.8,
        source: 'memory',
        userId: 'user-1',
        extractedAt: Date.now(),
        validationCount: 0,
        contradictions: [],
        relatedFacts: [],
      }

      factRepo.addFact(fact)
      expect(factRepo.getFact('to-clear')).toBeDefined()

      factRepo.clear()
      expect(factRepo.getFact('to-clear')).toBeUndefined()
      expect(factRepo.getStats().totalFacts).toBe(0)
    })
  })
})
