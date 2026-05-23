import { mkdtempSync, rmSync } from 'node:fs'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { REMOTE_PROTOCOL_SCHEMA_VERSION, type ExternalMessage } from '@/packages/remote-protocol'
import type { RemoteControlSubmissionResult } from '@/apps/remote-control/application/common'
import {
  RemoteControlSocketGateway,
  handleRemoteControlGatewayRequest,
  type RemoteControlGatewayService,
} from '../RemoteControlSocketGateway'

const cleanupDirs: string[] = []

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('RemoteControlSocketGateway', () => {
  it('dispatches external message submissions', async () => {
    const service = createFakeService()
    const response = await handleRemoteControlGatewayRequest(service, {
      id: 'submit-1',
      method: 'submitExternalMessage',
      params: {
        message: externalMessage(),
        options: { targetPagelet: 'chat' },
      },
    })

    expect(response).toMatchObject({
      id: 'submit-1',
      ok: true,
      result: {
        intent: {
          prompt: 'build from telegram',
          targetPagelet: 'chat',
        },
      },
    })
    expect(service.submissions).toHaveLength(1)
  })

  it('lists channel replies for remote adapters', async () => {
    const response = await handleRemoteControlGatewayRequest(createFakeService(), {
      id: 'replies-1',
      method: 'listChannelReplies',
      params: {
        channelId: 'telegram:chat',
      },
    })

    expect(response).toMatchObject({
      id: 'replies-1',
      ok: true,
      result: [{
        replyId: 'reply-remote',
        channelId: 'telegram:chat',
        status: 'queued',
      }],
    })
  })

  it('acks channel reply delivery for remote adapters', async () => {
    const response = await handleRemoteControlGatewayRequest(createFakeService(), {
      id: 'reply-ack-1',
      method: 'ackChannelReply',
      params: {
        replyId: 'reply-remote',
        status: 'sent',
        deliveredBy: externalMessage().actor,
      },
    })

    expect(response).toMatchObject({
      id: 'reply-ack-1',
      ok: true,
      result: {
        replyId: 'reply-remote',
        deliveryStatus: 'sent',
        deliveryAttempts: 1,
      },
    })
  })


  it('proxies approval listing and decisions for remote adapters', async () => {
    const service = createFakeService()
    const listResponse = await handleRemoteControlGatewayRequest(service, {
      id: 'approvals-1',
      method: 'listApprovals',
      params: { status: 'pending' },
    })
    const decideResponse = await handleRemoteControlGatewayRequest(service, {
      id: 'approval-decision-1',
      method: 'decideApproval',
      params: {
        approvalId: 'approval-1',
        input: {
          granted: true,
          decidedBy: externalMessage().actor,
        },
      },
    })

    expect(listResponse).toMatchObject({
      id: 'approvals-1',
      ok: true,
      result: [{ approvalId: 'approval-1', status: 'pending' }],
    })
    expect(decideResponse).toMatchObject({
      id: 'approval-decision-1',
      ok: true,
      result: { approvalId: 'approval-1', status: 'approved', granted: true },
    })
  })

  it('proxies approval change history for remote adapters', async () => {
    const response = await handleRemoteControlGatewayRequest(createFakeService(), {
      id: 'approval-changes-1',
      method: 'listApprovalChanges',
      params: { status: 'pending' },
    })

    expect(response).toMatchObject({
      id: 'approval-changes-1',
      ok: true,
      result: [{
        approvalId: 'approval-1',
        cursor: 1,
        approval: {
          approvalId: 'approval-1',
          status: 'pending',
        },
      }],
    })
  })

  it('proxies run control commands for remote adapters', async () => {
    const response = await handleRemoteControlGatewayRequest(createFakeService(), {
      id: 'run-control-1',
      method: 'requestRunControlCommand',
      params: {
        runId: 'run-remote',
        kind: 'cancel',
        requestedBy: externalMessage().actor,
        reason: 'stop from phone',
      },
    })

    expect(response).toMatchObject({
      id: 'run-control-1',
      ok: true,
      result: {
        commandId: 'runctl-1',
        runId: 'run-remote',
        kind: 'cancel',
        status: 'accepted',
      },
    })
  })

  it('proxies run control change history for remote adapters', async () => {
    const response = await handleRemoteControlGatewayRequest(createFakeService(), {
      id: 'run-control-changes-1',
      method: 'listRunControlChanges',
      params: { runId: 'run-remote', afterCursor: 1 },
    })

    expect(response).toMatchObject({
      id: 'run-control-changes-1',
      ok: true,
      result: [{
        commandId: 'runctl-1',
        cursor: 2,
        command: {
          runId: 'run-remote',
          status: 'accepted',
        },
      }],
    })
  })


  it('proxies run projection queries for remote adapters', async () => {
    const service = createFakeService()
    const listResponse = await handleRemoteControlGatewayRequest(service, {
      id: 'runs-1',
      method: 'listRunProjections',
      params: { pageletId: 'design' },
    })
    const getResponse = await handleRemoteControlGatewayRequest(service, {
      id: 'run-1',
      method: 'getRunProjection',
      params: { runId: 'run-remote' },
    })

    expect(listResponse).toMatchObject({
      id: 'runs-1',
      ok: true,
      result: [{ runId: 'run-remote', pageletId: 'design' }],
    })
    expect(getResponse).toMatchObject({
      id: 'run-1',
      ok: true,
      result: { runId: 'run-remote', pageletId: 'design' },
    })
  })

  it('proxies run projection change history for remote adapters', async () => {
    const response = await handleRemoteControlGatewayRequest(createFakeService(), {
      id: 'projection-changes-1',
      method: 'listRunProjectionChanges',
      params: { runId: 'run-remote', afterCursor: 1 },
    })

    expect(response).toMatchObject({
      id: 'projection-changes-1',
      ok: true,
      result: [{
        type: 'run_projection_changed',
        runId: 'run-remote',
        cursor: 2,
        projection: {
          runId: 'run-remote',
          status: 'running',
        },
      }],
    })
  })

  it('dispatches Telegram updates for adapter processes', async () => {
    const response = await handleRemoteControlGatewayRequest(createFakeService(), {
      id: 'telegram-1',
      method: 'handleTelegramUpdate',
      params: {
        update: {
          update_id: 1,
          message: {
            message_id: 10,
            text: '/runs',
            chat: { id: 42, type: 'private' },
          },
        },
      },
    })

    expect(response).toMatchObject({
      id: 'telegram-1',
      ok: true,
      result: [{
        replyId: 'telegram-reply-1',
        status: 'sent',
      }],
    })
  })

  it('dispatches Slack slash commands for adapter processes', async () => {
    const response = await handleRemoteControlGatewayRequest(createFakeService(), {
      id: 'slack-slash-1',
      method: 'handleSlackSlashCommand',
      params: {
        payload: {
          command: '/telegraph',
          text: 'ask build from slack',
          team_id: 'T123',
          channel_id: 'C123',
          user_id: 'U123',
        },
      },
    })

    expect(response).toMatchObject({
      id: 'slack-slash-1',
      ok: true,
      result: {
        replyId: 'slack-reply-1',
        channelId: 'slack:C123',
        status: 'queued',
      },
    })
  })

  it('dispatches Slack governance binding management for adapter processes', async () => {
    const service = createFakeService()
    const gateway = new RemoteControlSocketGateway(service, '/tmp/unused.sock')

    await expect(gateway.handleRequest({
      id: 'slack-workspace-bind',
      method: 'createSlackWorkspaceBinding',
      params: {
        workspaceId: 'T123',
        teamDomain: 'example',
        policyProfileId: 'remote-agent-os/team-readonly',
      },
    })).resolves.toMatchObject({
      ok: true,
      result: {
        workspaceId: 'T123',
        teamDomain: 'example',
        status: 'active',
      },
    })

    await expect(gateway.handleRequest({
      id: 'slack-user-bind',
      method: 'createSlackUserBinding',
      params: {
        workspaceId: 'T123',
        userId: 'U123',
        role: 'operator',
      },
    })).resolves.toMatchObject({
      ok: true,
      result: {
        workspaceId: 'T123',
        userId: 'U123',
        actorId: 'slack:U123',
        status: 'active',
        role: 'operator',
      },
    })

    await expect(gateway.handleRequest({
      id: 'slack-device-bind',
      method: 'createSlackDeviceBinding',
      params: {
        workspaceId: 'T123',
        userId: 'U123',
        deviceId: 'iphone-1',
        label: 'iPhone',
      },
    })).resolves.toMatchObject({
      ok: true,
      result: {
        bindingId: 'slack-device-T123-U123-iphone-1',
        workspaceId: 'T123',
        userId: 'U123',
        deviceId: 'iphone-1',
        actorId: 'slack:U123',
        status: 'active',
      },
    })

    await expect(gateway.handleRequest({
      id: 'slack-app-install',
      method: 'createSlackAppInstallation',
      params: {
        workspaceId: 'T123',
        appId: 'A123',
        botTokenRef: 'secret://slack/T123/bot',
        scopes: ['commands'],
        installedByUserId: 'U123',
      },
    })).resolves.toMatchObject({
      ok: true,
      result: {
        installationId: 'slack-install-T123',
        workspaceId: 'T123',
        appId: 'A123',
        botTokenRef: 'secret://slack/T123/bot',
        scopes: ['commands'],
        status: 'active',
        installedByUserId: 'U123',
      },
    })

    await expect(gateway.handleRequest({
      id: 'slack-oauth-callback',
      method: 'handleSlackOAuthCallback',
      params: {
        code: 'oauth-code',
        redirectUri: 'https://telegraph.local/slack/callback',
      },
    })).resolves.toMatchObject({
      ok: true,
      result: {
        installation: {
          workspaceId: 'T123',
          status: 'active',
        },
      },
    })

    await expect(gateway.handleRequest({
      id: 'slack-audit',
      method: 'listSlackTeamAuditEvents',
    })).resolves.toMatchObject({
      ok: true,
      result: [],
    })

    await expect(gateway.handleRequest({
      id: 'slack-app-revoke',
      method: 'revokeSlackAppInstallation',
      params: {
        installationId: 'slack-install-T123',
      },
    })).resolves.toMatchObject({
      ok: true,
      result: {
        installationId: 'slack-install-T123',
        status: 'revoked',
      },
    })

    await expect(gateway.handleRequest({
      id: 'slack-lifecycle',
      method: 'handleSlackLifecycleEvent',
      params: {
        event: {
          kind: 'user_left_workspace',
          workspaceId: 'T123',
          userIds: ['U123'],
        },
      },
    })).resolves.toMatchObject({
      ok: true,
      result: {
        kind: 'user_left_workspace',
        workspaceId: 'T123',
        revokedUsers: [{
          workspaceId: 'T123',
          userId: 'U123',
          status: 'revoked',
        }],
        revokedDevices: [],
      },
    })
  })





  it('serves newline-delimited requests over a local socket', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'telegraph-remote-control-test-'))
    cleanupDirs.push(dir)
    const gateway = new RemoteControlSocketGateway(createFakeService(), join(dir, 'remote.sock'))
    await gateway.start()

    const response = await sendLine(gateway.path, {
      id: 'submit-2',
      method: 'submitExternalMessage',
      params: {
        message: externalMessage(),
        options: { targetPagelet: 'design' },
      },
    })

    expect(response).toMatchObject({
      id: 'submit-2',
      ok: true,
      result: {
        intent: {
          prompt: 'build from telegram',
          targetPagelet: 'design',
        },
        reply: {
          status: 'queued',
        },
      },
    })

    await gateway.stop()
  })

  it('streams channel reply subscriptions over a local socket', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'telegraph-remote-control-test-'))
    cleanupDirs.push(dir)
    const gateway = new RemoteControlSocketGateway(createFakeService(), join(dir, 'remote.sock'))
    await gateway.start()

    const messages = await sendLines(gateway.path, {
      id: 'reply-subscribe-1',
      method: 'subscribeChannelReplies',
      params: { channelId: 'telegram:chat' },
    }, 2)

    expect(messages[0]).toEqual({
      id: 'reply-subscribe-1',
      ok: true,
      result: { subscribed: true },
    })
    expect(messages[1]).toMatchObject({
      reply: {
        replyId: 'reply-remote',
        channelId: 'telegram:chat',
      },
    })

    await gateway.stop()
  })

  it('streams approval subscriptions over a local socket', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'telegraph-remote-control-test-'))
    cleanupDirs.push(dir)
    const gateway = new RemoteControlSocketGateway(createFakeService(), join(dir, 'remote.sock'))
    await gateway.start()

    const messages = await sendLines(gateway.path, {
      id: 'approval-subscribe-1',
      method: 'subscribeApprovals',
      params: { runId: 'run-1' },
    }, 2)

    expect(messages[0]).toEqual({
      id: 'approval-subscribe-1',
      ok: true,
      result: { subscribed: true },
    })
    expect(messages[1]).toMatchObject({
      approvalEvent: {
        approvalId: 'approval-1',
        runId: 'run-1',
        approval: { status: 'pending' },
      },
    })

    await gateway.stop()
  })

  it('streams projection subscriptions over a local socket', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'telegraph-remote-control-test-'))
    cleanupDirs.push(dir)
    const gateway = new RemoteControlSocketGateway(createFakeService(), join(dir, 'remote.sock'))
    await gateway.start()

    const messages = await sendLines(gateway.path, {
      id: 'projection-subscribe-1',
      method: 'subscribeRunProjections',
      params: { runId: 'run-remote' },
    }, 2)

    expect(messages[0]).toEqual({
      id: 'projection-subscribe-1',
      ok: true,
      result: { subscribed: true },
    })
    expect(messages[1]).toMatchObject({
      projectionEvent: {
        runId: 'run-remote',
        cursor: 2,
        projection: { status: 'running' },
      },
    })

    await gateway.stop()
  })

  it('streams run control subscriptions over a local socket', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'telegraph-remote-control-test-'))
    cleanupDirs.push(dir)
    const gateway = new RemoteControlSocketGateway(createFakeService(), join(dir, 'remote.sock'))
    await gateway.start()

    const messages = await sendLines(gateway.path, {
      id: 'run-control-subscribe-1',
      method: 'subscribeRunControlCommands',
      params: { runId: 'run-remote' },
    }, 2)

    expect(messages[0]).toEqual({
      id: 'run-control-subscribe-1',
      ok: true,
      result: { subscribed: true },
    })
    expect(messages[1]).toMatchObject({
      runControlEvent: {
        runId: 'run-remote',
        cursor: 2,
        command: { status: 'accepted' },
      },
    })

    await gateway.stop()
  })
})

function createFakeService(): RemoteControlGatewayService & { submissions: ExternalMessage[] } {
  const submissions: ExternalMessage[] = []
  return {
    submissions,
    submitExternalMessage(message: ExternalMessage, options = {}): RemoteControlSubmissionResult {
      submissions.push(message)
      return {
        intent: {
          intentId: 'intent-remote',
          source: message.actor,
          targetPagelet: 'targetPagelet' in options && typeof options.targetPagelet === 'string'
            ? options.targetPagelet
            : 'design',
          prompt: message.text ?? '',
          status: 'queued',
          createdAt: 10,
          updatedAt: 10,
        },
        reply: {
          replyId: 'reply-remote',
          channelId: message.channel.channelId,
          runId: undefined,
          text: 'Run queued.',
          status: 'queued',
          createdAt: 10,
          updatedAt: 10,
          schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
        },
      }
    },
    listChannelReplies: () => [{
      replyId: 'reply-remote',
      channelId: 'telegram:chat',
      text: 'Run queued.',
      status: 'queued' as const,
      createdAt: 10,
      updatedAt: 10,
      schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
    }],
    subscribeChannelReplies: () => ({ unsubscribe: () => undefined }),
    ackChannelReply: input => ({
      replyId: input.replyId,
      channelId: 'telegram:chat',
      text: 'Run queued.',
      status: 'queued' as const,
      deliveryStatus: input.status,
      deliveryAttempts: 1,
      deliveredAt: 20,
      deliveredBy: input.deliveredBy,
      createdAt: 10,
      updatedAt: 20,
      schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
    }),
    listApprovals: () => [{
      approvalId: 'approval-1',
      runId: 'run-1',
      source: externalMessage().actor,
      kind: 'tool' as const,
      title: 'Allow tool',
      status: 'pending' as const,
      createdAt: 10,
      updatedAt: 10,
    }],
    listApprovalChanges: () => [{
      type: 'approval_request_changed' as const,
      approvalId: 'approval-1',
      runId: 'run-1',
      cursor: 1,
      approval: {
        approvalId: 'approval-1',
        runId: 'run-1',
        source: externalMessage().actor,
        kind: 'tool' as const,
        title: 'Allow tool',
        status: 'pending' as const,
        createdAt: 10,
        updatedAt: 10,
      },
    }],
    subscribeApprovals: () => ({ unsubscribe: () => undefined }),
    decideApproval: (approvalId, input) => ({
      approvalId,
      runId: 'run-1',
      source: externalMessage().actor,
      kind: 'tool' as const,
      title: 'Allow tool',
      status: input.granted ? 'approved' as const : 'denied' as const,
      granted: input.granted,
      decidedBy: input.decidedBy,
      createdAt: 10,
      updatedAt: 20,
      decidedAt: 20,
    }),
    requestRunControlCommand: input => ({
      commandId: 'runctl-1',
      runId: input.runId,
      kind: input.kind,
      status: 'accepted' as const,
      requestedBy: input.requestedBy,
      reason: input.reason,
      createdAt: 10,
      updatedAt: 10,
    }),
    listRunControlCommands: () => [{
      commandId: 'runctl-1',
      runId: 'run-remote',
      kind: 'cancel' as const,
      status: 'accepted' as const,
      requestedBy: externalMessage().actor,
      createdAt: 10,
      updatedAt: 10,
    }],
    listRunControlChanges: () => [{
      type: 'run_control_command_changed' as const,
      commandId: 'runctl-1',
      runId: 'run-remote',
      cursor: 2,
      command: {
        commandId: 'runctl-1',
        runId: 'run-remote',
        kind: 'cancel' as const,
        status: 'accepted' as const,
        requestedBy: externalMessage().actor,
        createdAt: 10,
        updatedAt: 10,
      },
    }],
    subscribeRunControlCommands: () => ({ unsubscribe: () => undefined }),
    listRunProjections: () => [{
      runId: 'run-remote',
      pageletId: 'design',
      status: 'running' as const,
      cursor: 2,
      eventCount: 4,
      createdAt: 10,
      updatedAt: 20,
    }],
    getRunProjection: runId => ({
      runId,
      pageletId: 'design',
      status: 'running' as const,
      cursor: 2,
      eventCount: 4,
      createdAt: 10,
      updatedAt: 20,
    }),
    listRunProjectionChanges: () => [{
      type: 'run_projection_changed' as const,
      runId: 'run-remote',
      cursor: 2,
      projection: {
        runId: 'run-remote',
        pageletId: 'design',
        status: 'running' as const,
        cursor: 2,
        eventCount: 4,
        createdAt: 10,
        updatedAt: 20,
      },
    }],
    subscribeRunProjections: () => ({ unsubscribe: () => undefined }),
    handleTelegramUpdate: () => [{
      replyId: 'telegram-reply-1',
      channelId: 'telegram:42',
      text: 'run-remote running cursor=2',
      status: 'sent' as const,
      createdAt: 10,
      updatedAt: 10,
      schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
    }],
    handleSlackSlashCommand: payload => ({
      replyId: 'slack-reply-1',
      channelId: `slack:${payload.channel_id}`,
      text: 'Run queued.',
      status: 'queued' as const,
      createdAt: 10,
      updatedAt: 10,
      schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
    }),
    handleSlackEventCallback: () => [],
    handleSlackInteraction: () => [],
    listDeviceBindings: () => [],
    createDeviceBinding: input => ({
      bindingId: input.bindingId ?? 'binding-1',
      deviceId: input.deviceId,
      actor: input.actor,
      status: 'active' as const,
      createdAt: 10,
      updatedAt: 10,
    }),
    revokeDeviceBinding: () => null,
    listSlackWorkspaceBindings: () => [],
    createSlackWorkspaceBinding: input => ({
      workspaceId: input.workspaceId,
      teamDomain: input.teamDomain,
      status: 'active' as const,
      policyProfileId: input.policyProfileId,
      createdAt: 10,
      updatedAt: 10,
    }),
    revokeSlackWorkspaceBinding: workspaceId => ({
      workspaceId,
      status: 'revoked' as const,
      createdAt: 10,
      updatedAt: 20,
      revokedAt: 20,
    }),
    listSlackAppInstallations: () => [],
    createSlackAppInstallation: input => ({
      installationId: input.installationId ?? `slack-install-${input.workspaceId}`,
      workspaceId: input.workspaceId,
      teamDomain: input.teamDomain,
      appId: input.appId,
      botUserId: input.botUserId,
      botTokenRef: input.botTokenRef,
      userTokenRef: input.userTokenRef,
      scopes: input.scopes ?? [],
      status: 'active' as const,
      installedByUserId: input.installedByUserId,
      policyProfileId: input.policyProfileId,
      createdAt: 10,
      updatedAt: 10,
    }),
    revokeSlackAppInstallation: installationId => ({
      installationId,
      workspaceId: 'T123',
      scopes: ['commands'],
      status: 'revoked' as const,
      createdAt: 10,
      updatedAt: 20,
      revokedAt: 20,
    }),
    listSlackUserBindings: () => [],
    createSlackUserBinding: input => ({
      workspaceId: input.workspaceId,
      userId: input.userId,
      actorId: input.actorId ?? `slack:${input.userId}`,
      status: 'active' as const,
      role: input.role ?? 'member' as const,
      policyProfileId: input.policyProfileId,
      createdAt: 10,
      updatedAt: 10,
    }),
    revokeSlackUserBinding: (workspaceId, userId) => ({
      workspaceId,
      userId,
      actorId: `slack:${userId}`,
      status: 'revoked' as const,
      role: 'member' as const,
      createdAt: 10,
      updatedAt: 20,
      revokedAt: 20,
    }),
    listSlackDeviceBindings: () => [],
    createSlackDeviceBinding: input => ({
      bindingId: input.bindingId ?? `slack-device-${input.workspaceId}-${input.userId}-${input.deviceId}`,
      workspaceId: input.workspaceId,
      userId: input.userId,
      deviceId: input.deviceId,
      actorId: input.actorId ?? `slack:${input.userId}`,
      label: input.label,
      status: 'active' as const,
      createdAt: 10,
      updatedAt: 10,
      expiresAt: input.expiresAt,
    }),
    revokeSlackDeviceBinding: bindingId => ({
      bindingId,
      workspaceId: 'T123',
      userId: 'U123',
      deviceId: 'iphone-1',
      actorId: 'slack:U123',
      status: 'revoked' as const,
      createdAt: 10,
      updatedAt: 20,
      revokedAt: 20,
    }),
    handleSlackOAuthCallback: input => ({
      installation: {
        installationId: 'slack-install-T123',
        workspaceId: 'T123',
        scopes: ['commands'],
        status: 'active' as const,
        createdAt: 10,
        updatedAt: 10,
      },
      tokenRefs: {
        botTokenRef: input.code ? 'secret://slack/T123/bot' : undefined,
      },
    }),
    listSlackTeamAuditEvents: () => [],
    handleSlackLifecycleEvent: event => ({
      kind: event.kind,
      workspaceId: event.workspaceId,
      revokedWorkspace: null,
      revokedUsers: (event.userIds ?? []).map(userId => ({
        workspaceId: event.workspaceId,
        userId,
        actorId: `slack:${userId}`,
        status: 'revoked' as const,
        role: 'member' as const,
        createdAt: 10,
        updatedAt: 20,
        revokedAt: 20,
      })),
      revokedDevices: [],
      auditEvent: {
        auditId: 'slack-audit-1',
        ts: 20,
        action: event.kind,
        status: 'accepted' as const,
        workspaceId: event.workspaceId,
        actorId: event.actorId ?? 'slack:lifecycle',
        reason: event.reason,
      },
    }),
  }
}

function sendLines(socketPath: string, request: unknown, count: number): Promise<Array<Record<string, unknown>>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    const messages: Array<Record<string, unknown>> = []
    let buffer = ''
    socket.setEncoding('utf8')
    socket.once('error', reject)
    socket.on('connect', () => {
      socket.write(`${JSON.stringify(request)}\n`)
    })
    socket.on('data', chunk => {
      buffer += String(chunk)
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        messages.push(JSON.parse(line) as Record<string, unknown>)
        if (messages.length >= count) {
          socket.end()
          resolve(messages)
          return
        }
      }
    })
  })
}

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

function sendLine(socketPath: string, request: unknown): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath)
    let buffer = ''
    socket.setEncoding('utf8')
    socket.once('error', reject)
    socket.on('connect', () => {
      socket.write(`${JSON.stringify(request)}\n`)
    })
    socket.on('data', chunk => {
      buffer += String(chunk)
      const index = buffer.indexOf('\n')
      if (index < 0) return
      const line = buffer.slice(0, index)
      socket.end()
      resolve(JSON.parse(line) as Record<string, unknown>)
    })
  })
}
