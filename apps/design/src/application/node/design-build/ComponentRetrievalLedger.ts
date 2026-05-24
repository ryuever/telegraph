import type { DesignSystemPolicy } from '@/apps/design/application/common/design-system-contract'

export type ComponentRetrievalStatus = 'complete' | 'degraded'

export interface ComponentRetrievalLedger {
  query: {
    prompt: string
    pageType: string
    roles: ComponentNeed[]
    selectedThemePack?: string
  }
  policy: {
    id: string
    mode: DesignSystemPolicy['mode']
    allowedRegistries: string[]
    handwritePolicy: DesignSystemPolicy['uiLibrary']['handwritePolicy']
  }
  trust: {
    allowedRegistries: string[]
    blockedRegistries: string[]
    registries: RegistryTrustMetadata[]
  }
  retrieval: {
    status: ComponentRetrievalStatus
    sources: ComponentRetrievalSource[]
    degradedReason?: string
    metrics: ComponentRetrievalMetrics
  }
  candidates: ComponentCandidate[]
  selected: SelectedComponentAsset[]
  fallbacks: HandwriteFallback[]
  rejected: RejectedComponentCandidate[]
}

export interface RegistryTrustMetadata {
  id: string
  label: string
  trustLevel: 'official' | 'allowlisted' | 'blocked' | 'unknown'
  license?: string
  lastChecked?: string
}

export interface ComponentRetrievalMetrics {
  candidateCount: number
  selectedCount: number
  rejectedCount: number
  fallbackCount: number
  hitRate: number
  fallbackRate: number
  repairRate: number
  visualFailureRate: number
}

export interface ComponentNeed {
  role: string
  required: boolean
  examples: string[]
}

export interface ComponentRetrievalSource {
  kind: 'shadcn-cli-search' | 'shadcn-cli-docs' | 'shadcn-cli-view' | 'static-shadcn-catalog' | 'shadcn-llms'
  registry: string
  query?: string
  status: 'ok' | 'failed' | 'skipped'
  error?: string
}

export interface ComponentCandidate {
  registry: string
  name: string
  type: 'registry:ui' | 'registry:block' | 'registry:component'
  description?: string
  score: number
  reason: string
  dependencies?: string[]
  files?: string[]
}

export interface SelectedComponentAsset extends ComponentCandidate {
  materializedFiles: string[]
  importExamples: string[]
}

export interface HandwriteFallback {
  role: string
  reason: 'not-found' | 'cli-unavailable' | 'unsupported-registry' | 'app-specific-composition'
  searched: string[]
  allowedScope: string
}

export interface RejectedComponentCandidate extends ComponentCandidate {
  rejectionReason: string
}

export function createRetrievalPolicySnapshot(policy: DesignSystemPolicy): ComponentRetrievalLedger['policy'] {
  return {
    id: policy.id,
    mode: policy.mode,
    allowedRegistries: policy.uiLibrary.allowedRegistries.map(registry => registry.id),
    handwritePolicy: policy.uiLibrary.handwritePolicy,
  }
}
