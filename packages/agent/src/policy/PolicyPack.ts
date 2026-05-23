import type { RuntimeTaskCapabilityProfile } from '@/packages/agent-protocol'
import type { WorkspacePermissionPolicy } from '@/packages/agent/harness/PermissionBroker'
import type { ComputerUseActionPolicy, ComputerUseObservationPolicy } from '@/packages/computer-use'

export const POLICY_PACK_SCHEMA_VERSION = 1
export const REMOTE_AGENT_OS_POLICY_PACK_ID = 'remote-agent-os'
export type RemotePolicyChannelKind = 'cli' | 'mobile' | 'telegram' | 'slack' | 'mcp' | 'webhook'

export interface PolicyProfile {
  profileId: string
  title: string
  description?: string
  taskCapabilityProfile: RuntimeTaskCapabilityProfile
  workspacePolicy?: WorkspacePermissionPolicy
  computerUse?: {
    actionPolicy?: Partial<ComputerUseActionPolicy>
    observationPolicy?: ComputerUseObservationPolicy
  }
  remote?: {
    requireDeviceBinding?: boolean
    allowedChannelKinds?: RemotePolicyChannelKind[]
  }
}

export interface PolicyPack {
  schemaVersion: number
  packId: string
  title: string
  description?: string
  profiles: PolicyProfile[]
}

export function createPolicyPack(
  input: Omit<PolicyPack, 'schemaVersion'>,
): PolicyPack {
  return {
    schemaVersion: POLICY_PACK_SCHEMA_VERSION,
    packId: input.packId,
    title: input.title,
    description: input.description,
    profiles: input.profiles.map(profile => structuredClone(profile)),
  }
}

export function resolvePolicyProfile(
  packs: PolicyPack[],
  profileRef: string,
): PolicyProfile | null {
  const [packId, profileId] = profileRef.includes('/')
    ? profileRef.split('/', 2)
    : [undefined, profileRef]

  for (const pack of packs) {
    if (packId && pack.packId !== packId) continue
    const profile = pack.profiles.find(item => item.profileId === profileId)
    if (profile) return structuredClone(profile)
  }
  return null
}

export function assertPolicyPackValid(pack: PolicyPack): void {
  if (pack.schemaVersion !== POLICY_PACK_SCHEMA_VERSION) {
    throw new Error(`Unsupported policy pack schema version: ${String(pack.schemaVersion)}`)
  }
  const ids = new Set<string>()
  for (const profile of pack.profiles) {
    if (ids.has(profile.profileId)) {
      throw new Error(`Duplicate policy profile id: ${profile.profileId}`)
    }
    ids.add(profile.profileId)
  }
}

export function createRemoteAgentOsPolicyPack(): PolicyPack {
  return createPolicyPack({
    packId: REMOTE_AGENT_OS_POLICY_PACK_ID,
    title: 'Remote Agent OS policies',
    description: 'Default personal and team profiles for remote entry surfaces.',
    profiles: [
      {
        profileId: 'personal',
        title: 'Personal',
        description: 'Personal remote control with bound devices and observation-first computer use.',
        taskCapabilityProfile: {
          kind: 'computer-observe',
          scopes: ['desktop:read', 'app:*', 'window:*'],
        },
        remote: {
          requireDeviceBinding: true,
          allowedChannelKinds: ['cli', 'mobile', 'telegram', 'mcp'],
        },
      },
      {
        profileId: 'team-readonly',
        title: 'Team Readonly',
        description: 'Team channel access for run status and workspace reads, with no desktop actions.',
        taskCapabilityProfile: {
          kind: 'readonly-workspace',
          scopes: ['workspace:read', 'repo:read'],
        },
        workspacePolicy: {
          filesystem: {
            readableScopes: ['workspace'],
            writableScopes: [],
          },
        },
        remote: {
          requireDeviceBinding: true,
          allowedChannelKinds: ['slack', 'webhook', 'mobile'],
        },
      },
      {
        profileId: 'team-operator',
        title: 'Team Operator',
        description: 'Team-approved desktop operation with strict action budget and per-action approval.',
        taskCapabilityProfile: {
          kind: 'computer-act',
          scopes: ['desktop:read', 'app:*', 'window:*'],
          actions: ['click', 'type', 'hotkey', 'scroll', 'wait'],
        },
        computerUse: {
          actionPolicy: {
            requireApproval: true,
            allowedKinds: ['click', 'type', 'hotkey', 'scroll', 'wait'],
            maxActionsPerRun: 10,
            captureBeforeAfter: true,
            maxObservationAgeMs: 5_000,
          },
        },
        remote: {
          requireDeviceBinding: true,
          allowedChannelKinds: ['slack', 'mobile'],
        },
      },
      {
        profileId: 'admin-approved',
        title: 'Admin Approved',
        description: 'High-trust profile for explicitly approved administrative runs.',
        taskCapabilityProfile: {
          kind: 'coding-edit',
          scopes: ['workspace:read', 'workspace:write', 'repo:read', 'repo:write'],
          patchPolicy: 'apply-after-confirm',
        },
        workspacePolicy: {
          filesystem: {
            readableScopes: ['workspace'],
            writableScopes: ['workspace'],
            autoGrantWrites: false,
          },
          shell: {
            maxRisk: 'high',
            autoGrantUpToRisk: 'low',
          },
        },
        computerUse: {
          actionPolicy: {
            requireApproval: true,
            allowedKinds: ['click', 'type', 'hotkey', 'scroll', 'wait'],
            maxActionsPerRun: 20,
            captureBeforeAfter: true,
            maxObservationAgeMs: 5_000,
          },
        },
        remote: {
          requireDeviceBinding: true,
          allowedChannelKinds: ['slack', 'mobile', 'cli', 'mcp'],
        },
      },
    ],
  })
}
