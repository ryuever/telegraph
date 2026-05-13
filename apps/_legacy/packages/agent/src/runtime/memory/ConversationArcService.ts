/**
 * ConversationArcService - Conversation Summarization (Phase 4)
 *
 * Summarizes sequences of messages into concise "conversation arcs"
 * that capture key information while reducing token usage.
 *
 * Arc types:
 * - Information Exchange: User asks, assistant answers
 * - Problem Resolution: Issue raised, solution provided
 * - Clarification Loop: Question, clarification, answer
 * - Tool Coordination: Tool calls, results, feedback
 */

import type { Message } from '../sessionManagement/Session'

/**
 * Types of conversation arcs
 */
export type ArcType = 'info_exchange' | 'problem_resolution' | 'clarification_loop' | 'tool_coordination' | 'generic'

/**
 * A summarized sequence of messages
 */
export interface ConversationArc {
  type: ArcType
  startIndex: number // Index in original message array
  endIndex: number // Index in original message array
  messageCount: number // How many messages were summarized
  summary: string // Concise summary
  keyPoints: string[] // Important facts
  tokens: number // Estimated token count
  compressionRatio: number // summary tokens / original tokens
  timestamp: number // When this arc was created
  metadata?: Record<string, unknown>
}

/**
 * ConversationArcService creates and manages conversation arcs
 */
export class ConversationArcService {
  private minArcSize: number = 3 // Minimum messages to summarize
  private maxArcSize: number = 20 // Maximum messages in an arc

  constructor(minArcSize?: number, maxArcSize?: number) {
    if (minArcSize) this.minArcSize = minArcSize
    if (maxArcSize) this.maxArcSize = maxArcSize
  }

  /**
   * Identify and summarize conversation arcs from messages
   */
  identifyArcs(messages: Message[]): ConversationArc[] {
    const arcs: ConversationArc[] = []

    if (messages.length < this.minArcSize) {
      return arcs
    }

    let i = 0
    while (i < messages.length) {
      // Try to find an arc starting from position i
      const arc = this.findArcStartingAt(messages, i)

      if (arc && arc.endIndex - arc.startIndex >= this.minArcSize - 1) {
        arcs.push(arc)
        i = arc.endIndex + 1
      } else {
        i++
      }
    }

    return arcs
  }

  /**
   * Find a conversation arc starting at a specific message index
   */
  private findArcStartingAt(messages: Message[], startIndex: number): ConversationArc | null {
    // Look for patterns that constitute an arc

    // Pattern 1: User -> Assistant -> User (clarification loop)
    if (
      startIndex + 2 < messages.length &&
      messages[startIndex].role === 'user' &&
      messages[startIndex + 1].role === 'assistant' &&
      messages[startIndex + 2].role === 'user'
    ) {
      return this.createClarificationArc(messages, startIndex)
    }

    // Pattern 2: User -> Tool calls -> Results (tool coordination)
    if (
      startIndex + 1 < messages.length &&
      messages[startIndex].role === 'user' &&
      messages[startIndex + 1].role === 'assistant' &&
      messages[startIndex + 1].content.toLowerCase().includes('tool') // Heuristic
    ) {
      return this.createToolArc(messages, startIndex)
    }

    // Pattern 3: Information exchange (user -> assistant)
    if (
      startIndex + 1 < messages.length &&
      messages[startIndex].role === 'user' &&
      messages[startIndex + 1].role === 'assistant'
    ) {
      return this.createInfoArc(messages, startIndex)
    }

    return null
  }

  /**
   * Create an info exchange arc
   */
  private createInfoArc(messages: Message[], startIndex: number): ConversationArc {
    const arcMessages = [messages[startIndex], messages[startIndex + 1]]
    const endIndex = startIndex + 1

    const userMsg = messages[startIndex].content
    const assistantMsg = messages[startIndex + 1].content

    // Extract key points
    const keyPoints = this.extractKeyPoints(assistantMsg)

    // Create summary
    const summary = this.summarizeInfoExchange(userMsg, assistantMsg)

    const originalTokens = this.estimateTokens(arcMessages.map((m) => m.content).join('\n'))
    const summaryTokens = this.estimateTokens(summary)

    return {
      type: 'info_exchange',
      startIndex,
      endIndex,
      messageCount: arcMessages.length,
      summary,
      keyPoints,
      tokens: summaryTokens,
      compressionRatio: summaryTokens / originalTokens,
      timestamp: Date.now(),
    }
  }

  /**
   * Create a clarification loop arc
   */
  private createClarificationArc(messages: Message[], startIndex: number): ConversationArc {
    const arcMessages = messages.slice(startIndex, Math.min(startIndex + 4, messages.length))
    const endIndex = startIndex + arcMessages.length - 1

    const keyPoints = this.extractKeyPoints(
      arcMessages.map((m) => m.content).join('\n')
    )

    const summary = `User asked a question, requested clarification, and received an answer. Resolution: ${keyPoints[0] || 'Clarification provided'}`

    const originalTokens = this.estimateTokens(arcMessages.map((m) => m.content).join('\n'))
    const summaryTokens = this.estimateTokens(summary)

    return {
      type: 'clarification_loop',
      startIndex,
      endIndex,
      messageCount: arcMessages.length,
      summary,
      keyPoints,
      tokens: summaryTokens,
      compressionRatio: summaryTokens / originalTokens,
      timestamp: Date.now(),
    }
  }

  /**
   * Create a tool coordination arc
   */
  private createToolArc(messages: Message[], startIndex: number): ConversationArc {
    const arcMessages = messages.slice(startIndex, Math.min(startIndex + 5, messages.length))
    const endIndex = startIndex + arcMessages.length - 1

    // Extract tool information
    const allText = arcMessages.map((m) => m.content).join('\n')
    const toolMatches = allText.match(/tool_call|tool_result|tool_error/g) || []
    const toolCount = toolMatches.length

    const keyPoints = this.extractKeyPoints(allText)
    const summary = `Executed ${toolCount} tool operations to accomplish task: ${keyPoints[0] || 'Task completed'}`

    const originalTokens = this.estimateTokens(allText)
    const summaryTokens = this.estimateTokens(summary)

    return {
      type: 'tool_coordination',
      startIndex,
      endIndex,
      messageCount: arcMessages.length,
      summary,
      keyPoints,
      tokens: summaryTokens,
      compressionRatio: summaryTokens / originalTokens,
      timestamp: Date.now(),
    }
  }

  /**
   * Extract key points from text using heuristics
   */
  private extractKeyPoints(text: string): string[] {
    const points: string[] = []

    // Look for sentences ending with periods, questions, or important phrases
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 10)

    // Take up to 3 key sentences
    for (const sentence of sentences.slice(0, 3)) {
      const trimmed = sentence.trim()
      if (trimmed.length > 10 && trimmed.length < 200) {
        points.push(trimmed)
      }
    }

    return points.length > 0 ? points : ['Information discussed']
  }

  /**
   * Summarize an info exchange
   */
  private summarizeInfoExchange(userMsg: string, assistantMsg: string): string {
    // Extract first sentence from each
    const userQuestion = userMsg.split(/[.!?]/)[0].trim().substring(0, 100)
    const assistantAnswer = assistantMsg.split(/[.!?]/)[0].trim().substring(0, 150)

    return `User asked: "${userQuestion}". Response: "${assistantAnswer}"`
  }

  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }

  /**
   * Merge multiple arcs into a single consolidated arc
   */
  mergeArcs(arcs: ConversationArc[], messages: Message[]): ConversationArc {
    if (arcs.length === 0) {
      throw new Error('Cannot merge empty arc list')
    }

    const firstArc = arcs[0]
    const lastArc = arcs[arcs.length - 1]

    // Combine all key points
    const allKeyPoints = arcs.flatMap((arc) => arc.keyPoints)
    const uniqueKeyPoints = Array.from(new Set(allKeyPoints)).slice(0, 5)

    // Combine all summaries
    const combinedSummary = arcs.map((arc) => arc.summary).join(' ')

    // Get original tokens (from start of first arc to end of last arc)
    const originalMessages = messages.slice(firstArc.startIndex, lastArc.endIndex + 1)
    const originalTokens = this.estimateTokens(originalMessages.map((m) => m.content).join('\n'))

    const summaryTokens = this.estimateTokens(combinedSummary)

    return {
      type: 'generic',
      startIndex: firstArc.startIndex,
      endIndex: lastArc.endIndex,
      messageCount: arcs.reduce((sum, arc) => sum + arc.messageCount, 0),
      summary: combinedSummary.substring(0, 500),
      keyPoints: uniqueKeyPoints,
      tokens: summaryTokens,
      compressionRatio: summaryTokens / originalTokens,
      timestamp: Date.now(),
    }
  }

  /**
   * Decompress an arc back to original messages (for context)
   * In real system, would retrieve from storage
   */
  decompressArc(arc: ConversationArc, originalMessages: Message[]): Message[] {
    if (arc.endIndex < originalMessages.length) {
      return originalMessages.slice(arc.startIndex, arc.endIndex + 1)
    }
    return []
  }

  /**
   * Get compression statistics for a set of arcs
   */
  getCompressionStats(
    arcs: ConversationArc[]
  ): {
    totalOriginalTokens: number
    totalCompressedTokens: number
    totalCompressionRatio: number
    averageArcSize: number
    arcCount: number
  } {
    const totalOriginalTokens = arcs.reduce((sum, arc) => sum + Math.ceil(arc.tokens / arc.compressionRatio), 0)
    const totalCompressedTokens = arcs.reduce((sum, arc) => sum + arc.tokens, 0)

    return {
      totalOriginalTokens,
      totalCompressedTokens,
      totalCompressionRatio: totalCompressedTokens / totalOriginalTokens,
      averageArcSize: arcs.reduce((sum, arc) => sum + arc.messageCount, 0) / arcs.length,
      arcCount: arcs.length,
    }
  }

  /**
   * Filter arcs to keep only the most important ones
   */
  filterImportantArcs(arcs: ConversationArc[], maxArcs: number): ConversationArc[] {
    // Sort by: key point count (descending), then compression ratio (ascending)
    // Prefer arcs with more key points (more information) and better compression
    const sorted = [...arcs].sort((a, b) => {
      const keyPointDiff = b.keyPoints.length - a.keyPoints.length
      if (keyPointDiff !== 0) return keyPointDiff
      return a.compressionRatio - b.compressionRatio
    })

    return sorted.slice(0, maxArcs)
  }
}
