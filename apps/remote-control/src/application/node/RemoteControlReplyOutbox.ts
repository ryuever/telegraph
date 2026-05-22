import type { ChannelReply, ChannelReplyStatus, ExternalMessage } from '@/packages/remote-protocol'
import type { RunIntentRecord, RunProjectionRecord } from '@/packages/run-protocol'
import type { AckChannelReplyInput, ListChannelRepliesOptions } from '@/apps/remote-control/application/common'
import { replyForRunProjection } from './RemoteControlMessageRouter'
import type { ChannelReplyDeliveryRecord } from './RemoteControlReplyDeliveryRepository'

interface PendingRemoteRun {
  intentId: string
  message: ExternalMessage
  runId?: string
  lastCursor?: number
}

export class RemoteControlReplyOutbox {
  private readonly replies = new Map<string, ChannelReply>()
  private readonly pendingByIntentId = new Map<string, PendingRemoteRun>()
  private readonly pendingByRunId = new Map<string, PendingRemoteRun>()
  private readonly deliveryByReplyId = new Map<string, ChannelReplyDeliveryRecord>()

  constructor(private readonly replyLimit = 500) {}

  hydrateDelivery(records: ChannelReplyDeliveryRecord[]): void {
    this.deliveryByReplyId.clear()
    for (const record of records) {
      this.deliveryByReplyId.set(record.replyId, structuredClone(record))
    }
  }

  listDeliveryRecords(): ChannelReplyDeliveryRecord[] {
    return Array.from(this.deliveryByReplyId.values()).map(record => structuredClone(record))
  }

  trackSubmission(message: ExternalMessage, intent: RunIntentRecord, queuedReply: ChannelReply): void {
    this.addReply(queuedReply)
    const pending: PendingRemoteRun = {
      intentId: intent.intentId,
      message: structuredClone(message),
      runId: intent.runId,
      lastCursor: queuedReply.cursor,
    }
    this.pendingByIntentId.set(intent.intentId, pending)
    if (pending.runId) {
      this.pendingByRunId.set(pending.runId, pending)
    }
  }

  recordProjection(projection: RunProjectionRecord, now = Date.now()): ChannelReply | null {
    const pending = this.lookupPending(projection)
    if (!pending) return null
    if (pending.lastCursor !== undefined && projection.cursor <= pending.lastCursor) return null

    pending.runId = projection.runId
    pending.lastCursor = projection.cursor
    this.pendingByRunId.set(projection.runId, pending)

    const reply = replyForRunProjection(pending.message, projection, now)
    this.addReply(reply)
    return reply
  }

  trackReconstructedReply(reply: ChannelReply): void {
    this.addReply(reply)
  }

  listReplies(options: ListChannelRepliesOptions = {}): ChannelReply[] {
    return RemoteControlReplyOutbox.filterReplies(this.decorateReplies(Array.from(this.replies.values())), options)
  }

  decorateReplies(replies: ChannelReply[]): ChannelReply[] {
    return replies.map(reply => this.decorateReply(reply))
  }

  ackReply(input: AckChannelReplyInput): ChannelReply | null {
    const current = this.replies.get(input.replyId)
    if (!current) return null

    const now = input.now ?? Date.now()
    const previous = this.deliveryByReplyId.get(input.replyId)
    const delivery: ChannelReplyDeliveryRecord = {
      replyId: input.replyId,
      status: input.status,
      attempts: (previous?.attempts ?? 0) + 1,
      updatedAt: now,
      deliveredAt: input.status === 'sent' ? now : previous?.deliveredAt,
      deliveredBy: input.deliveredBy ?? previous?.deliveredBy,
      error: input.status === 'failed' ? input.error : undefined,
    }
    this.deliveryByReplyId.set(input.replyId, pruneUndefined(delivery))

    const next = this.decorateReply(current)
    this.replies.set(input.replyId, next)
    return structuredClone(next)
  }

  static filterReplies(
    replies: ChannelReply[],
    options: ListChannelRepliesOptions = {},
  ): ChannelReply[] {
    return replies
      .filter(reply => !options.channelId || reply.channelId === options.channelId)
      .filter(reply => !options.threadId || reply.threadId === options.threadId)
      .filter(reply => !options.runId || reply.runId === options.runId)
      .filter(reply => !options.status || reply.status === options.status)
      .filter(reply => !options.deliveryStatus || reply.deliveryStatus === options.deliveryStatus)
      .filter(reply => options.afterCursor === undefined || (
        reply.cursor !== undefined && reply.cursor > options.afterCursor
      ))
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt
        return a.replyId.localeCompare(b.replyId)
      })
      .slice(0, options.limit ?? 100)
      .map(reply => structuredClone(reply))
  }

  private lookupPending(projection: RunProjectionRecord): PendingRemoteRun | null {
    if (projection.sourceIntentId) {
      const byIntent = this.pendingByIntentId.get(projection.sourceIntentId)
      if (byIntent) return byIntent
    }
    return this.pendingByRunId.get(projection.runId) ?? null
  }

  private addReply(reply: ChannelReply): void {
    this.replies.set(reply.replyId, structuredClone(reply))
    if (this.replies.size <= this.replyLimit) return

    const oldest = Array.from(this.replies.values())
      .sort((a, b) => a.createdAt - b.createdAt)
      .at(0)
    if (oldest) {
      this.replies.delete(oldest.replyId)
    }
  }

  private decorateReply(reply: ChannelReply): ChannelReply {
    const delivery = this.deliveryByReplyId.get(reply.replyId)
    if (!delivery) {
      return {
        ...structuredClone(reply),
        deliveryStatus: reply.deliveryStatus ?? 'pending',
        deliveryAttempts: reply.deliveryAttempts ?? 0,
      }
    }

    return pruneUndefined({
      ...structuredClone(reply),
      deliveryStatus: delivery.status,
      deliveryAttempts: delivery.attempts,
      deliveredAt: delivery.deliveredAt,
      deliveredBy: delivery.deliveredBy,
      deliveryError: delivery.error,
      updatedAt: Math.max(reply.updatedAt, delivery.updatedAt),
    })
  }
}

export type { ChannelReplyStatus }

function pruneUndefined<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined),
  ) as T
}
