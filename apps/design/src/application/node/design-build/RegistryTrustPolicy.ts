import type {
  ComponentCandidate,
  RegistryTrustMetadata,
} from './ComponentRetrievalLedger'

export interface RegistryTrustPolicyInput {
  allowlist?: RegistryTrustMetadata[]
  blocklist?: string[]
}

export interface RegistryTrustEvaluation {
  allowed: ComponentCandidate[]
  rejected: Array<ComponentCandidate & { rejectionReason: string }>
  metadata: {
    allowedRegistries: string[]
    blockedRegistries: string[]
    registries: RegistryTrustMetadata[]
  }
}

const DEFAULT_REGISTRIES: RegistryTrustMetadata[] = [
  {
    id: '@shadcn',
    label: 'shadcn/ui official registry',
    trustLevel: 'official',
    license: 'MIT',
    lastChecked: '2026-05-24',
  },
]

export class RegistryTrustPolicy {
  private readonly allowlist: RegistryTrustMetadata[]
  private readonly blocklist: Set<string>

  constructor(input: RegistryTrustPolicyInput = {}) {
    this.allowlist = input.allowlist ?? DEFAULT_REGISTRIES
    this.blocklist = new Set(input.blocklist ?? [])
  }

  evaluate(candidates: ComponentCandidate[]): RegistryTrustEvaluation {
    const allowedRegistryIds = new Set(this.allowlist.map(registry => registry.id))
    const allowed: ComponentCandidate[] = []
    const rejected: Array<ComponentCandidate & { rejectionReason: string }> = []

    for (const candidate of candidates) {
      if (this.blocklist.has(candidate.registry)) {
        rejected.push({ ...candidate, rejectionReason: `Registry ${candidate.registry} is blocklisted.` })
        continue
      }
      if (!allowedRegistryIds.has(candidate.registry)) {
        rejected.push({ ...candidate, rejectionReason: `Registry ${candidate.registry} is not allowlisted.` })
        continue
      }
      allowed.push(candidate)
    }

    return {
      allowed,
      rejected,
      metadata: {
        allowedRegistries: [...allowedRegistryIds],
        blockedRegistries: [...this.blocklist],
        registries: this.allowlist.map(registry => ({
          ...registry,
          trustLevel: this.blocklist.has(registry.id) ? 'blocked' : registry.trustLevel,
        })),
      },
    }
  }

  pinDependencies(dependencies: string[], pinnedVersions: Record<string, string>): string[] {
    return dependencies.map(dependency => {
      const pinned = pinnedVersions[dependency]
      return pinned ? `${dependency}@${pinned}` : dependency
    })
  }
}

export function retrievalMetrics(input: {
  candidateCount: number
  selectedCount: number
  rejectedCount: number
  fallbackCount: number
}) {
  return {
    ...input,
    hitRate: input.candidateCount === 0 ? 0 : input.selectedCount / input.candidateCount,
    fallbackRate: input.selectedCount + input.fallbackCount === 0
      ? 0
      : input.fallbackCount / (input.selectedCount + input.fallbackCount),
    repairRate: 0,
    visualFailureRate: 0,
  }
}
