import { describe, expect, it } from 'vitest'
import { REMOTE_PROTOCOL_SCHEMA_VERSION, type ExternalMessage } from '@/packages/remote-protocol'
import type { RemoteControlSubmissionResult } from '@/apps/remote-control/application/common'
import {
  SlackCommandRouter,
  externalMessageFromSlackEventCallback,
  externalMessageFromSlackSlashCommand,
  type SlackCommandRouterService,
} from '../SlackCommandRouter'
import { SlackTeamGovernance } from '../SlackTeamGovernance'

describe('SlackCommandRouter', () => {
  it('maps slash ask commands into ExternalMessage submissions', async () => {
    const service = createService()
    const reply = await new SlackCommandRouter(service).handleSlashCommand(slashPayload('ask build the admin screen'))

    expect(reply).toMatchObject({
      status: 'queued',
      channelId: 'slack:C123',
    })
    expect(service.submissions).toHaveLength(1)
    expect(service.submissions[0]).toMatchObject({
      channel: {
        kind: 'slack',
        channelId: 'slack:C123',
      },
      text: 'build the admin screen',
    })
    expect(service.submissions[0]?.actor).toMatchObject({
      actorId: 'slack:U123',
      workspaceId: 'T123',
    })
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

  it('rejects revoked Slack workspace commands before creating a run', async () => {
    const service = createService()
    const governance = new SlackTeamGovernance({
      workspaces: [{
        workspaceId: 'T123',
        status: 'revoked',
        createdAt: 10,
        updatedAt: 20,
        revokedAt: 20,
      }],
    })
    const reply = await new SlackCommandRouter(service, { governance })
      .handleSlashCommand(slashPayload('ask build from revoked workspace'))

    expect(reply).toMatchObject({
      status: 'failed',
      text: 'Slack workspace "T123" is revoked.',
    })
    expect(service.submissions).toEqual([])
    expect(governance.listAuditEvents()).toEqual([
      expect.objectContaining({
        action: 'ask',
        status: 'rejected',
        workspaceId: 'T123',
        actorId: 'slack:U123',
        channelId: 'slack:C123',
        reason: 'Slack workspace "T123" is revoked.',
      }),
    ])
  })

  it('records accepted Slack run and approval audit events with policy profile', async () => {
    const service = createService()
    const governance = new SlackTeamGovernance({
      workspaces: [{
        workspaceId: 'T123',
        status: 'active',
        policyProfileId: 'remote-agent-os/team-readonly',
        createdAt: 10,
        updatedAt: 10,
      }],
      users: [{
        workspaceId: 'T123',
        userId: 'U123',
        actorId: 'slack:U123',
        status: 'active',
        role: 'operator',
        policyProfileId: 'remote-agent-os/team-operator',
        createdAt: 10,
        updatedAt: 10,
      }],
    })
    const router = new SlackCommandRouter(service, { governance })

    await router.handleSlashCommand(slashPayload('ask audit this'))
    await router.handleSlashCommand(slashPayload('approve approval-1 looks good'))

    expect(governance.listAuditEvents()).toEqual([
      expect.objectContaining({
        action: 'ask',
        status: 'accepted',
        policyProfileId: 'remote-agent-os/team-operator',
      }),
      expect.objectContaining({
        action: 'approve',
        status: 'accepted',
        approvalId: 'approval-1',
        policyProfileId: 'remote-agent-os/team-operator',
      }),
    ])
  })

  it('requires operator or admin role for Slack approval decisions', async () => {
    const service = createService()
    const governance = new SlackTeamGovernance({
      workspaces: [{
        workspaceId: 'T123',
        status: 'active',
        createdAt: 10,
        updatedAt: 10,
      }],
      users: [{
        workspaceId: 'T123',
        userId: 'U123',
        actorId: 'slack:U123',
        status: 'active',
        role: 'member',
        createdAt: 10,
        updatedAt: 10,
      }],
    })
    const reply = await new SlackCommandRouter(service, { governance })
      .handleSlashCommand(slashPayload('deny approval-1 no'))

    expect(reply).toMatchObject({
      status: 'failed',
      text: 'Slack user "U123" requires operator or admin role for approval decisions.',
    })
    expect(service.decisions).toEqual([])
    expect(governance.listAuditEvents()).toEqual([
      expect.objectContaining({
        action: 'deny',
        status: 'rejected',
        approvalId: undefined,
        reason: 'Slack user "U123" requires operator or admin role for approval decisions.',
      }),
    ])
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
