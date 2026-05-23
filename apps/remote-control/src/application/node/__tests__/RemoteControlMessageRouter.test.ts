import { describe, expect, it } from 'vitest'
import { REMOTE_PROTOCOL_SCHEMA_VERSION, type ExternalMessage } from '@/packages/remote-protocol'
import type { RunIntentRecord } from '@/packages/run-protocol'
import {
  createRunIntentInputFromExternalMessage,
  externalMessageFromRunIntent,
  replyForRunProjection,
  queuedReplyForRunIntent,
} from '../RemoteControlMessageRouter'

const externalMessage: ExternalMessage = {
  messageId: 'msg-1',
  actor: {
    actorId: 'telegram:user-1',
    kind: 'telegram',
    displayName: 'Ada',
    deviceId: 'phone-1',
  },
  channel: {
    kind: 'telegram',
    channelId: 'chat-1',
    threadId: 'thread-1',
  },
  text: '  build   the run console  ',
  receivedAt: 1_779_465_600_000,
  schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
}

describe('RemoteControlMessageRouter', () => {
  it('maps external messages into RunIntent input without raw channel payloads', () => {
    expect(createRunIntentInputFromExternalMessage(externalMessage, {
      sessionId: 'remote-session',
      targetPagelet: 'chat',
    })).toEqual({
      source: externalMessage.actor,
      targetPagelet: 'chat',
      prompt: 'build the run console',
      sessionId: 'remote-session',
      metadata: {
        externalMessageId: 'msg-1',
        channelKind: 'telegram',
        channelId: 'chat-1',
        threadId: 'thread-1',
        artifactRefs: [],
        rawRef: undefined,
      },
    })
  })

  it('forwards remote runtime settings through run intent metadata', () => {
    expect(createRunIntentInputFromExternalMessage(externalMessage, {
      targetPagelet: 'chat',
      settings: {
        backend: 'telegraph-orchestrator',
      },
    }).metadata).toMatchObject({
      settings: {
        backend: 'telegraph-orchestrator',
      },
    })
  })

  it('builds queued channel replies from claimed intent state', () => {
    const intent: RunIntentRecord = {
      intentId: 'intent-1',
      source: externalMessage.actor,
      targetPagelet: 'design',
      prompt: 'build',
      status: 'claimed',
      runId: 'run-1',
      claimedBy: 'design',
      createdAt: 10,
      updatedAt: 12,
      claimedAt: 12,
    }

    expect(queuedReplyForRunIntent(externalMessage, intent, 20)).toEqual({
      replyId: 'reply-intent-1',
      channelId: 'chat-1',
      threadId: 'thread-1',
      runId: 'run-1',
      text: 'Run queued.',
      status: 'queued',
      createdAt: 20,
      updatedAt: 20,
      schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
    })
  })

  it('reconstructs external message metadata from persisted run intents', () => {
    const intent: RunIntentRecord = {
      intentId: 'intent-1',
      source: externalMessage.actor,
      targetPagelet: 'design',
      prompt: 'build',
      metadata: {
        externalMessageId: 'msg-1',
        channelKind: 'telegram',
        channelId: 'chat-1',
        threadId: 'thread-1',
        rawRef: 'raw://message',
      },
      status: 'queued',
      createdAt: 10,
      updatedAt: 10,
    }

    expect(externalMessageFromRunIntent(intent)).toEqual({
      messageId: 'msg-1',
      actor: externalMessage.actor,
      channel: {
        kind: 'telegram',
        channelId: 'chat-1',
        threadId: 'thread-1',
      },
      text: 'build',
      artifactRefs: undefined,
      rawRef: 'raw://message',
      receivedAt: 10,
      schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
    })
  })


  it('builds channel replies with projection artifact refs', () => {
    expect(replyForRunProjection(externalMessage, {
      runId: 'run-1',
      pageletId: 'chat',
      status: 'completed',
      cursor: 5,
      eventCount: 8,
      artifactCount: 1,
      artifactRefs: [{
        artifactId: 'shot.png',
        uri: 'telegraph://computer-use-artifacts/run-1/shot.png',
        mediaType: 'image/png',
        title: 'shot.png',
      }],
      createdAt: 10,
      updatedAt: 20,
    }, 30)).toEqual({
      replyId: 'reply-run-1-5',
      channelId: 'chat-1',
      threadId: 'thread-1',
      runId: 'run-1',
      cursor: 5,
      text: 'Run completed.',
      artifactRefs: [{
        artifactId: 'shot.png',
        uri: 'telegraph://computer-use-artifacts/run-1/shot.png',
        mediaType: 'image/png',
        title: 'shot.png',
      }],
      status: 'sent',
      createdAt: 30,
      updatedAt: 30,
      schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
    })
  })

  it('rejects empty external messages', () => {
    expect(() => createRunIntentInputFromExternalMessage({
      ...externalMessage,
      text: '   ',
    })).toThrow('External message has no text or command')
  })
})
