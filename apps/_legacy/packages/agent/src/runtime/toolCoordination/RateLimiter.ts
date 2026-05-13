/**
 * RateLimiter for Tool Execution (Phase 3.4)
 *
 * Controls the rate at which tools are executed to prevent:
 * - Overwhelming external APIs
 * - Resource exhaustion
 * - Triggering rate limit errors
 *
 * Implements token bucket algorithm for per-tool rate limiting.
 */

/**
 * Rate limit configuration for a tool.
 */
export interface RateLimitConfig {
  toolId: string
  maxRequestsPerSecond: number // Tokens per second (refill rate)
  burstSize?: number // Maximum tokens that can accumulate (defaults to maxRequestsPerSecond)
  cooldownMs?: number // Minimum time between requests (ms)
}

/**
 * Rate limit state for a tool.
 */
interface TokenBucket {
  tokens: number
  lastRefillTs: number
  cooldownUntilTs: number
}

/**
 * Result of attempting to acquire rate limit tokens.
 */
export interface RateLimitResult {
  allowed: boolean
  retryAfterMs?: number // How long to wait if not allowed
  tokensRemaining?: number
}

/**
 * RateLimiter manages per-tool rate limiting using token bucket algorithm.
 */
export class RateLimiter {
  private buckets: Map<string, TokenBucket> = new Map()
  private configs: Map<string, RateLimitConfig> = new Map()

  /**
   * Register a rate limit configuration for a tool.
   */
  registerTool(config: RateLimitConfig): void {
    this.configs.set(config.toolId, config)

    // Initialize bucket
    const burstSize = config.burstSize ?? config.maxRequestsPerSecond
    this.buckets.set(config.toolId, {
      tokens: burstSize, // Start with full burst capacity
      lastRefillTs: Date.now(),
      cooldownUntilTs: 0,
    })
  }

  /**
   * Remove rate limiting for a tool.
   */
  unregisterTool(toolId: string): void {
    this.configs.delete(toolId)
    this.buckets.delete(toolId)
  }

  /**
   * Check if a tool is rate limited (registered).
   */
  isRateLimited(toolId: string): boolean {
    return this.configs.has(toolId)
  }

  /**
   * Attempt to acquire tokens from the bucket.
   * Returns whether the request should be allowed.
   */
  tryAcquire(toolId: string, tokensRequested = 1): RateLimitResult {
    const config = this.configs.get(toolId)
    if (!config) {
      // No rate limit configured, always allow
      return { allowed: true }
    }

    let bucket = this.buckets.get(toolId)
    if (!bucket) {
      // Initialize if missing
      const burstSize = config.burstSize ?? config.maxRequestsPerSecond
      bucket = {
        tokens: burstSize,
        lastRefillTs: Date.now(),
        cooldownUntilTs: 0,
      }
      this.buckets.set(toolId, bucket)
    }

    // Refill tokens based on time elapsed
    const now = Date.now()
    const elapsedMs = now - bucket.lastRefillTs
    const tokensGenerated = (elapsedMs / 1000) * config.maxRequestsPerSecond

    const burstSize = config.burstSize ?? config.maxRequestsPerSecond
    bucket.tokens = Math.min(burstSize, bucket.tokens + tokensGenerated)
    bucket.lastRefillTs = now

    // Check cooldown
    if (bucket.cooldownUntilTs > now) {
      const retryAfterMs = bucket.cooldownUntilTs - now
      return {
        allowed: false,
        retryAfterMs,
        tokensRemaining: Math.floor(bucket.tokens),
      }
    }

    // Check if we have enough tokens
    if (bucket.tokens >= tokensRequested) {
      bucket.tokens -= tokensRequested

      // Apply cooldown if configured
      if (config.cooldownMs) {
        bucket.cooldownUntilTs = now + config.cooldownMs
      }

      return {
        allowed: true,
        tokensRemaining: Math.floor(bucket.tokens),
      }
    }

    // Not enough tokens, calculate how long to wait
    const tokensNeeded = tokensRequested - bucket.tokens
    const refillTimeMs = (tokensNeeded / config.maxRequestsPerSecond) * 1000
    const retryAfterMs = Math.ceil(refillTimeMs)

    return {
      allowed: false,
      retryAfterMs,
      tokensRemaining: Math.floor(bucket.tokens),
    }
  }

  /**
   * Wait until tokens are available (async).
   * Useful for respecting rate limits without explicit retry logic.
   */
  async waitAcquire(toolId: string, tokensRequested = 1): Promise<void> {
    while (true) {
      const result = this.tryAcquire(toolId, tokensRequested)
      if (result.allowed) {
        return
      }

      // Wait and retry
      const waitMs = Math.min(result.retryAfterMs ?? 1000, 10000) // Cap at 10 seconds
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
  }

  /**
   * Reset the rate limit for a tool (refill tokens and clear cooldown).
   */
  reset(toolId: string): void {
    const config = this.configs.get(toolId)
    if (!config) {
      return
    }

    const burstSize = config.burstSize ?? config.maxRequestsPerSecond
    this.buckets.set(toolId, {
      tokens: burstSize,
      lastRefillTs: Date.now(),
      cooldownUntilTs: 0,
    })
  }

  /**
   * Reset all rate limits.
   */
  resetAll(): void {
    for (const toolId of this.configs.keys()) {
      this.reset(toolId)
    }
  }

  /**
   * Get the current state of a tool's rate limit.
   */
  getStatus(toolId: string): { config?: RateLimitConfig; state?: TokenBucket } {
    return {
      config: this.configs.get(toolId),
      state: this.buckets.get(toolId),
    }
  }

  /**
   * Get rate limit statistics for all registered tools.
   */
  getStats(): Array<{
    toolId: string
    tokensRemaining: number
    maxTokens: number
    percentUsed: number
    cooldownRemainingMs: number
  }> {
    const stats = []

    for (const [toolId, config] of this.configs.entries()) {
      const bucket = this.buckets.get(toolId)
      if (!bucket) {
        continue
      }

      // Refresh tokens first
      const now = Date.now()
      const elapsedMs = now - bucket.lastRefillTs
      const tokensGenerated = (elapsedMs / 1000) * config.maxRequestsPerSecond

      const burstSize = config.burstSize ?? config.maxRequestsPerSecond
      const currentTokens = Math.min(burstSize, bucket.tokens + tokensGenerated)

      const cooldownRemaining = Math.max(0, bucket.cooldownUntilTs - now)

      stats.push({
        toolId,
        tokensRemaining: Math.floor(currentTokens),
        maxTokens: burstSize,
        percentUsed: ((burstSize - currentTokens) / burstSize) * 100,
        cooldownRemainingMs: cooldownRemaining,
      })
    }

    return stats
  }

  /**
   * Clear all rate limit configurations.
   */
  clear(): void {
    this.configs.clear()
    this.buckets.clear()
  }
}
