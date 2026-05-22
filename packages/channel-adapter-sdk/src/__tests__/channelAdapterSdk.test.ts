import { describe, expect, it } from 'vitest'
import {
  CHANNEL_ADAPTER_SDK_SCHEMA_VERSION,
  createChannelAdapterManifest,
  normalizeCapabilities,
  type ChannelAdapterHost,
  type ChannelAdapterRuntime,
} from '@/packages/channel-adapter-sdk'

describe('channel adapter SDK', () => {
  it('creates versioned adapter manifests with normalized capabilities', () => {
    expect(createChannelAdapterManifest({
      adapterId: 'telegram',
      channelKind: 'telegram',
      displayName: 'Telegram',
      capabilities: {
        intake: true,
        replies: true,
        approvals: true,
      },
    })).toEqual({
      schemaVersion: CHANNEL_ADAPTER_SDK_SCHEMA_VERSION,
      adapterId: 'telegram',
      channelKind: 'telegram',
      displayName: 'Telegram',
      capabilities: {
        intake: true,
        replies: true,
        artifacts: false,
        approvals: true,
        projectionChanges: false,
        deviceBinding: false,
      },
    })
  })

  it('keeps capability defaults closed', () => {
    expect(normalizeCapabilities({})).toEqual({
      intake: false,
      replies: false,
      artifacts: false,
      approvals: false,
      projectionChanges: false,
      deviceBinding: false,
    })
  })

  it('types adapters against the remote control host surface only', async () => {
    const calls: string[] = []
    const host: ChannelAdapterHost = {
      submitExternalMessage: async () => {
        calls.push('submit')
        return {
          intent: {
            intentId: 'intent-1',
            source: { actorId: 'telegram:ada', kind: 'telegram' },
            targetPagelet: 'design',
            prompt: 'build',
            status: 'queued',
            createdAt: 10,
            updatedAt: 10,
          },
          reply: {
            replyId: 'reply-1',
            channelId: 'telegram:chat',
            status: 'queued',
            createdAt: 10,
            updatedAt: 10,
            schemaVersion: 1,
          },
        }
      },
      listChannelReplies: async () => [],
      ackChannelReply: async () => null,
      listRunProjections: async () => [],
      getRunProjection: async () => null,
      listRunProjectionChanges: async () => [],
      listApprovals: async () => [],
      listApprovalChanges: async () => [],
      decideApproval: async () => null,
      listDeviceBindings: async () => [],
      createDeviceBinding: async input => ({
        bindingId: input.bindingId ?? 'binding-1',
        deviceId: input.deviceId,
        actor: input.actor,
        status: 'active',
        createdAt: 10,
        updatedAt: 10,
      }),
      revokeDeviceBinding: async () => null,
    }
    const adapter: ChannelAdapterRuntime = {
      manifest: createChannelAdapterManifest({
        adapterId: 'telegram',
        channelKind: 'telegram',
        displayName: 'Telegram',
        capabilities: { intake: true },
      }),
      start: async adapterHost => {
        await adapterHost.submitExternalMessage({
          messageId: 'msg-1',
          actor: { actorId: 'telegram:ada', kind: 'telegram' },
          channel: { kind: 'telegram', channelId: 'telegram:chat' },
          text: 'build',
          receivedAt: 10,
          schemaVersion: 1,
        })
      },
    }

    await adapter.start(host)

    expect(calls).toEqual(['submit'])
  })
})
