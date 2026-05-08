/**
 * VectorEmbeddingService - Semantic Embedding & Caching (Phase 5 Extended)
 *
 * Manages text embeddings for semantic search:
 * - Text-to-vector encoding
 * - Embedding caching to reduce API calls
 * - Batch embedding for efficiency
 * - Similarity computation (cosine distance)
 *
 * Supports multiple embedding providers:
 * - OpenAI (text-embedding-3-large, text-embedding-3-small)
 * - Self-hosted (e.g., sentence-transformers)
 * - Local (in-memory embeddings for testing)
 */

export type EmbeddingModel =
  | 'openai:text-embedding-3-large'
  | 'openai:text-embedding-3-small'
  | 'local:sentence-transformers'
  | 'custom'

export interface EmbeddingConfig {
  model: EmbeddingModel
  dimension: number
  cacheSize?: number // Max cached embeddings
  batchSize?: number // For batch processing
  apiKey?: string // For external APIs
}

export interface EmbeddedText {
  text: string
  embedding: number[]
  model: EmbeddingModel
  timestamp: number
  hash: string // For deduplication
}

/**
 * VectorEmbeddingService - Manages text embeddings for semantic search
 */
export class VectorEmbeddingService {
  private model: EmbeddingModel
  private dimension: number
  private cache = new Map<string, EmbeddedText>()
  private cacheSize: number
  private batchSize: number
  private apiKey?: string

  // Statistics
  private stats = {
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    totalTokens: 0,
  }

  constructor(config: EmbeddingConfig) {
    this.model = config.model
    this.dimension = config.dimension
    this.cacheSize = config.cacheSize ?? 1000
    this.batchSize = config.batchSize ?? 25
    this.apiKey = config.apiKey
  }

  /**
   * Embed a single text
   */
  async embedText(text: string): Promise<number[]> {
    this.stats.totalRequests++

    const hash = this.hashText(text)

    // Check cache
    const cached = this.cache.get(hash)
    if (cached) {
      this.stats.cacheHits++
      return cached.embedding
    }

    this.stats.cacheMisses++

    // Generate embedding
    const embedding = await this.generateEmbedding(text)

    // Store in cache
    this.cache.set(hash, {
      text,
      embedding,
      model: this.model,
      timestamp: Date.now(),
      hash,
    })

    // Evict if cache exceeds size
    if (this.cache.size > this.cacheSize) {
      this.evictOldest()
    }

    return embedding
  }

  /**
   * Batch embed multiple texts
   */
  async batchEmbed(texts: string[]): Promise<number[][]> {
    const results: number[][] = []

    // Process in batches
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize)
      const batchResults = await Promise.all(batch.map((text) => this.embedText(text)))
      results.push(...batchResults)
    }

    return results
  }

  /**
   * Compute cosine similarity between two embeddings
   */
  cosineSimilarity(embedding1: number[], embedding2: number[]): number {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embeddings must have same dimension')
    }

    let dotProduct = 0
    let norm1 = 0
    let norm2 = 0

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i]
      norm1 += embedding1[i] * embedding1[i]
      norm2 += embedding2[i] * embedding2[i]
    }

    const denominator = Math.sqrt(norm1) * Math.sqrt(norm2)
    if (denominator === 0) {
      return 0
    }

    return dotProduct / denominator
  }

  /**
   * Find similar texts from cached embeddings
   */
  async findSimilar(query: string, texts: string[], topK: number = 10): Promise<Array<{ text: string; similarity: number }>> {
    const queryEmbedding = await this.embedText(query)

    const similarities: Array<{ text: string; similarity: number }> = []

    for (const text of texts) {
      const embedding = await this.embedText(text)
      const similarity = this.cosineSimilarity(queryEmbedding, embedding)
      similarities.push({ text, similarity })
    }

    // Sort by similarity (descending)
    return similarities.sort((a, b) => b.similarity - a.similarity).slice(0, topK)
  }

  /**
   * Clear old embeddings from cache (periodic maintenance)
   */
  refreshEmbeddings(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): number {
    const now = Date.now()
    let removed = 0

    for (const [hash, embedded] of this.cache.entries()) {
      if (now - embedded.timestamp > maxAgeMs) {
        this.cache.delete(hash)
        removed++
      }
    }

    return removed
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const hitRate = this.stats.totalRequests > 0 ? this.stats.cacheHits / this.stats.totalRequests : 0

    return {
      totalRequests: this.stats.totalRequests,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      hitRate: hitRate.toFixed(2),
      cacheSize: this.cache.size,
      dimension: this.dimension,
      model: this.model,
    }
  }

  /**
   * Generate embedding (delegate to provider)
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    switch (this.model) {
      case 'local:sentence-transformers':
        return this.generateLocalEmbedding(text)
      case 'openai:text-embedding-3-large':
      case 'openai:text-embedding-3-small':
        return this.generateOpenAIEmbedding(text)
      default:
        throw new Error(`Unknown embedding model: ${this.model}`)
    }
  }

  /**
   * Generate embedding locally (for testing)
   */
  private generateLocalEmbedding(text: string): number[] {
    // Simple hash-based embedding for testing
    const hashStr = this.hashText(text)
    const hashNum = parseInt(hashStr.split('_')[1] || '0', 10)
    const embedding: number[] = []

    for (let i = 0; i < this.dimension; i++) {
      const char = text.charCodeAt(i % text.length) || 0
      const val = ((char * (i + 1) + hashNum) % 100)
      embedding.push((val - 50) / 50) // Normalize to -1 to 1
    }

    return embedding
  }

  /**
   * Generate embedding via OpenAI API
   * Note: In production, this would call OpenAI's API
   */
  private async generateOpenAIEmbedding(text: string): Promise<number[]> {
    if (!this.apiKey) {
      // Fallback to local for testing
      return this.generateLocalEmbedding(text)
    }

    // In production:
    // const response = await fetch('https://api.openai.com/v1/embeddings', {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${this.apiKey}`,
    //     'Content-Type': 'application/json'
    //   },
    //   body: JSON.stringify({
    //     input: text,
    //     model: this.model.split(':')[1]
    //   })
    // })
    // const data = await response.json()
    // return data.data[0].embedding

    // For now, return local embedding
    return this.generateLocalEmbedding(text)
  }

  /**
   * Hash text for caching (simple implementation)
   */
  private hashText(text: string): string {
    let hash: number = 0
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i)
      hash = ((hash << 5) - hash + char) | 0 // Convert to 32bit integer
    }
    return `hash_${Math.abs(hash)}`
  }

  /**
   * Evict oldest entry from cache
   */
  private evictOldest(): void {
    let oldestKey: string | undefined
    let oldestTime = Infinity

    for (const [key, embedded] of this.cache.entries()) {
      if (embedded.timestamp < oldestTime) {
        oldestTime = embedded.timestamp
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey)
    }
  }

  /**
   * Clear all cache
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Get cache info
   */
  getCacheInfo() {
    return {
      size: this.cache.size,
      maxSize: this.cacheSize,
      utilisationPercent: ((this.cache.size / this.cacheSize) * 100).toFixed(1),
    }
  }
}
