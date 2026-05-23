import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  FileSlackTeamGovernanceRepository,
  SlackTeamGovernance,
} from '../SlackTeamGovernance'

const cleanupDirs: string[] = []

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('SlackTeamGovernance', () => {
  it('allows unconfigured local-dev Slack routing', () => {
    const governance = SlackTeamGovernance.empty()

    expect(governance.authorize({
      workspaceId: 'T123',
      userId: 'U123',
      actorId: 'slack:U123',
      channelId: 'slack:C123',
      action: 'ask',
    })).toEqual({ allowed: true })
  })

  it('rejects revoked users and persists audit snapshots', async () => {
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
        status: 'revoked',
        role: 'operator',
        createdAt: 10,
        updatedAt: 20,
        revokedAt: 20,
      }],
    })

    expect(governance.authorize({
      workspaceId: 'T123',
      userId: 'U123',
      actorId: 'slack:U123',
      channelId: 'slack:C123',
      action: 'approve',
    })).toEqual({
      allowed: false,
      reason: 'Slack user "U123" is revoked.',
    })

    governance.recordAuditEvent({
      action: 'approve',
      status: 'rejected',
      workspaceId: 'T123',
      actorId: 'slack:U123',
      channelId: 'slack:C123',
      reason: 'Slack user "U123" is revoked.',
      now: 30,
    })

    const dir = mkdtempSync(join(tmpdir(), 'telegraph-slack-governance-'))
    cleanupDirs.push(dir)
    const repository = new FileSlackTeamGovernanceRepository(dir)
    await repository.save(governance.snapshot())

    await expect(repository.load()).resolves.toMatchObject({
      workspaces: [{ workspaceId: 'T123', status: 'active' }],
      users: [{ workspaceId: 'T123', userId: 'U123', status: 'revoked' }],
      devices: [],
      auditEvents: [{
        action: 'approve',
        status: 'rejected',
        actorId: 'slack:U123',
        reason: 'Slack user "U123" is revoked.',
      }],
    })
  })

  it('revokes Slack users from lifecycle token and workspace leave events', () => {
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
        role: 'operator',
        createdAt: 10,
        updatedAt: 10,
      }, {
        workspaceId: 'T123',
        userId: 'U456',
        actorId: 'slack:U456',
        status: 'active',
        role: 'member',
        createdAt: 10,
        updatedAt: 10,
      }],
      devices: [{
        bindingId: 'slack-device-T123-U123-iphone-1',
        workspaceId: 'T123',
        userId: 'U123',
        deviceId: 'iphone-1',
        actorId: 'slack:U123',
        status: 'active',
        createdAt: 10,
        updatedAt: 10,
      }],
    })

    expect(governance.applyLifecycleEvent({
      kind: 'tokens_revoked',
      workspaceId: 'T123',
      userIds: ['U123'],
      now: 20,
    })).toMatchObject({
      kind: 'tokens_revoked',
      workspaceId: 'T123',
      revokedWorkspace: null,
      revokedUsers: [{ userId: 'U123', status: 'revoked', revokedAt: 20 }],
      auditEvent: {
        action: 'tokens_revoked',
        status: 'accepted',
        reason: 'Slack token revoke affected users: U123.',
      },
    })

    expect(governance.authorize({
      workspaceId: 'T123',
      userId: 'U123',
      actorId: 'slack:U123',
      action: 'ask',
    })).toMatchObject({
      allowed: false,
      reason: 'Slack user "U123" is revoked.',
    })

    expect(governance.applyLifecycleEvent({
      kind: 'user_left_workspace',
      workspaceId: 'T123',
      userIds: ['U456'],
      now: 30,
    })).toMatchObject({
      kind: 'user_left_workspace',
      revokedUsers: [{ userId: 'U456', status: 'revoked', revokedAt: 30 }],
      auditEvent: {
        action: 'user_left_workspace',
        status: 'accepted',
      },
    })
  })

  it('records Slack app installations without persisting raw OAuth tokens', () => {
    const governance = SlackTeamGovernance.empty()

    expect(governance.createAppInstallation({
      workspaceId: 'T123',
      teamDomain: 'example',
      appId: 'A123',
      botUserId: 'Ubot',
      botTokenRef: 'secret://slack/T123/bot',
      scopes: ['commands', 'chat:write', 'commands'],
      installedByUserId: 'Uadmin',
      policyProfileId: 'remote-agent-os/team-operator',
      now: 20,
    })).toMatchObject({
      installationId: 'slack-install-T123',
      workspaceId: 'T123',
      teamDomain: 'example',
      appId: 'A123',
      botUserId: 'Ubot',
      botTokenRef: 'secret://slack/T123/bot',
      scopes: ['commands', 'chat:write'],
      status: 'active',
      installedByUserId: 'Uadmin',
      policyProfileId: 'remote-agent-os/team-operator',
      createdAt: 20,
      updatedAt: 20,
    })

    expect(governance.listWorkspaceBindings()).toMatchObject([{
      workspaceId: 'T123',
      teamDomain: 'example',
      status: 'active',
      policyProfileId: 'remote-agent-os/team-operator',
    }])
    expect(governance.listUserBindings()).toMatchObject([{
      workspaceId: 'T123',
      userId: 'Uadmin',
      actorId: 'slack:Uadmin',
      status: 'active',
      role: 'admin',
    }])
    expect(governance.listAuditEvents()).toMatchObject([{
      action: 'app_installed',
      status: 'accepted',
      actorId: 'slack:Uadmin',
      policyProfileId: 'remote-agent-os/team-operator',
    }])
  })

  it('revokes workspace and active users when Slack app access is removed', () => {
    const governance = new SlackTeamGovernance({
      installations: [{
        installationId: 'slack-install-T123',
        workspaceId: 'T123',
        scopes: ['commands'],
        status: 'active',
        createdAt: 10,
        updatedAt: 10,
      }],
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
        role: 'operator',
        createdAt: 10,
        updatedAt: 10,
      }],
      devices: [{
        bindingId: 'slack-device-T123-U123-iphone-1',
        workspaceId: 'T123',
        userId: 'U123',
        deviceId: 'iphone-1',
        actorId: 'slack:U123',
        status: 'active',
        createdAt: 10,
        updatedAt: 10,
      }],
    })

    expect(governance.applyLifecycleEvent({
      kind: 'app_uninstalled',
      workspaceId: 'T123',
      actorId: 'slack:admin',
      now: 40,
    })).toMatchObject({
      kind: 'app_uninstalled',
      revokedWorkspace: { workspaceId: 'T123', status: 'revoked', revokedAt: 40 },
      revokedUsers: [{ userId: 'U123', status: 'revoked', revokedAt: 40 }],
      revokedDevices: [{ bindingId: 'slack-device-T123-U123-iphone-1', status: 'revoked', revokedAt: 40 }],
      auditEvent: {
        action: 'app_uninstalled',
        actorId: 'slack:admin',
        reason: 'Slack app was uninstalled; workspace access revoked.',
      },
    })

    expect(governance.listAppInstallations()).toMatchObject([{
      installationId: 'slack-install-T123',
      status: 'revoked',
      revokedAt: 40,
    }])
  })

  it('records Slack device binding lifecycle in team governance audit', () => {
    const governance = SlackTeamGovernance.empty()

    expect(governance.upsertDeviceBinding({
      workspaceId: 'T123',
      userId: 'U123',
      deviceId: 'iphone-1',
      label: 'iPhone',
      now: 10,
    })).toMatchObject({
      bindingId: 'slack-device-T123-U123-iphone-1',
      workspaceId: 'T123',
      userId: 'U123',
      deviceId: 'iphone-1',
      actorId: 'slack:U123',
      label: 'iPhone',
      status: 'active',
    })

    expect(governance.revokeDeviceBinding('slack-device-T123-U123-iphone-1', 20)).toMatchObject({
      bindingId: 'slack-device-T123-U123-iphone-1',
      status: 'revoked',
      revokedAt: 20,
    })
    expect(governance.listAuditEvents()).toMatchObject([
      { action: 'device_bound', status: 'accepted', actorId: 'slack:U123' },
      { action: 'device_revoked', status: 'accepted', actorId: 'slack:U123' },
    ])
  })
})
