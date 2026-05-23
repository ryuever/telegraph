import type {
  SlackDeviceBinding,
  SlackTeamAuditEvent,
  SlackUserBinding,
  SlackWorkspaceBinding,
} from '@/apps/remote-control/application/common'

export interface MobileSlackGovernanceSnapshot {
  workspaces: SlackWorkspaceBinding[]
  users: SlackUserBinding[]
  devices: SlackDeviceBinding[]
  auditEvents: SlackTeamAuditEvent[]
}

export interface MobileSlackGovernanceModel {
  summary: {
    activeWorkspaces: number
    activeUsers: number
    activeDevices: number
    auditEvents: number
  }
  workspaces: SlackWorkspaceBinding[]
  users: SlackUserBinding[]
  devices: SlackDeviceBinding[]
  auditEvents: SlackTeamAuditEvent[]
}

export function createMobileSlackGovernanceModel(
  snapshot: MobileSlackGovernanceSnapshot,
): MobileSlackGovernanceModel {
  return {
    summary: {
      activeWorkspaces: snapshot.workspaces.filter(item => item.status === 'active').length,
      activeUsers: snapshot.users.filter(item => item.status === 'active').length,
      activeDevices: snapshot.devices.filter(item => item.status === 'active').length,
      auditEvents: snapshot.auditEvents.length,
    },
    workspaces: snapshot.workspaces.slice().sort((a, b) => b.updatedAt - a.updatedAt),
    users: snapshot.users.slice().sort((a, b) => b.updatedAt - a.updatedAt),
    devices: snapshot.devices.slice().sort((a, b) => b.updatedAt - a.updatedAt),
    auditEvents: snapshot.auditEvents.slice().sort((a, b) => b.ts - a.ts),
  }
}
