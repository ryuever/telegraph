import { describe, expect, it } from 'vitest'
import {
  POLICY_PACK_SCHEMA_VERSION,
  REMOTE_AGENT_OS_POLICY_PACK_ID,
  assertPolicyPackValid,
  createPolicyPack,
  createRemoteAgentOsPolicyPack,
  resolvePolicyProfile,
} from '@/packages/agent/policy'

describe('PolicyPack', () => {
  it('creates versioned policy packs and resolves profiles by local or qualified id', () => {
    const pack = createPolicyPack({
      packId: 'personal',
      title: 'Personal policies',
      profiles: [{
        profileId: 'computer-readonly',
        title: 'Computer Readonly',
        taskCapabilityProfile: {
          kind: 'computer-observe',
          scopes: ['desktop:read'],
        },
        remote: {
          requireDeviceBinding: true,
          allowedChannelKinds: ['mobile', 'telegram'],
        },
      }],
    })

    expect(pack.schemaVersion).toBe(POLICY_PACK_SCHEMA_VERSION)
    expect(resolvePolicyProfile([pack], 'computer-readonly')).toEqual(pack.profiles[0])
    expect(resolvePolicyProfile([pack], 'personal/computer-readonly')).toEqual(pack.profiles[0])
    expect(resolvePolicyProfile([pack], 'missing')).toBeNull()
  })

  it('rejects unsupported versions and duplicate profile ids', () => {
    expect(() => {
      assertPolicyPackValid({
        schemaVersion: 999,
        packId: 'bad',
        title: 'Bad',
        profiles: [],
      })
    }).toThrow('Unsupported policy pack schema version')

    expect(() => {
      assertPolicyPackValid(createPolicyPack({
        packId: 'dupe',
        title: 'Dupe',
        profiles: [
          {
            profileId: 'operator',
            title: 'Operator',
            taskCapabilityProfile: { kind: 'default' },
          },
          {
            profileId: 'operator',
            title: 'Operator duplicate',
            taskCapabilityProfile: { kind: 'default' },
          },
        ],
      }))
    }).toThrow('Duplicate policy profile id: operator')
  })

  it('provides Remote Agent OS personal and team baseline profiles', () => {
    const pack = createRemoteAgentOsPolicyPack()

    assertPolicyPackValid(pack)
    expect(pack.packId).toBe(REMOTE_AGENT_OS_POLICY_PACK_ID)
    expect(pack.profiles.map(profile => profile.profileId)).toEqual([
      'personal',
      'team-readonly',
      'team-operator',
      'admin-approved',
    ])

    expect(resolvePolicyProfile([pack], 'remote-agent-os/team-readonly')).toMatchObject({
      taskCapabilityProfile: {
        kind: 'readonly-workspace',
        scopes: ['workspace:read', 'repo:read'],
      },
      remote: {
        requireDeviceBinding: true,
        allowedChannelKinds: ['slack', 'webhook', 'mobile'],
      },
    })

    expect(resolvePolicyProfile([pack], 'team-operator')).toMatchObject({
      taskCapabilityProfile: {
        kind: 'computer-act',
        actions: ['click', 'type', 'hotkey', 'scroll', 'wait'],
      },
      computerUse: {
        actionPolicy: {
          requireApproval: true,
          maxActionsPerRun: 10,
          captureBeforeAfter: true,
        },
      },
    })

    expect(resolvePolicyProfile([pack], 'admin-approved')).toMatchObject({
      taskCapabilityProfile: {
        kind: 'coding-edit',
        patchPolicy: 'apply-after-confirm',
      },
      workspacePolicy: {
        shell: {
          maxRisk: 'high',
        },
      },
      remote: {
        requireDeviceBinding: true,
        allowedChannelKinds: ['slack', 'mobile', 'cli', 'mcp'],
      },
    })
  })
})
