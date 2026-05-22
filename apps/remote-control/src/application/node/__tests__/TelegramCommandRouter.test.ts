import { describe, expect, it } from 'vitest'
import { REMOTE_PROTOCOL_SCHEMA_VERSION, type ExternalMessage } from '@/packages/remote-protocol'
import type { RemoteControlSubmissionResult } from '@/apps/remote-control/application/common'
import { TelegramCommandRouter, externalMessageFromTelegramMessage } from '../TelegramCommandRouter'
import type { TelegramCommandRouterService, TelegramMessage } from '../TelegramCommandRouter'

describe('TelegramCommandRouter', () => {
  it('maps /ask into an ExternalMessage submission', async () => {
    const service = createService()
    const [reply] = await new TelegramCommandRouter(service).handleUpdate({
      update_id: 1,
      message: telegramMessage('/ask build the console'),
    })

    expect(reply).toMatchObject({
      status: 'queued',
      channelId: 'telegram:42',
    })
    expect(service.submissions).toEqual([expect.objectContaining({
      channel: {
        kind: 'telegram',
        channelId: 'telegram:42',
      },
      text: 'build the console',
    })])
  })

  it('formats /runs from remote-control run projections', async () => {
    const [reply] = await new TelegramCommandRouter(createService({ includeArtifacts: false })).handleUpdate({
      update_id: 1,
      message: telegramMessage('/runs'),
    })

    expect(reply).toMatchObject({
      status: 'sent',
      text: 'run-1 running cursor=3',
    })
  })

  it('returns latest screenshot artifact refs for /screen when available', async () => {
    const [reply] = await new TelegramCommandRouter(createService()).handleUpdate({
      update_id: 1,
      message: telegramMessage('/screen'),
    })

    expect(reply).toMatchObject({
      status: 'sent',
      text: 'Screenshot artifact from run-shot.',
      runId: 'run-shot',
      cursor: 5,
      artifactRefs: [{
        artifactId: 'shot.png',
        uri: 'telegraph://computer-use-artifacts/run-shot/shot.png',
        mediaType: 'image/png',
      }],
    })
  })

  it('returns a requested run screenshot artifact for /screen <runId>', async () => {
    const [reply] = await new TelegramCommandRouter(createService()).handleUpdate({
      update_id: 1,
      message: telegramMessage('/screen run-older-shot'),
    })

    expect(reply).toMatchObject({
      status: 'sent',
      text: 'Screenshot artifact from run-older-shot.',
      runId: 'run-older-shot',
      artifactRefs: [{
        artifactId: 'older-shot.png',
      }],
    })
  })

  it('falls back to read-only observation prompt when /screen has no artifact yet', async () => {
    const service = createService({ includeArtifacts: false })
    const [reply] = await new TelegramCommandRouter(service).handleUpdate({
      update_id: 1,
      message: telegramMessage('/screen'),
    })

    expect(reply).toMatchObject({
      status: 'queued',
      text: 'Run queued.',
    })
    expect(service.submissions).toEqual([
      expect.objectContaining({
        text: 'Use computer.observe to capture a read-only desktop screenshot and summarize what is visible.',
      }),
    ])
  })

  it('routes /approve decisions with Telegram actor identity', async () => {
    const service = createService()
    const [reply] = await new TelegramCommandRouter(service).handleUpdate({
      update_id: 1,
      message: telegramMessage('/approve approval-1 ok'),
    })

    expect(reply).toMatchObject({
      status: 'sent',
      text: 'Approval approved: approval-1',
    })
    expect(service.decisions).toEqual([{
      approvalId: 'approval-1',
      granted: true,
      actorId: 'telegram:7',
      reason: 'ok',
    }])
  })

  it('routes /pause to a run control command for the latest running run', async () => {
    const service = createService()
    const [reply] = await new TelegramCommandRouter(service).handleUpdate({
      update_id: 1,
      message: telegramMessage('/pause quick hold'),
    })

    expect(reply).toMatchObject({
      status: 'sent',
      text: 'Run pause requested for run-1.',
      runId: 'run-1',
      cursor: 3,
    })
    expect(service.runControlCommands).toEqual([{
      runId: 'run-1',
      kind: 'pause',
      actorId: 'telegram:7',
      reason: 'quick hold',
    }])
  })

  it('routes /cancel <runId> with explicit target run', async () => {
    const service = createService()
    const [reply] = await new TelegramCommandRouter(service).handleUpdate({
      update_id: 1,
      message: telegramMessage('/cancel run-shot wrong task'),
    })

    expect(reply).toMatchObject({
      status: 'sent',
      text: 'Run cancel requested for run-shot.',
      runId: 'run-shot',
      cursor: 5,
    })
    expect(service.runControlCommands).toEqual([{
      runId: 'run-shot',
      kind: 'cancel',
      actorId: 'telegram:7',
      reason: 'wrong task',
    }])
  })

  it('surfaces rejected run control commands', async () => {
    const service = createService({ rejectRunControl: true })
    const [reply] = await new TelegramCommandRouter(service).handleUpdate({
      update_id: 1,
      message: telegramMessage('/pause run-shot'),
    })

    expect(reply).toMatchObject({
      status: 'failed',
      text: 'Run pause rejected for run-shot: run is already completed',
      runId: 'run-shot',
    })
  })

  it('keeps Telegram groups read-only by default', async () => {
    const [reply] = await new TelegramCommandRouter(createService()).handleUpdate({
      update_id: 1,
      message: {
        ...telegramMessage('/ask group task'),
        chat: { id: -100, type: 'group' },
      },
    })

    expect(reply).toMatchObject({
      status: 'skipped',
      text: 'Telegram group chats are read-only by default.',
    })
  })

  it('allows read-only /runs in Telegram groups by default', async () => {
    const [reply] = await new TelegramCommandRouter(createService({ includeArtifacts: false })).handleUpdate({
      update_id: 1,
      message: {
        ...telegramMessage('/runs'),
        chat: { id: -100, type: 'group' },
      },
    })

    expect(reply).toMatchObject({
      status: 'sent',
      text: 'run-1 running cursor=3',
    })
  })

  it('allows existing /screen artifacts in Telegram groups without starting capture', async () => {
    const [reply] = await new TelegramCommandRouter(createService()).handleUpdate({
      update_id: 1,
      message: {
        ...telegramMessage('/screen'),
        chat: { id: -100, type: 'group' },
      },
    })

    expect(reply).toMatchObject({
      status: 'sent',
      runId: 'run-shot',
      artifactRefs: [{ artifactId: 'shot.png' }],
    })
  })

  it('allows configured Telegram groups to submit write commands', async () => {
    const service = createService()
    const [reply] = await new TelegramCommandRouter(service, {
      allowedGroupChatIds: [-100],
    }).handleUpdate({
      update_id: 1,
      message: {
        ...telegramMessage('/ask group task'),
        chat: { id: -100, type: 'group' },
      },
    })

    expect(reply).toMatchObject({
      status: 'queued',
    })
    expect(service.submissions).toEqual([
      expect.objectContaining({
        text: 'group task',
      }),
    ])
  })

  it('converts Telegram messages into stable ExternalMessage envelopes', () => {
    expect(externalMessageFromTelegramMessage(telegramMessage('/ask hi'), 'hi')).toEqual({
      messageId: 'telegram-42-10',
      actor: {
        actorId: 'telegram:7',
        kind: 'telegram',
        displayName: 'Ada Lovelace',
        channelId: 'telegram:42',
      },
      channel: {
        kind: 'telegram',
        channelId: 'telegram:42',
      },
      text: 'hi',
      receivedAt: 20_000,
      schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
    })
  })
})

function createService(options: { includeArtifacts?: boolean; rejectRunControl?: boolean } = {}): TelegramCommandRouterService & {
  submissions: ExternalMessage[]
  decisions: Array<{ approvalId: string; granted: boolean; actorId: string; reason?: string }>
  runControlCommands: Array<{ runId: string; kind: string; actorId: string; reason?: string }>
} {
  const includeArtifacts = options.includeArtifacts ?? true
  const submissions: ExternalMessage[] = []
  const decisions: Array<{ approvalId: string; granted: boolean; actorId: string; reason?: string }> = []
  const runControlCommands: Array<{ runId: string; kind: string; actorId: string; reason?: string }> = []
  return {
    submissions,
    decisions,
    runControlCommands,
    submitExternalMessage(message: ExternalMessage): RemoteControlSubmissionResult {
      submissions.push(message)
      return {
        intent: {
          intentId: 'intent-1',
          source: message.actor,
          targetPagelet: 'design',
          prompt: message.text ?? '',
          status: 'queued',
          createdAt: 10,
          updatedAt: 10,
        },
        reply: {
          replyId: 'reply-1',
          channelId: message.channel.channelId,
          text: 'Run queued.',
          status: 'queued',
          createdAt: 10,
          updatedAt: 10,
          schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
        },
      }
    },
    listRunProjections: () => [
      {
        runId: 'run-1',
        pageletId: 'design',
        status: 'running',
        cursor: 3,
        eventCount: 9,
        createdAt: 10,
        updatedAt: 20,
      },
      ...(includeArtifacts ? [
        {
          runId: 'run-older-shot',
          pageletId: 'chat',
          status: 'completed' as const,
          cursor: 4,
          eventCount: 12,
          artifactRefs: [{
            artifactId: 'older-shot.png',
            uri: 'telegraph://computer-use-artifacts/run-older-shot/older-shot.png',
            mediaType: 'image/png',
          }],
          createdAt: 10,
          updatedAt: 25,
        },
        {
          runId: 'run-shot',
          pageletId: 'chat',
          status: 'completed' as const,
          cursor: 5,
          eventCount: 14,
          artifactRefs: [{
            artifactId: 'shot.png',
            uri: 'telegraph://computer-use-artifacts/run-shot/shot.png',
            mediaType: 'image/png',
          }],
          createdAt: 10,
          updatedAt: 30,
        },
      ] : []),
    ],
    decideApproval: (approvalId, input) => {
      decisions.push({
        approvalId,
        granted: input.granted,
        actorId: input.decidedBy.actorId,
        reason: input.reason,
      })
      return {
        approvalId,
        runId: 'run-1',
        source: input.decidedBy,
        kind: 'tool',
        title: 'Allow',
        status: input.granted ? 'approved' : 'denied',
        granted: input.granted,
        decidedBy: input.decidedBy,
        reason: input.reason,
        createdAt: 10,
        updatedAt: 20,
        decidedAt: 20,
      }
    },
    requestRunControlCommand: (input) => {
      runControlCommands.push({
        runId: input.runId,
        kind: input.kind,
        actorId: input.requestedBy.actorId,
        reason: input.reason,
      })
      return {
        commandId: 'runctl-1',
        runId: input.runId,
        kind: input.kind,
        status: options.rejectRunControl ? 'rejected' : 'accepted',
        requestedBy: input.requestedBy,
        reason: input.reason,
        rejectionReason: options.rejectRunControl ? 'run is already completed' : undefined,
        createdAt: 10,
        updatedAt: 10,
      }
    },
  }
}

function telegramMessage(text: string): TelegramMessage {
  return {
    message_id: 10,
    date: 20,
    text,
    chat: {
      id: 42,
      type: 'private',
    },
    from: {
      id: 7,
      first_name: 'Ada',
      last_name: 'Lovelace',
    },
  }
}
