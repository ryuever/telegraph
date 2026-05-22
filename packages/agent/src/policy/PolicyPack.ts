import type { RuntimeTaskCapabilityProfile } from '@/packages/agent-protocol'
import type { WorkspacePermissionPolicy } from '@/packages/agent/harness/PermissionBroker'
import type { ComputerUseActionPolicy, ComputerUseObservationPolicy } from '@/packages/computer-use'

export const POLICY_PACK_SCHEMA_VERSION = 1

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
    allowedChannelKinds?: string[]
  }
}

export interface PolicyPack {
  schemaVersion: typeof POLICY_PACK_SCHEMA_VERSION
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
