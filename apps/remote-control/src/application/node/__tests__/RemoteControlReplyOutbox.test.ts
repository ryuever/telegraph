import { describe, expect, it } from 'vitest'
import { REMOTE_PROTOCOL_SCHEMA_VERSION, type ExternalMessage } from '@/packages/remote-protocol'
import type { RunIntentRecord, RunProjectionRecord } from '@/packages/run-protocol'
import { queuedReplyForRunIntent } from '../RemoteControlMessageRouter'
import { RemoteControlReplyOutbox } from '../RemoteControlReplyOutbox'

describe('RemoteControlReplyOutbox', () => {
  it('turns matching run projections into channel replies with artifact refs', () => {
    const outbox = new RemoteControlReplyOutbox()
    const message = externalMessage()
    const intent = runIntent(message)

    outbox.trackSubmission(message, intent, queuedReplyForRunIntent(message, intent, 10))
    const reply = outbox.recordProjection(runProjection({
      sourceIntentId: intent.intentId,
      artifactRefs: [{
        artifactId: 'shot.png',
        uri: 'telegraph://computer-use-artifacts/run-1/shot.png',
        mediaType: 'image/png',
      }],
    }), 20)

    expect(reply).toMatchObject({
      replyId: 'reply-run-1-3',
      channelId: 'telegram:chat',
      runId: 'run-1',
      cursor: 3,
      status: 'sent',
      artifactRefs: [{
        artifactId: 'shot.png',
        uri: 'telegraph://computer-use-artifacts/run-1/shot.png',
        mediaType: 'image/png',
      }],
    })
    expect(outbox.listReplies({ channelId: 'telegram:chat' })).toHaveLength(2)
    expect(outbox.listReplies({ runId: 'run-1', afterCursor: 2 })).toEqual([
      expect.objectContaining({
        replyId: 'reply-run-1-3',
        runId: 'run-1',
        cursor: 3,
        deliveryStatus: 'pending',
        deliveryAttempts: 0,
      }),
    ])
    expect(outbox.listReplies({ deliveryStatus: 'pending' })).toHaveLength(2)
  })

  it('ignores unrelated projections and duplicate cursors', () => {
    const outbox = new RemoteControlReplyOutbox()
    const message = externalMessage()
    const intent = runIntent(message)

    outbox.trackSubmission(message, intent, queuedReplyForRunIntent(message, intent, 10))
    expect(outbox.recordProjection(runProjection({ sourceIntentId: 'other-intent' }), 20)).toBeNull()
    expect(outbox.recordProjection(runProjection({ sourceIntentId: intent.intentId }), 30)).not.toBeNull()
    expect(outbox.recordProjection(runProjection({ sourceIntentId: intent.intentId }), 40)).toBeNull()
  })

  it('tracks delivery ack state separately from reply status', () => {
    const outbox = new RemoteControlReplyOutbox()
    const message = externalMessage()
    const intent = runIntent(message)

    outbox.trackSubmission(message, intent, queuedReplyForRunIntent(message, intent, 10))
    const acked = outbox.ackReply({
      replyId: 'reply-intent-1',
      status: 'sent',
      deliveredBy: message.actor,
      now: 30,
    })

    expect(acked).toMatchObject({
      replyId: 'reply-intent-1',
      status: 'queued',
      deliveryStatus: 'sent',
      deliveryAttempts: 1,
      deliveredAt: 30,
      deliveredBy: {
        actorId: 'telegram:user',
      },
      updatedAt: 30,
    })
    expect(outbox.listReplies({ deliveryStatus: 'sent' })).toHaveLength(1)
    expect(outbox.listDeliveryRecords()).toEqual([
      expect.objectContaining({
        replyId: 'reply-intent-1',
        status: 'sent',
        attempts: 1,
        updatedAt: 30,
      }),
    ])
  })
})

function externalMessage(): ExternalMessage {
  return {
    messageId: 'msg-remote',
    actor: {
      actorId: 'telegram:user',
      kind: 'telegram',
      displayName: 'Remote User',
    },
    channel: {
      kind: 'telegram',
      channelId: 'telegram:chat',
    },
    text: 'build from telegram',
    receivedAt: 10,
    schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
  }
}

function runIntent(message: ExternalMessage): RunIntentRecord {
  return {
    intentId: 'intent-1',
    source: message.actor,
    targetPagelet: 'design',
    prompt: message.text ?? '',
    status: 'queued',
    createdAt: 10,
    updatedAt: 10,
  }
}

function runProjection(patch: Partial<RunProjectionRecord> = {}): RunProjectionRecord {
  return {
    runId: 'run-1',
    pageletId: 'design',
    status: 'completed',
    cursor: 3,
    eventCount: 7,
    createdAt: 10,
    updatedAt: 20,
    ...patch,
  }
}
