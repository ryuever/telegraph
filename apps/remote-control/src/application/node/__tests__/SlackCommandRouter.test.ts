import { describe, expect, it } from 'vitest'
import { REMOTE_PROTOCOL_SCHEMA_VERSION, type ExternalMessage } from '@/packages/remote-protocol'
import type { RemoteControlSubmissionResult } from '@/apps/remote-control/application/common'
import {
  SlackCommandRouter,
  externalMessageFromSlackEventCallback,
  externalMessageFromSlackSlashCommand,
  type SlackCommandRouterService,
} from '../SlackCommandRouter'

describe('SlackCommandRouter', () => {
  it('maps slash ask commands into ExternalMessage submissions', async () => {
    const service = createService()
    const reply = await new SlackCommandRouter(service).handleSlashCommand(slashPayload('ask build the admin screen'))

    expect(reply).toMatchObject({
      status: 'queued',
      channelId: 'slack:C123',
    })
    expect(service.submissions).toEqual([
      expect.objectContaining({
        actor: expect.objectContaining({
          actorId: 'slack:U123',
          workspaceId: 'T123',
        }),
        channel: {
          kind: 'slack',
          channelId: 'slack:C123',
        },
        text: 'build the admin screen',
      }),
    ])
  })

  it('maps app mentions into threaded ExternalMessage submissions', async () => {
    const service = createService()
    const [reply] = await new SlackCommandRouter(service).handleEventCallback({
      team_id: 'T123',
      event: {
        type: 'app_mention',
        user: 'U123',
        text: '<@BOT> summarize run status',
        channel: 'C123',
        ts: '12345.678',
      },
    })

    expect(reply).toMatchObject({ status: 'queued' })
    expect(service.submissions).toEqual([
      expect.objectContaining({
        messageId: 'slack-event-T123-C123-12345.678',
        channel: {
          kind: 'slack',
          channelId: 'slack:C123',
          threadId: '12345.678',
        },
        text: 'summarize run status',
      }),
    ])
  })

  it('formats /runs from run projections', async () => {
    const reply = await new SlackCommandRouter(createService()).handleSlashCommand(slashPayload('runs'))

    expect(reply).toMatchObject({
      status: 'sent',
      text: 'run-1 running cursor=3',
    })
  })

  it('routes slash approval decisions with Slack actor identity', async () => {
    const service = createService()
    const reply = await new SlackCommandRouter(service).handleSlashCommand(slashPayload('approve approval-1 ship it'))

    expect(reply).toMatchObject({
      status: 'sent',
      text: 'Approval approved: approval-1',
    })
    expect(service.decisions).toEqual([{
      approvalId: 'approval-1',
      granted: true,
      actorId: 'slack:U123',
      reason: 'ship it',
    }])
  })

  it('routes Block Kit approval actions', async () => {
    const service = createService()
    const [reply] = await new SlackCommandRouter(service).handleInteraction({
      type: 'block_actions',
      team: { id: 'T123' },
      user: { id: 'U123', name: 'Ada' },
      channel: { id: 'C123' },
      message: { ts: '99.1', thread_ts: '88.1' },
      actions: [{ action_id: 'telegraph_deny', value: 'approval-1' }],
    })

    expect(reply).toMatchObject({
      channelId: 'slack:C123',
      threadId: '88.1',
      status: 'sent',
      text: 'Approval denied: approval-1',
    })
    expect(service.decisions).toEqual([{
      approvalId: 'approval-1',
      granted: false,
      actorId: 'slack:U123',
      reason: 'Slack action telegraph_deny',
    }])
  })

  it('converts Slack payloads into stable ExternalMessage envelopes', () => {
    expect(externalMessageFromSlackSlashCommand(slashPayload('hello'), 'hello')).toMatchObject({
      actor: {
        actorId: 'slack:U123',
        kind: 'slack',
        displayName: 'ada',
        channelId: 'slack:C123',
        workspaceId: 'T123',
      },
      channel: {
        kind: 'slack',
        channelId: 'slack:C123',
      },
      text: 'hello',
      schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
    })
    expect(externalMessageFromSlackEventCallback({
      team_id: 'T123',
      event: {
        type: 'app_mention',
        user: 'U123',
        text: '<@BOT> hello',
        channel: 'C123',
        ts: '12345.678',
      },
    }, 'hello')).toMatchObject({
      messageId: 'slack-event-T123-C123-12345.678',
      channel: {
        kind: 'slack',
        channelId: 'slack:C123',
        threadId: '12345.678',
      },
      text: 'hello',
    })
  })
})

function slashPayload(text: string) {
  return {
    command: '/telegraph',
    text,
    team_id: 'T123',
    channel_id: 'C123',
    user_id: 'U123',
    user_name: 'ada',
    trigger_id: 'trigger-1',
  }
}

function createService(): SlackCommandRouterService & {
  submissions: ExternalMessage[]
  decisions: Array<{ approvalId: string; granted: boolean; actorId: string; reason?: string }>
} {
  const submissions: ExternalMessage[] = []
  const decisions: Array<{ approvalId: string; granted: boolean; actorId: string; reason?: string }> = []
  return {
    submissions,
    decisions,
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
          threadId: message.channel.threadId,
          text: 'Run queued.',
          status: 'queued',
          createdAt: 10,
          updatedAt: 10,
          schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
        },
      }
    },
    listRunProjections: () => [{
      runId: 'run-1',
      pageletId: 'design',
      status: 'running',
      cursor: 3,
      eventCount: 9,
      createdAt: 10,
      updatedAt: 20,
    }],
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
  }
}
