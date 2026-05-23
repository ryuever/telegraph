import type { ExternalMessage } from '@/packages/remote-protocol'

export interface RemoteControlIngressPolicyOptions {
  replayTtlMs?: number
  maxRememberedMessageIds?: number
  rateLimitWindowMs?: number
  maxMessagesPerActor?: number
}

export class RemoteControlIngressPolicy {
  private readonly seenMessageIds = new Map<string, number>()
  private readonly actorMessageTimes = new Map<string, number[]>()

  constructor(private readonly options: RemoteControlIngressPolicyOptions = {}) {}

  accept(message: ExternalMessage, now = Date.now()): void {
    this.rejectReplay(message, now)
    this.rejectRateLimit(message, now)
  }

  private rejectReplay(message: ExternalMessage, now: number): void {
    const ttl = this.options.replayTtlMs ?? 10 * 60_000
    const seenAt = this.seenMessageIds.get(message.messageId)
    if (seenAt !== undefined && now - seenAt <= ttl) {
      throw new Error(`Duplicate external message "${message.messageId}".`)
    }

    this.seenMessageIds.set(message.messageId, now)
    this.pruneSeenMessageIds(now, ttl)
  }

  private pruneSeenMessageIds(now: number, ttl: number): void {
    for (const [messageId, seenAt] of this.seenMessageIds) {
      if (now - seenAt > ttl) this.seenMessageIds.delete(messageId)
    }

    const max = this.options.maxRememberedMessageIds ?? 1_000
    while (this.seenMessageIds.size > max) {
      const oldest = this.seenMessageIds.keys().next().value
      if (!oldest) return
      this.seenMessageIds.delete(oldest)
    }
  }

  private rejectRateLimit(message: ExternalMessage, now: number): void {
    const actorKey = `${message.actor.kind}:${message.actor.actorId}`
    const windowMs = this.options.rateLimitWindowMs ?? 60_000
    const maxMessages = this.options.maxMessagesPerActor ?? 60
    const current = (this.actorMessageTimes.get(actorKey) ?? [])
      .filter(timestamp => now - timestamp <= windowMs)

    if (current.length >= maxMessages) {
      this.actorMessageTimes.set(actorKey, current)
      throw new Error(`External message rate limit exceeded for actor "${message.actor.actorId}".`)
    }

    current.push(now)
    this.actorMessageTimes.set(actorKey, current)
  }
}
