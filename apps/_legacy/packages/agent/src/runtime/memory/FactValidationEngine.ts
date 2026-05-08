/**
 * FactValidationEngine - Multi-Source Fact Validation (Phase 4)
 *
 * Validates facts from model responses against:
 * 1. Tool execution results (highest confidence)
 * 2. Conversation history (medium confidence)
 * 3. User confirmation (high confidence)
 * 4. LLM reasoning (lower confidence)
 * 5. Memory artifacts (medium confidence)
 *
 * Detects hallucinations and inconsistencies.
 */

/**
 * Validation source for a fact
 */
export type ValidationSource = 'tool_result' | 'conversation_history' | 'user_confirmation' | 'llm_reasoning' | 'memory' | 'unknown'

/**
 * Confidence level for a fact
 */
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'conflicting'

/**
 * A fact extracted from model output
 */
export interface Fact {
  id: string // Unique identifier
  claim: string // The actual claim
  extractedFrom: string // Source text
  confidence: ConfidenceLevel
  validationSource: ValidationSource
  supportingEvidence: string[]
  conflictingEvidence: string[]
  timestamp: number
  validated: boolean
}

/**
 * Validation result
 */
export interface ValidationResult {
  fact: Fact
  isValid: boolean
  confidence: ConfidenceLevel
  reason: string
  suggestedCorrection?: string
}

/**
 * FactValidationEngine validates model outputs
 */
export class FactValidationEngine {
  private validatedFacts: Map<string, Fact> = new Map()
  private toolResults: Map<string, unknown> = new Map() // Cache of tool results
  private conversationHistory: string[] = [] // History for cross-reference
  private hallucinations: Fact[] = [] // Detected hallucinations

  /**
   * Register a tool result for future fact-checking
   */
  registerToolResult(toolName: string, result: unknown): void {
    const key = `${toolName}_${Date.now()}`
    this.toolResults.set(key, result)
  }

  /**
   * Add a message to conversation history for cross-referencing
   */
  addHistoryMessage(message: string): void {
    this.conversationHistory.push(message)
    // Keep only last 100 messages for memory efficiency
    if (this.conversationHistory.length > 100) {
      this.conversationHistory.shift()
    }
  }

  /**
   * Extract facts from a text (heuristic-based)
   */
  extractFacts(text: string): Fact[] {
    const facts: Fact[] = []

    // Pattern 1: "X is Y" or "X = Y"
    const isPatterns = text.matchAll(/(\w+)\s+is\s+([^.!?]+)/gi)
    for (const match of isPatterns) {
      facts.push({
        id: `fact_${Date.now()}_${Math.random()}`,
        claim: `${match[1]} is ${match[2].trim()}`,
        extractedFrom: text.substring(0, 100),
        confidence: 'low',
        validationSource: 'unknown',
        supportingEvidence: [],
        conflictingEvidence: [],
        timestamp: Date.now(),
        validated: false,
      })
    }

    // Pattern 2: Numerical claims
    const numberPatterns = text.matchAll(/(\w+)\s+(?:is|was|has|contains)\s+(\d+(?:\.\d+)?)/gi)
    for (const match of numberPatterns) {
      facts.push({
        id: `fact_${Date.now()}_${Math.random()}`,
        claim: `${match[1]} = ${match[2]}`,
        extractedFrom: text.substring(0, 100),
        confidence: 'low',
        validationSource: 'unknown',
        supportingEvidence: [],
        conflictingEvidence: [],
        timestamp: Date.now(),
        validated: false,
      })
    }

    return facts
  }

  /**
   * Validate a single fact against multiple sources
   */
  validateFact(fact: Fact): ValidationResult {
    // Check against tool results first (highest confidence)
    const toolCheck = this.checkAgainstToolResults(fact)
    if (toolCheck.isValid) {
      fact.validationSource = 'tool_result'
      fact.confidence = 'high'
      fact.validated = true
      this.validatedFacts.set(fact.id, fact)
      return toolCheck
    }

    // Check against conversation history
    const historyCheck = this.checkAgainstHistory(fact)
    if (historyCheck.isValid) {
      fact.validationSource = 'conversation_history'
      fact.confidence = 'medium'
      fact.validated = true
      this.validatedFacts.set(fact.id, fact)
      return historyCheck
    }

    // Check for internal consistency
    const consistencyCheck = this.checkConsistency(fact)
    if (consistencyCheck.isValid) {
      fact.confidence = 'medium'
    } else {
      fact.confidence = 'conflicting'
      this.hallucinations.push(fact)
    }

    return consistencyCheck
  }

  /**
   * Validate multiple facts
   */
  validateFacts(facts: Fact[]): ValidationResult[] {
    return facts.map((fact) => this.validateFact(fact))
  }

  /**
   * Check fact against tool results
   */
  private checkAgainstToolResults(fact: Fact): ValidationResult {
    // Look for matching tool results
    for (const [key, result] of this.toolResults.entries()) {
      const resultStr = JSON.stringify(result)

      // Check if fact claim appears in result
      if (resultStr.includes(fact.claim) || this.claimMatchesResult(fact.claim, result)) {
        return {
          fact,
          isValid: true,
          confidence: 'high',
          reason: `Confirmed by tool result: ${key}`,
        }
      }
    }

    return {
      fact,
      isValid: false,
      confidence: 'low',
      reason: 'No matching tool results found',
    }
  }

  /**
   * Check if a claim matches a tool result
   */
  private claimMatchesResult(claim: string, result: unknown): boolean {
    if (typeof result === 'string') {
      return result.toLowerCase().includes(claim.toLowerCase())
    }

    if (typeof result === 'object' && result !== null) {
      const resultStr = JSON.stringify(result).toLowerCase()
      const claimStr = claim.toLowerCase()
      return resultStr.includes(claimStr)
    }

    if (typeof result === 'number') {
      const claimNumber = parseFloat(claim)
      return !isNaN(claimNumber) && claimNumber === result
    }

    return false
  }

  /**
   * Check fact against conversation history
   */
  private checkAgainstHistory(fact: Fact): ValidationResult {
    const claimLower = fact.claim.toLowerCase()

    for (const message of this.conversationHistory) {
      const messageLower = message.toLowerCase()

      // Look for exact or close matches
      if (messageLower.includes(claimLower)) {
        return {
          fact,
          isValid: true,
          confidence: 'medium',
          reason: 'Found in conversation history',
        }
      }

      // Look for contradictions
      if (this.findContradiction(fact.claim, message)) {
        fact.conflictingEvidence.push(message)
        return {
          fact,
          isValid: false,
          confidence: 'high',
          reason: 'Contradicts conversation history',
        }
      }
    }

    return {
      fact,
      isValid: false,
      confidence: 'low',
      reason: 'Not found in conversation history',
    }
  }

  /**
   * Find contradictions between claim and message
   */
  private findContradiction(claim: string, message: string): boolean {
    // Simple heuristics for detecting contradictions
    const claimLower = claim.toLowerCase()
    const messageLower = message.toLowerCase()

    // Extract subjects and predicates (simplified)
    const negationKeywords = ['not', 'no', 'never', 'false', 'incorrect', 'wrong']

    for (const keyword of negationKeywords) {
      if (messageLower.includes(keyword) && messageLower.includes(claimLower.split(' ')[0])) {
        return true
      }
    }

    // Check for explicit contradictions
    if (claimLower.includes('is') && messageLower.includes('is not')) {
      const claimSubject = claimLower.split(' is ')[0]
      const messageSubject = messageLower.split(' is not ')[0]
      if (claimSubject === messageSubject) {
        return true
      }
    }

    return false
  }

  /**
   * Check internal consistency of a fact
   */
  private checkConsistency(fact: Fact): ValidationResult {
    // Extract numerical values if present
    const numbers = fact.claim.match(/\d+(?:\.\d+)?/g) || []

    // Check for logical consistency (very basic)
    if (numbers.length > 0) {
      // Check if numbers are within reasonable ranges
      for (const num of numbers) {
        const value = parseFloat(num)

        // Extremely large or small numbers might be suspicious
        if (value > 1000000000 || (value < 0.000001 && value > 0)) {
          return {
            fact,
            isValid: false,
            confidence: 'medium',
            reason: 'Numerical value seems unreasonable',
            suggestedCorrection: `Check if ${value} is correct`,
          }
        }
      }
    }

    // Check for contradictions within the fact itself
    if (fact.claim.includes('and') && fact.claim.includes('or')) {
      // Mixed logical operators - might indicate confusion
      return {
        fact,
        isValid: false,
        confidence: 'low',
        reason: 'Claim logic is unclear',
      }
    }

    return {
      fact,
      isValid: true,
      confidence: 'low',
      reason: 'Passes basic consistency checks',
    }
  }

  /**
   * Get detected hallucinations
   */
  getHallucinations(): Fact[] {
    return [...this.hallucinations]
  }

  /**
   * Get validated facts
   */
  getValidatedFacts(): Fact[] {
    return Array.from(this.validatedFacts.values())
  }

  /**
   * Get validation statistics
   */
  getStats(): {
    totalFactsValidated: number
    validFacts: number
    invalidFacts: number
    hallucinationRate: number
    highConfidenceFacts: number
  } {
    const validated = this.getValidatedFacts()
    const valid = validated.filter((f) => f.validated).length
    const invalid = this.hallucinations.length
    const total = valid + invalid

    return {
      totalFactsValidated: total,
      validFacts: valid,
      invalidFacts: invalid,
      hallucinationRate: total > 0 ? invalid / total : 0,
      highConfidenceFacts: validated.filter((f) => f.confidence === 'high').length,
    }
  }

  /**
   * Clear validated facts (for new session)
   */
  clear(): void {
    this.validatedFacts.clear()
    this.toolResults.clear()
    this.conversationHistory = []
    this.hallucinations = []
  }
}
