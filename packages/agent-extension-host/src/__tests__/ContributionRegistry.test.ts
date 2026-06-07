import { describe, expect, it } from 'vitest'
import {
  agentAliasList,
  agentCatalogText,
  ContributionRegistry,
  parseHarnessExtensionManifest,
} from '@/packages/agent-extension-host'

describe('ContributionRegistry', () => {
  it('creates a snapshot with resolved agent aliases, resources, and origins', () => {
    const registry = new ContributionRegistry()

    registry.registerManifest({
      id: '@telegraph/subagents',
      displayName: 'Telegraph Subagents',
      version: '0.1.0',
      contributes: {
        agents: [
          {
            id: 'scout',
            title: 'Scout',
            description: 'Collect facts.',
            prompt: './agents/scout.md',
            tools: ['read', 'grep'],
          },
        ],
        resources: [
          {
            id: 'scout-skill',
            kind: 'skill',
            path: './skills/scout/SKILL.md',
          },
        ],
      },
    }, {
      rootPath: '/repo/extensions/telegraph-subagents',
      sourceKind: 'builtin',
    })

    const snapshot = registry.createSnapshot()

    expect(agentAliasList(snapshot)).toEqual(['scout'])
    expect(snapshot.agents[0]).toMatchObject({
      alias: 'scout',
      fullId: '@telegraph/subagents/scout',
      promptPath: '/repo/extensions/telegraph-subagents/agents/scout.md',
      origin: {
        extensionId: '@telegraph/subagents',
        sourceKind: 'builtin',
      },
    })
    expect(snapshot.resources[0]).toMatchObject({
      fullId: '@telegraph/subagents/scout-skill',
      sourcePath: '/repo/extensions/telegraph-subagents/skills/scout/SKILL.md',
      origin: {
        extensionId: '@telegraph/subagents',
        contributionId: 'scout-skill',
      },
    })
    expect(agentCatalogText(snapshot)).toContain('scout: Collect facts.')
  })

  it('lets workspace profiles override builtin aliases through snapshot priority', () => {
    const registry = new ContributionRegistry()
    registry.registerManifest({
      id: '@telegraph/subagents',
      displayName: 'Telegraph Subagents',
      version: '0.1.0',
      contributes: {
        agents: [
          {
            id: 'scout',
            title: 'Scout',
            description: 'Builtin scout.',
            prompt: './agents/scout.md',
          },
        ],
      },
    }, {
      rootPath: '/repo/extensions/telegraph-subagents',
      sourceKind: 'builtin',
    })
    registry.registerManifest({
      id: '@telegraph/workspace-agents',
      displayName: 'Workspace Agents',
      version: '0.1.0',
      contributes: {
        agents: [
          {
            id: 'scout',
            title: 'Workspace Scout',
            description: 'Workspace-specific scout.',
            prompt: './scout.md',
          },
          {
            id: 'db-migrator',
            title: 'DB Migrator',
            description: 'Plans database migrations.',
            prompt: './db-migrator.md',
          },
        ],
      },
    }, {
      rootPath: '/repo/.telegraph/agents',
      sourceKind: 'workspace',
    })

    const snapshot = registry.createSnapshot()

    expect(agentAliasList(snapshot)).toEqual(['scout', 'db-migrator'])
    expect(snapshot.agents.find(agent => agent.alias === 'scout')).toMatchObject({
      description: 'Workspace-specific scout.',
      origin: {
        extensionId: '@telegraph/workspace-agents',
        sourceKind: 'workspace',
      },
    })
  })

  it('validates resource contributions in manifests', () => {
    expect(() => parseHarnessExtensionManifest({
      id: '@telegraph/bad',
      displayName: 'Bad',
      version: '0.1.0',
      contributes: {
        resources: [
          { id: 'bad-resource', kind: 'unknown', path: './x' },
        ],
      },
    })).toThrow(/invalid resource kind/)
  })
})
