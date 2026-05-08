/**
 * SelfHealingValidator - Automatic Error Detection & Correction (Phase 4)
 *
 * Detects and corrects errors in model output through:
 * 1. Error Detection: Identifies inconsistencies, tool failures, invalid outputs
 * 2. Validation: Cross-references against multiple sources
 * 3. Correction: Updates memory with accurate information
 * 4. Learning: Records error patterns for future prevention
 */

/**
 * Error type
 */
export type ErrorType = 'hallucination' | 'contradiction' | 'tool_failure' | 'invalid_format' | 'incomplete_response' | 'timeout'

/**
 * Error record
 */
export interface ErrorRecord {
  id: string
  type: ErrorType
  description: string
  detectedAt: number
  correctedAt?: number
  context: string // Original problematic output
  correction?: string // Corrected version
  source: string // Where error was found
  severity: 'low' | 'medium' | 'high' | 'critical'
}

/**
 * Learned pattern
 */
export interface LearnedPattern {
  pattern: string // Pattern description
  errorType: ErrorType
  frequency: number // How often this error occurs
  lastSeen: number
  preventionStrategy?: string
}

/**
 * SelfHealingValidator detects and corrects errors
 */
export class SelfHealingValidator {
  private errors: ErrorRecord[] = []
  private patterns: Map<string, LearnedPattern> = new Map()
  private correctionHistory: Map<string, string> = new Map() // error id -> correction
  private confidenceThreshold: number = 0.8 // Only heal errors with >80% confidence

  /**
   * Detect hallucinations in model output
   */
  detectHallucination(output: string, knownFacts: string[]): ErrorRecord | null {
    // Check for claims not supported by known facts
    const lines = output.split(/[.!?]/).filter((l) => l.trim().length > 10)

    for (const line of lines) {
      const lineLower = line.toLowerCase()

      // Check if line contains unsupported claims
      let supported = false
      for (const fact of knownFacts) {
        if (lineLower.includes(fact.toLowerCase())) {
          supported = true
          break
        }
      }

      if (!supported && this.isClaimStatement(line)) {
        return {
          id: `error_${Date.now()}_${Math.random()}`,
          type: 'hallucination',
          description: `Unsupported claim: "${line.trim()}"`,
          detectedAt: Date.now(),
          context: output,
          source: 'model_output_validation',
          severity: 'high',
        }
      }
    }

    return null
  }

  /**
   * Detect contradictions between outputs
   */
  detectContradiction(current: string, previous: string): ErrorRecord | null {
    const currentLower = current.toLowerCase()
    const previousLower = previous.toLowerCase()

    // Extract subjects from both
    const currentSubjects = this.extractSubjects(current)
    const previousSubjects = this.extractSubjects(previous)

    // Check for contradicting statements about same subject
    for (const subject of currentSubjects) {
      if (previousSubjects.includes(subject)) {
        // Same subject discussed, check for contradictions
        const currentClaim = this.extractClaim(current, subject)
        const previousClaim = this.extractClaim(previous, subject)

        if (currentClaim && previousClaim && currentClaim !== previousClaim) {
          // Check if they actually contradict
          if (this.isContradiction(currentClaim, previousClaim)) {
            return {
              id: `error_${Date.now()}_${Math.random()}`,
              type: 'contradiction',
              description: `Contradictory statements about "${subject}"`,
              detectedAt: Date.now(),
              context: `Current: "${currentClaim}" vs Previous: "${previousClaim}"`,
              source: 'consistency_check',
              severity: 'high',
            }
          }
        }
      }
    }

    return null
  }

  /**
   * Detect tool failures
   */
  detectToolFailure(toolName: string, result: unknown, expectedType?: string): ErrorRecord | null {
    // Check if result indicates failure
    if (result === null || result === undefined) {
      return {
        id: `error_${Date.now()}_${Math.random()}`,
        type: 'tool_failure',
        description: `Tool "${toolName}" returned empty result`,
        detectedAt: Date.now(),
        context: `Tool: ${toolName}`,
        source: 'tool_execution',
        severity: 'high',
      }
    }

    if (typeof result === 'object') {
      const resultObj = result as Record<string, unknown>

      // Check for error indicators
      if (resultObj.error || resultObj.status === 'error' || resultObj.success === false) {
        return {
          id: `error_${Date.now()}_${Math.random()}`,
          type: 'tool_failure',
          description: `Tool "${toolName}" failed: ${resultObj.error || resultObj.message || 'Unknown error'}`,
          detectedAt: Date.now(),
          context: JSON.stringify(result),
          source: 'tool_execution',
          severity: 'critical',
        }
      }

      // Check type mismatch if expected type provided
      if (expectedType && !this.typeMatches(result, expectedType)) {
        return {
          id: `error_${Date.now()}_${Math.random()}`,
          type: 'invalid_format',
          description: `Tool result type mismatch. Expected ${expectedType}, got ${typeof result}`,
          detectedAt: Date.now(),
          context: JSON.stringify(result).substring(0, 200),
          source: 'tool_execution',
          severity: 'medium',
        }
      }
    }

    return null
  }

  /**
   * Detect incomplete responses
   */
  detectIncompleteResponse(output: string, expectedElements: string[]): ErrorRecord | null {
    const outputLower = output.toLowerCase()
    const missingElements: string[] = []

    for (const element of expectedElements) {
      if (!outputLower.includes(element.toLowerCase())) {
        missingElements.push(element)
      }
    }

    if (missingElements.length > 0) {
      // If missing more than 50% of expected elements, it's incomplete
      if (missingElements.length / expectedElements.length > 0.5) {
        return {
          id: `error_${Date.now()}_${Math.random()}`,
          type: 'incomplete_response',
          description: `Response missing expected elements: ${missingElements.join(', ')}`,
          detectedAt: Date.now(),
          context: output.substring(0, 200),
          source: 'response_validation',
          severity: 'medium',
        }
      }
    }

    return null
  }

  /**
   * Record an error
   */
  recordError(error: ErrorRecord): void {
    this.errors.push(error)
    this.updatePatterns(error)
  }

  /**
   * Apply correction to an error
   */
  applyCorrection(errorId: string, correction: string): void {
    const error = this.errors.find((e) => e.id === errorId)
    if (!error) {
      return
    }

    error.correctedAt = Date.now()
    error.correction = correction
    this.correctionHistory.set(errorId, correction)
  }

  /**
   * Update learned patterns based on error
   */
  private updatePatterns(error: ErrorRecord): void {
    // Extract pattern from error description
    const patternKey = `${error.type}_${this.categorizeError(error)}`

    let pattern = this.patterns.get(patternKey)
    if (!pattern) {
      pattern = {
        pattern: error.description,
        errorType: error.type,
        frequency: 1,
        lastSeen: Date.now(),
      }
    } else {
      pattern.frequency++
      pattern.lastSeen = Date.now()
    }

    this.patterns.set(patternKey, pattern)
  }

  /**
   * Categorize error for pattern learning
   */
  private categorizeError(error: ErrorRecord): string {
    // Simple categorization based on description
    if (error.description.includes('unsupported')) return 'unsupported_claim'
    if (error.description.includes('contradictory')) return 'contradiction'
    if (error.description.includes('missing')) return 'missing_element'
    if (error.description.includes('type')) return 'type_mismatch'
    return 'other'
  }

  /**
   * Get prevention strategy for an error type
   */
  getPreventionStrategy(errorType: ErrorType): string {
    const strategies: Record<ErrorType, string> = {
      hallucination:
        'Validate all claims against tool results and conversation history before responding',
      contradiction:
        'Cross-check current response against previous statements before finalizing',
      tool_failure: 'Implement retry logic with exponential backoff and error logging',
      invalid_format: 'Validate response format against schema before returning to user',
      incomplete_response: 'Check that all required elements are present before marking complete',
      timeout: 'Implement timeout handling with graceful degradation',
    }
    return strategies[errorType]
  }

  /**
   * Check if statement is a claim (vs. question, greeting, etc.)
   */
  private isClaimStatement(text: string): boolean {
    const claimPatterns = [/^\w+ (is|has|are|were|was|contains|equals)/i, /^\w+ \d+/, /^the \w+ (is|has)/i]

    return claimPatterns.some((pattern) => pattern.test(text.trim()))
  }

  /**
   * Extract subjects from text
   */
  private extractSubjects(text: string): string[] {
    const subjects: string[] = []
    const subjectPatterns = /^(\w+)[\s\w]*(?:is|has|are|contains)/i

    for (const line of text.split(/[.!?]/)) {
      const match = line.match(subjectPatterns)
      if (match) {
        subjects.push(match[1].toLowerCase())
      }
    }

    return subjects
  }

  /**
   * Extract claim about subject
   */
  private extractClaim(text: string, subject: string): string | null {
    const subjectLower = subject.toLowerCase()
    const regex = new RegExp(`${subjectLower}\\s+(.+?)(?:[.!?]|$)`, 'i')
    const match = text.match(regex)
    return match ? match[1].trim() : null
  }

  /**
   * Check if two claims contradict each other
   */
  private isContradiction(claim1: string, claim2: string): boolean {
    const negationKeywords = ['not', 'no', "isn't", "aren't", "wasn't", "weren't", 'false', 'wrong', 'incorrect']

    const claim1Lower = claim1.toLowerCase()
    const claim2Lower = claim2.toLowerCase()

    // Check if one is negation of other
    for (const keyword of negationKeywords) {
      if (claim1Lower.includes(keyword) && !claim2Lower.includes(keyword)) {
        // Extract the main part (without negation)
        const claim1Main = claim1Lower.replace(keyword, '').trim()
        if (claim2Lower.includes(claim1Main)) {
          return true
        }
      }
    }

    // Direct contradiction detection
    if (claim1Lower.includes('never') && claim2Lower.includes('always')) {
      return true
    }

    return false
  }

  /**
   * Check if value matches expected type
   */
  private typeMatches(value: unknown, expectedType: string): boolean {
    switch (expectedType.toLowerCase()) {
      case 'string':
        return typeof value === 'string'
      case 'number':
        return typeof value === 'number'
      case 'boolean':
        return typeof value === 'boolean'
      case 'array':
        return Array.isArray(value)
      case 'object':
        return typeof value === 'object' && value !== null
      default:
        return true
    }
  }

  /**
   * Get error statistics
   */
  getStats(): {
    totalErrors: number
    hallucinations: number
    contradictions: number
    toolFailures: number
    correctedErrors: number
    errorRate: number
    topPatterns: LearnedPattern[]
  } {
    const hallucinations = this.errors.filter((e) => e.type === 'hallucination').length
    const contradictions = this.errors.filter((e) => e.type === 'contradiction').length
    const toolFailures = this.errors.filter((e) => e.type === 'tool_failure').length
    const correctedErrors = this.errors.filter((e) => e.correctedAt).length

    const sortedPatterns = Array.from(this.patterns.values()).sort((a, b) => b.frequency - a.frequency)

    return {
      totalErrors: this.errors.length,
      hallucinations,
      contradictions,
      toolFailures,
      correctedErrors,
      errorRate: this.errors.length > 0 ? correctedErrors / this.errors.length : 0,
      topPatterns: sortedPatterns.slice(0, 5),
    }
  }

  /**
   * Clear error history (for new session)
   */
  clear(): void {
    this.errors = []
    this.correctionHistory.clear()
    this.patterns.clear()
  }
}
