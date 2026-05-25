import { describe, expect, it } from 'vitest'
import { createDefaultDesignSystemPolicy } from '@/apps/design/application/common/design-system-contract'
import type { ComponentRetrievalLedger } from '../ComponentRetrievalLedger'
import { createTemplateDesignPatchArtifact } from '../DesignBuildArtifacts'
import {
  createDesignBuildShadcnProjectTools,
  createDesignBuildShadcnTools,
} from '../DesignBuildShadcnTools'
import type {
  UiComponentCatalogEntry,
  UiComponentInstallPlan,
  UiComponentLibraryProvider,
  UiComponentUsage,
} from '../ui-component-library'

describe('DesignBuildShadcnTools', () => {
  it('exposes catalog docs and returns a component retrieval ledger from model selections', async () => {
    const tools = createDesignBuildShadcnTools({
      prompt: 'Create a profile page with status badges',
      policy: createDefaultDesignSystemPolicy(),
      componentLibraryProvider: new FixtureUiComponentLibraryProvider(),
    })

    expect(tools.map(tool => tool.name)).toEqual([
      'get_shadcn_project_llms',
      'get_shadcn_component_usage',
      'select_shadcn_components',
    ])

    const overview = await tools[0].execute({}, toolContext('call-overview', tools[0].name))
    expect(JSON.stringify(overview)).toContain('badge')

    const docs = await tools[1].execute({
      components: [{ componentName: 'Badge' }],
    }, toolContext('call-docs', tools[1].name))
    expect(JSON.stringify(docs)).toContain('markdownContent')
    expect(JSON.stringify(docs)).toContain('Badge component for labels and status indicators')

    const selection = await tools[2].execute({
      components: [
        { componentName: 'Badge', reason: 'Status labels' },
        { componentName: 'MissingPrimitive', reason: 'Should be rejected' },
      ],
    }, toolContext('call-select', tools[2].name))

    expect(selection).toMatchObject({
      ledger: {
        retrieval: {
          status: 'complete',
        },
      },
    })
    expect(JSON.stringify(selection)).toContain('"name":"badge"')
    expect(JSON.stringify(selection)).toContain('not available or not allowed')
  })

  it('creates a project shell and installs selected component source through project tools', async () => {
    const policy = createDefaultDesignSystemPolicy()
    const retrievalTools = createDesignBuildShadcnTools({
      prompt: 'Create a profile page with status badges',
      policy,
      componentLibraryProvider: new FixtureUiComponentLibraryProvider(),
    })
    const selection = await retrievalTools[2].execute({
      components: [{ componentName: 'Badge', reason: 'Status labels' }],
    }, toolContext('call-select', retrievalTools[2].name))
    const ledger = componentRetrievalLedgerField(selection, 'ledger')
    if (!ledger) throw new Error('Missing ledger')
    const projectTools = createDesignBuildShadcnProjectTools({
      prompt: 'Create a profile page with status badges',
      policy,
      componentLibraryProvider: new FixtureUiComponentLibraryProvider(),
      artifact: createTemplateDesignPatchArtifact({
        runId: 'run-tools-project',
        prompt: 'Create a profile page with status badges',
      }),
      ledger,
    })

    expect(projectTools.map(tool => tool.name)).toEqual([
      'get_shadcn_component_usage',
      'create_shadcn_project',
      'add_shadcn_component',
      'validate_shadcn_component_usage',
    ])

    const usage = await projectTools[0].execute({
      components: [{ componentName: 'Badge' }],
    }, toolContext('call-usage', projectTools[0].name))
    expect(JSON.stringify(usage)).toContain('Badge component for labels and status indicators')

    const project = await projectTools[1].execute({}, toolContext('call-create', projectTools[1].name))
    expect(JSON.stringify(project)).toContain('components.json')

    const badge = await projectTools[2].execute({
      componentName: 'Badge',
      reason: 'Status labels',
    }, toolContext('call-add', projectTools[2].name))
    expect(JSON.stringify(badge)).toContain('src/components/ui/badge.tsx')
    expect(JSON.stringify(badge)).toContain('shadcn-registry-json')
    expect(JSON.stringify(badge)).toContain('badgeVariants')

    const validation = await projectTools[3].execute({
      artifact: {
        id: 'candidate',
        kind: 'design-patch',
        title: 'Candidate',
        operations: [
          {
            kind: 'update',
            path: 'apps/design/src/generated/create-a-profile-page-with-status-badges-page/src/App.tsx',
            content: 'import { Badge } from "@/components/ui/badge"\nexport default function App() { return <Badge>Status</Badge> }\n',
          },
        ],
      },
    }, toolContext('call-validate', projectTools[3].name))
    expect(validation).toMatchObject({ passed: true })
  })
})

function toolContext(callId: string, toolName: string) {
  return {
    runId: 'run-tools',
    callId,
    toolName,
  }
}

function componentRetrievalLedgerField(value: unknown, key: string): ComponentRetrievalLedger | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return isComponentRetrievalLedger(field) ? field : undefined
}

function isComponentRetrievalLedger(value: unknown): value is ComponentRetrievalLedger {
  return isRecord(value) &&
    'query' in value &&
    'policy' in value &&
    'trust' in value &&
    'retrieval' in value &&
    Array.isArray((value as { selected?: unknown }).selected)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

class FixtureUiComponentLibraryProvider implements UiComponentLibraryProvider {
  readonly library = 'shadcn'

  listComponents(): Promise<UiComponentCatalogEntry[]> {
    return Promise.resolve([
      {
        library: this.library,
        name: 'badge',
        title: 'Badge',
        category: 'Feedback & Status',
        description: 'Badge component for labels and status indicators.',
        docsUrl: 'https://ui.shadcn.com/docs/components/badge',
        usageUrl: 'https://ui.shadcn.com/docs/components/radix/badge.md',
        aliases: ['badge'],
      },
    ])
  }

  getComponentUsages(componentNames: string[]): Promise<UiComponentUsage[]> {
    return Promise.resolve(componentNames.map(name => ({
      library: this.library,
      name,
      title: 'Badge',
      sourceUrl: 'https://ui.shadcn.com/docs/components/radix/badge.md',
      contentType: 'text/markdown',
      markdownContent: '# Badge\n\nBadge component for labels and status indicators.',
      truncated: false,
      available: true,
    })))
  }

  installComponent(componentName: string): Promise<UiComponentInstallPlan> {
    return Promise.resolve({
      library: this.library,
      name: componentName,
      sourceUrl: `https://ui.shadcn.com/r/styles/default/${componentName}.json`,
      dependencies: ['class-variance-authority'],
      registryDependencies: [],
      installedComponentNames: [componentName],
      files: [
        {
          path: 'ui/badge.tsx',
          type: 'registry:ui',
          content: [
            'import * as React from "react"',
            'import { cva } from "class-variance-authority"',
            'import { cn } from "@/lib/utils"',
            '',
            'const badgeVariants = cva("inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold")',
            '',
            'export function Badge({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {',
            '  return <div className={cn(badgeVariants(), className)} {...props} />',
            '}',
            '',
            'export { badgeVariants }',
          ].join('\n'),
        },
      ],
    })
  }

  normalizeComponentName(componentName: string): string {
    return componentName.trim().toLowerCase()
  }
}
