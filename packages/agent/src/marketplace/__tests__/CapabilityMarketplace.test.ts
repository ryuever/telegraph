import { describe, expect, it } from 'vitest'

import {
  InMemoryCapabilityMarketplace,
  createCapabilityMarketplaceListing,
  marketplaceToolKey,
  validateCapabilityMarketplaceListing,
  type CapabilityMarketplaceListing,
} from '@/packages/agent/marketplace'

const baseListingInput = {
  listingId: 'filesystem-tools',
  title: 'Filesystem Tools',
  version: '1.0.0',
  publisher: 'Telegraph',
  source: 'builtin',
  tools: [
    {
      id: 'read-workspace',
      title: 'Read Workspace',
      description: 'Read files inside the current workspace.',
      inputSchema: { type: 'object' },
      taskCapability: { kind: 'readonly-workspace', scopes: ['workspace'] },
      permissions: [{ type: 'filesystem', scope: 'workspace', access: 'read' }],
      approval: { mode: 'profile' },
      risk: 'low',
    },
  ],
} satisfies Omit<CapabilityMarketplaceListing, 'schemaVersion'>

function listing(overrides: Partial<CapabilityMarketplaceListing> = {}) {
  return createCapabilityMarketplaceListing({
    ...baseListingInput,
    ...overrides,
  })
}

function rawListing(overrides: Partial<CapabilityMarketplaceListing> = {}) {
  return {
    schemaVersion: 1,
    ...baseListingInput,
    ...overrides,
  } satisfies CapabilityMarketplaceListing
}

describe('CapabilityMarketplace', () => {
  it('creates a versioned listing and exposes catalog metadata', () => {
    const marketplace = new InMemoryCapabilityMarketplace()
    marketplace.register(listing())

    expect(marketplace.listCatalog()).toEqual([
      {
        listingId: 'filesystem-tools',
        title: 'Filesystem Tools',
        version: '1.0.0',
        publisher: 'Telegraph',
        source: 'builtin',
        toolCount: 1,
        risks: ['low'],
        capabilityKinds: ['readonly-workspace'],
      },
    ])
  })

  it('resolves tools by fully qualified ref or bare tool id', () => {
    const marketplace = new InMemoryCapabilityMarketplace()
    marketplace.register(listing())

    expect(marketplace.resolveTool(marketplaceToolKey('filesystem-tools', 'read-workspace'))?.tool.title)
      .toBe('Read Workspace')
    expect(marketplace.resolveTool('read-workspace')?.listingId).toBe('filesystem-tools')
  })

  it('rejects duplicate tool ids', () => {
    const candidate = rawListing({
      tools: [
        {
          id: 'same',
          title: 'One',
          description: 'First tool.',
          inputSchema: { type: 'object' },
          taskCapability: { kind: 'default' },
          permissions: [],
          approval: { mode: 'profile' },
          risk: 'low',
        },
        {
          id: 'same',
          title: 'Two',
          description: 'Second tool.',
          inputSchema: { type: 'object' },
          taskCapability: { kind: 'default' },
          permissions: [],
          approval: { mode: 'profile' },
          risk: 'low',
        },
      ],
    })

    expect(validateCapabilityMarketplaceListing(candidate))
      .toContain('tools[1].id duplicates another tool id: same')
  })

  it('requires high-risk tools to declare approval', () => {
    const candidate = {
      ...rawListing(),
      tools: [
        {
          id: 'type-into-app',
          title: 'Type Into App',
          description: 'Types into the active app.',
          inputSchema: { type: 'object' },
          taskCapability: { kind: 'computer-act', scopes: ['app:*'], actions: ['type'] },
          permissions: [{ type: 'process', commands: ['osascript'] }],
          approval: { mode: 'none' },
          risk: 'high',
        },
      ],
    } satisfies CapabilityMarketplaceListing

    expect(validateCapabilityMarketplaceListing(candidate))
      .toContain('tools[0].approval cannot be "none" for high risk tools')
  })

  it('returns defensive copies', () => {
    const marketplace = new InMemoryCapabilityMarketplace()
    marketplace.register(listing())
    const resolved = marketplace.resolveTool('read-workspace')
    expect(resolved).not.toBeNull()

    resolved!.tool.title = 'Mutated'

    expect(marketplace.resolveTool('read-workspace')?.tool.title).toBe('Read Workspace')
  })
})
