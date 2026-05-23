import { describe, expect, it } from 'vitest'
import { createMobileSlackGovernanceModel } from '../MobileSlackGovernanceViewModel'

describe('MobileSlackGovernanceViewModel', () => {
  it('sorts Slack governance entities and counts active bindings', () => {
    const model = createMobileSlackGovernanceModel({
      workspaces: [{
        workspaceId: 'T1',
        status: 'revoked',
        createdAt: 1,
        updatedAt: 10,
      }, {
        workspaceId: 'T2',
        status: 'active',
        createdAt: 1,
        updatedAt: 20,
      }],
      users: [{
        workspaceId: 'T2',
        userId: 'U1',
        actorId: 'slack:U1',
        status: 'active',
        role: 'admin',
        createdAt: 1,
        updatedAt: 20,
      }],
      devices: [{
        bindingId: 'D1',
        workspaceId: 'T2',
        userId: 'U1',
        deviceId: 'iphone',
        actorId: 'slack:U1',
        status: 'active',
        createdAt: 1,
        updatedAt: 30,
      }],
      auditEvents: [{
        auditId: 'A1',
        action: 'app_installed',
        status: 'accepted',
        actorId: 'slack:U1',
        ts: 50,
      }, {
        auditId: 'A2',
        action: 'device_bound',
        status: 'accepted',
        actorId: 'slack:U1',
        ts: 60,
      }],
    })

    expect(model.summary).toEqual({
      activeWorkspaces: 1,
      activeUsers: 1,
      activeDevices: 1,
      auditEvents: 2,
    })
    expect(model.workspaces.map(workspace => workspace.workspaceId)).toEqual(['T2', 'T1'])
    expect(model.auditEvents.map(event => event.auditId)).toEqual(['A2', 'A1'])
  })
})
