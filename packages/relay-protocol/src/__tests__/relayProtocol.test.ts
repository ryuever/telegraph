import { describe, expect, it } from 'vitest';
import { REMOTE_PROTOCOL_SCHEMA_VERSION, type ExternalMessage } from '@/packages/remote-protocol';
import {
  InMemorySelfHostRelay,
  RELAY_PROTOCOL_SCHEMA_VERSION,
  assertRoutingOnlyRelayPolicy,
  deploymentBoundary,
} from '@/packages/relay-protocol';

describe('self-host relay protocol', () => {
  it('routes envelopes by participant and cursor without execution capability', () => {
    const relay = new InMemorySelfHostRelay()
    relay.registerParticipant({
      participantId: 'desktop-1',
      role: 'desktop',
      now: 10,
    })
    relay.registerParticipant({
      participantId: 'telegram-adapter',
      role: 'channel-adapter',
      now: 10,
    })

    const envelope = relay.publish({
      from: 'telegram-adapter',
      to: 'desktop-1',
      payload: {
        kind: 'external_message',
        message: externalMessage(),
      },
      now: 20,
    })

    expect(envelope).toMatchObject({
      envelopeId: 'relay-1',
      cursor: 1,
      schemaVersion: RELAY_PROTOCOL_SCHEMA_VERSION,
    })
    expect(relay.boundaryPolicy).toMatchObject({
      storesDesktopExecutionCapability: false,
    })
    expect(relay.list({ participantId: 'desktop-1' })).toEqual([envelope])
    expect(relay.list({ participantId: 'desktop-1', afterCursor: 1 })).toEqual([])
  })

  it('rejects unregistered participants and disallowed payload kinds', () => {
    const relay = new InMemorySelfHostRelay({ allowedPayloadKinds: ['channel_reply'] })
    relay.registerParticipant({ participantId: 'desktop-1', role: 'desktop' })
    relay.registerParticipant({ participantId: 'adapter-1', role: 'channel-adapter' })

    expect(() => relay.publish({
      from: 'adapter-1',
      to: 'desktop-1',
      payload: {
        kind: 'external_message',
        message: externalMessage(),
      },
    })).toThrow('Relay payload kind "external_message" is not allowed.')

    expect(() => relay.list({ participantId: 'missing' }))
      .toThrow('Relay participant is not registered: missing')
  })

  it('codifies cloud and enterprise self-host boundaries as routing-only policies', () => {
    expect(deploymentBoundary('cloud')).toEqual({
      deploymentMode: 'cloud',
      localOnlySecrets: false,
      storesDesktopExecutionCapability: false,
      allowedPayloadKinds: [
        'external_message',
        'channel_reply',
        'projection_change',
        'approval_change',
      ],
    })
    expect(deploymentBoundary('self-host')).toMatchObject({
      deploymentMode: 'self-host',
      localOnlySecrets: true,
      storesDesktopExecutionCapability: false,
    })
    expect(() => assertRoutingOnlyRelayPolicy(deploymentBoundary('self-host'))).not.toThrow()
  })
})

function externalMessage(): ExternalMessage {
  return {
    messageId: 'msg-1',
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
