import type { PermissionRequest, RuntimeTaskCapabilityProfile } from '@/packages/agent-protocol'

export const CAPABILITY_MARKETPLACE_SCHEMA_VERSION = 1

export type MarketplaceListingSource = 'builtin' | 'workspace' | 'user' | 'remote'

export type MarketplaceToolRisk = 'low' | 'medium' | 'high' | 'critical'

export type MarketplaceApprovalMode = 'none' | 'profile' | 'always'

export interface MarketplaceApprovalPolicy {
  mode: MarketplaceApprovalMode
  reason?: string
}

export interface MarketplaceToolDefinition {
  id: string
  title: string
  description: string
  taskCapability: RuntimeTaskCapabilityProfile
  inputSchema: Record<string, unknown>
  permissions: PermissionRequest[]
  approval: MarketplaceApprovalPolicy
  risk: MarketplaceToolRisk
  tags?: string[]
  metadata?: Record<string, unknown>
}

export interface CapabilityMarketplaceListing {
  schemaVersion: typeof CAPABILITY_MARKETPLACE_SCHEMA_VERSION
  listingId: string
  title: string
  version: string
  publisher: string
  description?: string
  source: MarketplaceListingSource
  homepageUrl?: string
  repositoryUrl?: string
  tools: MarketplaceToolDefinition[]
  policyProfileRefs?: string[]
  metadata?: Record<string, unknown>
}

export interface ResolvedMarketplaceTool {
  listingId: string
  listingTitle: string
  listingVersion: string
  publisher: string
  source: MarketplaceListingSource
  tool: MarketplaceToolDefinition
}

export interface MarketplaceCatalogEntry {
  listingId: string
  title: string
  version: string
  publisher: string
  source: MarketplaceListingSource
  toolCount: number
  risks: MarketplaceToolRisk[]
  capabilityKinds: RuntimeTaskCapabilityProfile['kind'][]
}

export function createCapabilityMarketplaceListing(
  input: Omit<CapabilityMarketplaceListing, 'schemaVersion'>,
): CapabilityMarketplaceListing {
  const listing: CapabilityMarketplaceListing = {
    ...structuredClone(input),
    schemaVersion: CAPABILITY_MARKETPLACE_SCHEMA_VERSION,
  }
  assertCapabilityMarketplaceListingValid(listing)
  return listing
}

export function assertCapabilityMarketplaceListingValid(
  listing: CapabilityMarketplaceListing,
): void {
  const errors = validateCapabilityMarketplaceListing(listing)
  if (errors.length > 0) {
    throw new Error(`Invalid capability marketplace listing:\n${errors.join('\n')}`)
  }
}

export function validateCapabilityMarketplaceListing(
  listing: CapabilityMarketplaceListing,
): string[] {
  const errors: string[] = []

  if (listing.schemaVersion !== CAPABILITY_MARKETPLACE_SCHEMA_VERSION) {
    errors.push(`Unsupported schemaVersion: ${String(listing.schemaVersion)}`)
  }
  requireNonEmptyString(listing.listingId, 'listingId', errors)
  requireNonEmptyString(listing.title, 'title', errors)
  requireNonEmptyString(listing.version, 'version', errors)
  requireNonEmptyString(listing.publisher, 'publisher', errors)
  if (!['builtin', 'workspace', 'user', 'remote'].includes(listing.source)) {
    errors.push(`Invalid source: ${String(listing.source)}`)
  }
  if (!Array.isArray(listing.tools) || listing.tools.length === 0) {
    errors.push('Listing must declare at least one tool')
    return errors
  }

  const toolIds = new Set<string>()
  for (const [index, tool] of listing.tools.entries()) {
    const prefix = `tools[${index}]`
    requireNonEmptyString(tool.id, `${prefix}.id`, errors)
    requireNonEmptyString(tool.title, `${prefix}.title`, errors)
    requireNonEmptyString(tool.description, `${prefix}.description`, errors)
    if (toolIds.has(tool.id)) {
      errors.push(`${prefix}.id duplicates another tool id: ${tool.id}`)
    }
    toolIds.add(tool.id)

    if (!isRecord(tool.inputSchema)) {
      errors.push(`${prefix}.inputSchema must be an object`)
    }
    if (!isRuntimeTaskCapabilityProfile(tool.taskCapability)) {
      errors.push(`${prefix}.taskCapability must be a valid RuntimeTaskCapabilityProfile`)
    }
    if (!Array.isArray(tool.permissions)) {
      errors.push(`${prefix}.permissions must be an array`)
    }
    if (!isMarketplaceApprovalPolicy(tool.approval)) {
      errors.push(`${prefix}.approval must declare a valid approval mode`)
    }
    if (!['low', 'medium', 'high', 'critical'].includes(tool.risk)) {
      errors.push(`${prefix}.risk must be low, medium, high, or critical`)
    }
    if (
      (tool.risk === 'high' || tool.risk === 'critical') &&
      tool.approval?.mode === 'none'
    ) {
      errors.push(`${prefix}.approval cannot be "none" for ${tool.risk} risk tools`)
    }
  }

  return errors
}

export function marketplaceToolKey(listingId: string, toolId: string): string {
  return `${listingId}/${toolId}`
}

export class InMemoryCapabilityMarketplace {
  private readonly listings = new Map<string, CapabilityMarketplaceListing>()

  register(listing: CapabilityMarketplaceListing): void {
    assertCapabilityMarketplaceListingValid(listing)
    this.listings.set(listing.listingId, structuredClone(listing))
  }

  unregister(listingId: string): boolean {
    return this.listings.delete(listingId)
  }

  listListings(): CapabilityMarketplaceListing[] {
    return Array.from(this.listings.values(), listing => structuredClone(listing))
  }

  listCatalog(): MarketplaceCatalogEntry[] {
    return this.listListings().map(listing => ({
      listingId: listing.listingId,
      title: listing.title,
      version: listing.version,
      publisher: listing.publisher,
      source: listing.source,
      toolCount: listing.tools.length,
      risks: unique(listing.tools.map(tool => tool.risk)),
      capabilityKinds: unique(listing.tools.map(tool => tool.taskCapability.kind)),
    }))
  }

  resolveTool(ref: string): ResolvedMarketplaceTool | null {
    const slashIndex = ref.indexOf('/')
    const listingId = slashIndex >= 0 ? ref.slice(0, slashIndex) : undefined
    const toolId = slashIndex >= 0 ? ref.slice(slashIndex + 1) : ref

    for (const listing of this.listings.values()) {
      if (listingId && listing.listingId !== listingId) continue
      const tool = listing.tools.find(item => item.id === toolId)
      if (!tool) continue
      return {
        listingId: listing.listingId,
        listingTitle: listing.title,
        listingVersion: listing.version,
        publisher: listing.publisher,
        source: listing.source,
        tool: structuredClone(tool),
      }
    }
    return null
  }
}

function requireNonEmptyString(value: unknown, field: string, errors: string[]): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${field} must be a non-empty string`)
  }
}

function isMarketplaceApprovalPolicy(value: unknown): value is MarketplaceApprovalPolicy {
  if (!isRecord(value)) return false
  return ['none', 'profile', 'always'].includes(String(value.mode))
}

function isRuntimeTaskCapabilityProfile(value: unknown): value is RuntimeTaskCapabilityProfile {
  if (!isRecord(value) || typeof value.kind !== 'string') return false
  switch (value.kind) {
    case 'default':
    case 'computer-observe':
      return true
    case 'readonly-workspace':
    case 'coding-edit':
    case 'design-build':
      return Array.isArray(value.scopes)
    case 'computer-act':
      return value.scopes === undefined || Array.isArray(value.scopes)
    case 'shell-automation':
      return value.cwdPolicy === 'workspace' || value.cwdPolicy === 'restricted'
    default:
      return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}
