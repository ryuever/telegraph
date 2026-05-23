import { describe, expect, it } from 'vitest'
import { REMOTE_PROTOCOL_SCHEMA_VERSION, type ExternalMessage } from '@/packages/remote-protocol'
import { RemoteControlIngressPolicy } from '../RemoteControlIngressPolicy'

describe('RemoteControlIngressPolicy', () => {
  it('rejects duplicate external message ids inside the replay ttl', () => {
    const policy = new RemoteControlIngressPolicy({ replayTtlMs: 1_000 })
    const message = externalMessage({ messageId: 'msg-1' })

    policy.accept(message, 100)
    expect(() => {
      policy.accept(message, 200)
    }).toThrow('Duplicate external message "msg-1".')

    expect(() => {
      policy.accept(message, 1_200)
    }).not.toThrow()
  })

  it('rate limits messages per actor inside a sliding window', () => {
    const policy = new RemoteControlIngressPolicy({
      rateLimitWindowMs: 1_000,
      maxMessagesPerActor: 2,
    })

    policy.accept(externalMessage({ messageId: 'msg-1' }), 100)
    policy.accept(externalMessage({ messageId: 'msg-2' }), 200)

    expect(() => {
      policy.accept(externalMessage({ messageId: 'msg-3' }), 300)
    }).toThrow('External message rate limit exceeded for actor "telegram:ada".')
    expect(() => {
      policy.accept(externalMessage({ messageId: 'msg-4' }), 1_200)
    }).not.toThrow()
  })
})

function externalMessage(options: { messageId: string }): ExternalMessage {
  return {
    messageId: options.messageId,
    actor: {
      actorId: 'telegram:ada',
      kind: 'telegram',
    },
    channel: {
      kind: 'telegram',
      channelId: 'telegram:chat',
    },
    text: 'build',
    receivedAt: 10,
    schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
  }
}
