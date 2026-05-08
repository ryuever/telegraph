/**
 * MemoryTierManager - Multi-Tier Memory Architecture (Phase 4)
 *
 * Manages conversation context across 3 tiers:
 * - Tier 1 (Working): Last 5 messages, <10ms access, in-memory only
 * - Tier 2 (Short-term): Last 20-50 messages, <50ms access, 24h TTL, SQLite
 * - Tier 3 (Medium-term): Summarized conversation arcs, <200ms access, 30-day TTL
 *
 * Automatically manages message lifecycle:
 * - New messages enter Tier 1 (working memory)
 * - Age out to Tier 2 after 24 hours or when Tier 1 is full
 * - Summarize and move to Tier 3 after 30 days
 */

import type { Message } from '../sessionManagement/Session'

/**
 * Memory tier configuration
 */
export interface MemoryTierConfig {
  tier1: {
    maxMessages: number // Default: 5
    maxAgeMs: number // Default: 10 minutes
  }
  tier2: {
    maxMessages: number // Default: 50
    maxAgeMs: number // Default: 24 hours
    persistenceType: 'memory' | 'sqlite' | 'file' // Where to store
  }
  tier3: {
    maxAgeMs: number // Default: 30 days
    compressionRatio: number // Summarize to N% of original
  }
}

/**
 * Memory tier levels
 */
export type MemoryTier = 'tier1' | 'tier2' | 'tier3'

/**
 * Message with tier metadata
 */
export interface TieredMessage extends Message {
  tier: MemoryTier
  addedAtTs: number // When message was added to this tier
  compressionRatio?: number // For tier3 summarized messages
  originalMessageCount?: number // For tier3 arcs
}

/**
 * Memory statistics
 */
export interface MemoryStats {
  tier1MessageCount: number
  tier2MessageCount: number
  tier3MessageCount: number
  totalMessages: number
  tier1SizeBytes: number
  tier2SizeBytes: number
  tier3SizeBytes: number
  totalSizeBytes: number
  tier1AccessCount: number
  tier2AccessCount: number
  tier3AccessCount: number
  compressionRatio: number // tier3 size / original size
}

/**
 * MemoryTierManager manages conversation context across multiple tiers
 */
export class MemoryTierManager {
  private tier1: TieredMessage[] = [] // Working memory (in-process)
  private tier2: TieredMessage[] = [] // Short-term (persistent storage)
  private tier3: TieredMessage[] = [] // Medium-term (summarized arcs)

  private config: MemoryTierConfig
  private accessCounts = { tier1: 0, tier2: 0, tier3: 0 }
  private sessionId: string

  constructor(sessionId: string, config?: Partial<MemoryTierConfig>) {
    this.sessionId = sessionId

    // Default configuration
    this.config = {
      tier1: {
        maxMessages: config?.tier1?.maxMessages ?? 5,
        maxAgeMs: config?.tier1?.maxAgeMs ?? 10 * 60 * 1000, // 10 minutes
      },
      tier2: {
        maxMessages: config?.tier2?.maxMessages ?? 50,
        maxAgeMs: config?.tier2?.maxAgeMs ?? 24 * 60 * 60 * 1000, // 24 hours
        persistenceType: config?.tier2?.persistenceType ?? 'memory',
      },
      tier3: {
        maxAgeMs: config?.tier3?.maxAgeMs ?? 30 * 24 * 60 * 60 * 1000, // 30 days
        compressionRatio: config?.tier3?.compressionRatio ?? 0.2, // 20% of original
      },
    }
  }

  /**
   * Add a message to the memory system (enters Tier 1)
   */
  addMessage(message: Message): void {
    const tieredMessage: TieredMessage = {
      ...message,
      tier: 'tier1',
      addedAtTs: Date.now(),
    }

    this.tier1.push(tieredMessage)

    // Check if we need to promote messages to tier2
    this.checkPromotions()
  }

  /**
   * Get all messages in order across tiers
   */
  getAllMessages(): TieredMessage[] {
    const all: TieredMessage[] = []

    // Tier 1 (most recent)
    all.push(...this.tier1)

    // Tier 2 (older)
    all.push(...this.tier2)

    // Tier 3 (oldest, summarized)
    all.push(...this.tier3)

    return all
  }

  /**
   * Get messages from a specific tier
   */
  getMessagesByTier(tier: MemoryTier): TieredMessage[] {
    switch (tier) {
      case 'tier1':
        this.accessCounts.tier1++
        return [...this.tier1]
      case 'tier2':
        this.accessCounts.tier2++
        return [...this.tier2]
      case 'tier3':
        this.accessCounts.tier3++
        return [...this.tier3]
    }
  }

  /**
   * Get the most recent N messages (may span multiple tiers)
   */
  getRecentMessages(count: number): TieredMessage[] {
    const all = this.getAllMessages()
    return all.slice(Math.max(0, all.length - count))
  }

  /**
   * Get messages around a specific timestamp (for context)
   */
  getMessagesAround(targetTs: number, windowMs: number = 60000): TieredMessage[] {
    return this.getAllMessages().filter((msg) => {
      const timeDiff = Math.abs(msg.ts - targetTs)
      return timeDiff <= windowMs
    })
  }

  /**
   * Check if any messages need to be promoted to higher tiers
   */
  private checkPromotions(): void {
    const now = Date.now()

    // Promote from Tier 1 to Tier 2
    this.promoteFromTier1ToTier2(now)

    // Promote from Tier 2 to Tier 3
    this.promoteFromTier2ToTier3(now)

    // Clean up expired messages in Tier 3
    this.cleanupExpiredTier3Messages(now)
  }

  /**
   * Promote old messages from Tier 1 to Tier 2
   */
  private promoteFromTier1ToTier2(now: number): void {
    const promoted: TieredMessage[] = []
    const remaining: TieredMessage[] = []

    for (const msg of this.tier1) {
      const age = now - msg.addedAtTs
      const exceedsAge = age > this.config.tier1.maxAgeMs
      const exceedsCount = this.tier1.length > this.config.tier1.maxMessages

      if (exceedsAge || exceedsCount) {
        // Promote to tier2
        const tieredMsg: TieredMessage = {
          ...msg,
          tier: 'tier2',
          addedAtTs: now,
        }
        promoted.push(tieredMsg)
      } else {
        remaining.push(msg)
      }
    }

    this.tier1 = remaining
    this.tier2.push(...promoted)

    // Keep Tier 2 within limits
    if (this.tier2.length > this.config.tier2.maxMessages) {
      const excess = this.tier2.length - this.config.tier2.maxMessages
      const toRemove = this.tier2.splice(0, excess)
      // Could save to persistence here if configured
    }
  }

  /**
   * Promote old messages from Tier 2 to Tier 3 (summarized)
   */
  private promoteFromTier2ToTier3(now: number): void {
    const promoted: TieredMessage[] = []
    const remaining: TieredMessage[] = []

    for (const msg of this.tier2) {
      const age = now - msg.addedAtTs
      const exceedsAge = age > this.config.tier2.maxAgeMs

      if (exceedsAge) {
        // In real implementation, these would be summarized
        // For now, just mark them as being in tier3
        const tieredMsg: TieredMessage = {
          ...msg,
          tier: 'tier3',
          addedAtTs: now,
          compressionRatio: this.config.tier3.compressionRatio,
          originalMessageCount: 1, // Would aggregate multiple messages
        }
        promoted.push(tieredMsg)
      } else {
        remaining.push(msg)
      }
    }

    this.tier2 = remaining
    this.tier3.push(...promoted)
  }

  /**
   * Clean up expired messages in Tier 3
   */
  private cleanupExpiredTier3Messages(now: number): void {
    this.tier3 = this.tier3.filter((msg) => {
      const age = now - msg.addedAtTs
      return age <= this.config.tier3.maxAgeMs
    })
  }

  /**
   * Manually promote messages from tier1 to tier2
   */
  promoteTier1ToTier2(): number {
    const now = Date.now()
    this.promoteFromTier1ToTier2(now)
    return this.tier2.length
  }

  /**
   * Manually promote messages from tier2 to tier3
   */
  promoteTier2ToTier3(): number {
    const now = Date.now()
    this.promoteFromTier2ToTier3(now)
    return this.tier3.length
  }

  /**
   * Get the context window for LLM (optimized for token efficiency)
   */
  getContextWindow(maxTokens: number): TieredMessage[] {
    // Strategy: Include all of Tier 1, then backfill with Tier 2/3 if space available
    const messages: TieredMessage[] = []
    let estimatedTokens = 0

    // Add all Tier 1 messages (working memory)
    messages.push(...this.tier1)
    estimatedTokens += this.tier1.reduce((sum, msg) => sum + this.estimateTokens(msg.content), 0)

    // Add Tier 2 messages in reverse order (most recent first)
    for (let i = this.tier2.length - 1; i >= 0 && estimatedTokens < maxTokens * 0.7; i--) {
      const msg = this.tier2[i]
      const tokens = this.estimateTokens(msg.content)
      if (estimatedTokens + tokens < maxTokens * 0.8) {
        messages.unshift(msg)
        estimatedTokens += tokens
      }
    }

    // Add summary from Tier 3 if there's space
    if (this.tier3.length > 0 && estimatedTokens < maxTokens * 0.8) {
      const summary = this.tier3[this.tier3.length - 1] // Most recent summary
      messages.unshift(summary)
    }

    return messages
  }

  /**
   * Estimate token count for a message (rough approximation)
   */
  private estimateTokens(text: string): number {
    // Average: ~4 characters per token
    return Math.ceil(text.length / 4)
  }

  /**
   * Clear old messages (manual cleanup)
   */
  clearOlderThan(ageMs: number): number {
    const now = Date.now()
    const before = this.getAllMessages().length

    this.tier1 = this.tier1.filter((msg) => now - msg.addedAtTs <= ageMs)
    this.tier2 = this.tier2.filter((msg) => now - msg.addedAtTs <= ageMs)
    this.tier3 = this.tier3.filter((msg) => now - msg.addedAtTs <= ageMs)

    const after = this.getAllMessages().length
    return before - after
  }

  /**
   * Get memory statistics
   */
  getStats(): MemoryStats {
    let tier1Bytes = 0
    let tier2Bytes = 0
    let tier3Bytes = 0

    for (const msg of this.tier1) {
      tier1Bytes += msg.content.length + 100 // Content + metadata estimate
    }
    for (const msg of this.tier2) {
      tier2Bytes += msg.content.length + 100
    }
    for (const msg of this.tier3) {
      tier3Bytes += msg.content.length + 100
    }

    const totalBytes = tier1Bytes + tier2Bytes + tier3Bytes
    const totalMessages = this.tier1.length + this.tier2.length + this.tier3.length
    const originalSize = totalBytes / (this.config.tier3.compressionRatio || 1)

    return {
      tier1MessageCount: this.tier1.length,
      tier2MessageCount: this.tier2.length,
      tier3MessageCount: this.tier3.length,
      totalMessages,
      tier1SizeBytes: tier1Bytes,
      tier2SizeBytes: tier2Bytes,
      tier3SizeBytes: tier3Bytes,
      totalSizeBytes: totalBytes,
      tier1AccessCount: this.accessCounts.tier1,
      tier2AccessCount: this.accessCounts.tier2,
      tier3AccessCount: this.accessCounts.tier3,
      compressionRatio: originalSize > 0 ? totalBytes / originalSize : 1,
    }
  }

  /**
   * Clear all messages
   */
  clear(): void {
    this.tier1 = []
    this.tier2 = []
    this.tier3 = []
    this.accessCounts = { tier1: 0, tier2: 0, tier3: 0 }
  }

  /**
   * Export memory state for persistence
   */
  export(): { tier1: TieredMessage[]; tier2: TieredMessage[]; tier3: TieredMessage[] } {
    return {
      tier1: [...this.tier1],
      tier2: [...this.tier2],
      tier3: [...this.tier3],
    }
  }

  /**
   * Import memory state from persistence
   */
  import(state: { tier1: TieredMessage[]; tier2: TieredMessage[]; tier3: TieredMessage[] }): void {
    this.tier1 = [...state.tier1]
    this.tier2 = [...state.tier2]
    this.tier3 = [...state.tier3]
  }
}
