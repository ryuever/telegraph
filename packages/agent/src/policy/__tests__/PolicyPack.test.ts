import { describe, expect, it } from 'vitest'
import {
  POLICY_PACK_SCHEMA_VERSION,
  assertPolicyPackValid,
  createPolicyPack,
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
    expect(() => assertPolicyPackValid({
      schemaVersion: 999 as typeof POLICY_PACK_SCHEMA_VERSION,
      packId: 'bad',
      title: 'Bad',
      profiles: [],
    })).toThrow('Unsupported policy pack schema version')

    expect(() => assertPolicyPackValid(createPolicyPack({
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
    }))).toThrow('Duplicate policy profile id: operator')
  })
})
