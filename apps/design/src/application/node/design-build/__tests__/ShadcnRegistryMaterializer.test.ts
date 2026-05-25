import { describe, expect, it } from 'vitest'
import {
  evaluateStandaloneProjectFiles,
  TAILWIND_PLAY_CDN_SCRIPT_URL,
} from '@/apps/design/application/common/design-project-contract'
import { createDefaultDesignSystemPolicy } from '@/apps/design/application/common/design-system-contract'
import { createTemplateDesignPatchArtifact } from '../DesignBuildArtifacts'
import { ShadcnRegistryIndexer } from '../ShadcnRegistryIndexer'
import { ShadcnRegistryMaterializer } from '../ShadcnRegistryMaterializer'

describe('ShadcnRegistryMaterializer', () => {
  it('normalizes the shadcn project shell without installing selected UI files itself', async () => {
    const policy = createDefaultDesignSystemPolicy()
    const ledger = await new ShadcnRegistryIndexer().retrieve({
      prompt: 'Create a login page',
      policy,
    })
    const artifact = createTemplateDesignPatchArtifact({
      runId: 'run-materialize',
      prompt: 'Create a login page',
    })

    const result = new ShadcnRegistryMaterializer().materialize({
      artifact,
      ledger,
      policy,
    })

    expect(operationContent(result.artifact.operations, 'package.json')).toContain('class-variance-authority')
    expect(operationContent(result.artifact.operations, 'package.json')).toContain('@radix-ui/react-slot')
    expect(operationContent(result.artifact.operations, 'components.json')).toContain('"ui": "@/components/ui"')
    expect(operationContent(result.artifact.operations, 'index.html')).toContain('<div id="root"></div>')
    expect(operationContent(result.artifact.operations, 'index.html')).toContain(`src="${TAILWIND_PLAY_CDN_SCRIPT_URL}"`)
    expect(operationContent(result.artifact.operations, 'index.html')).toContain('type="text/tailwindcss"')
    expect(operationContent(result.artifact.operations, 'index.html')).toContain('--color-background: var(--background);')
    expect(operationContent(result.artifact.operations, 'src/index.tsx')).toContain("import './styles.css'")
    expect(operationContent(result.artifact.operations, 'src/index.tsx')).toContain("import GeneratedDesignPage from './App'")
    expect(operationContent(result.artifact.operations, 'tsconfig.json')).toContain('"@/*"')
    expect(operationContent(result.artifact.operations, 'vite.config.ts')).toContain("'@': new URL('./src', import.meta.url).pathname")
    expect(operationContent(result.artifact.operations, 'src/lib/utils.ts')).toContain('twMerge(clsx(inputs))')
    expect(operationContent(result.artifact.operations, 'src/styles.css')).toContain('--primary')
    expect(operationContent(result.artifact.operations, 'design-system.theme.json')).toContain('"id": "shadcn-new-york-neutral"')
    expect(operationContent(result.artifact.operations, 'design-system.provenance.json')).toContain('"policyId": "shadcn-first-standalone"')
    expect(result.aliases).toEqual({ '@': './src' })
    expect(result.provenance).toEqual([])
    expect(operationContent(result.artifact.operations, 'src/components/ui/button.tsx')).toBe('')
    expect(operationContent(result.artifact.operations, 'src/components/ui/card.tsx')).toBe('')

    const contract = evaluateStandaloneProjectFiles(result.artifact.operations)
    expect(contract.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'standalone-tailwind-play-cdn', passed: true }),
      expect.objectContaining({ id: 'standalone-external-dependencies', passed: true }),
      expect.objectContaining({ id: 'standalone-alias-config', passed: true }),
      expect.objectContaining({ id: 'standalone-shadcn-components-json', passed: true }),
      expect.objectContaining({ id: 'standalone-shadcn-local-files', passed: true }),
      expect.objectContaining({ id: 'standalone-shadcn-provenance', passed: true }),
      expect.objectContaining({ id: 'standalone-cn-helper', passed: true }),
      expect.objectContaining({ id: 'standalone-radix-deps', passed: true }),
      expect.objectContaining({ id: 'standalone-theme-tokens-present', passed: true }),
      expect.objectContaining({ id: 'standalone-no-raw-colors', passed: true }),
    ]))
  })

  it('fills missing standalone shell files and rewrites raw source colors to semantic tokens', async () => {
    const policy = createDefaultDesignSystemPolicy()
    const ledger = await new ShadcnRegistryIndexer().retrieve({
      prompt: 'Create a task board',
      policy,
    })
    const artifact = {
      id: 'partial-shell',
      kind: 'design-patch' as const,
      title: 'Partial shell',
      operations: [
        {
          kind: 'add' as const,
          path: 'apps/design/src/generated/generated-design-page/package.json',
          content: JSON.stringify({
            dependencies: {
              react: '19.1.0',
              'react-dom': '19.1.0',
            },
          }),
        },
        {
          kind: 'add' as const,
          path: 'apps/design/src/generated/generated-design-page/src/App.tsx',
          content: "export default function App() { return <main style={{ color: '#dc2626', backgroundColor: '#fef2f2' }}>Tasks</main> }\n",
        },
      ],
    }

    const result = new ShadcnRegistryMaterializer().materialize({
      artifact,
      ledger,
      policy,
    })

    expect(operationContent(result.artifact.operations, 'index.html')).toContain('./src/index.tsx?entry')
    expect(operationContent(result.artifact.operations, 'src/index.tsx')).toContain('<GeneratedDesignPage />')
    const appSource = operationContent(result.artifact.operations, 'src/App.tsx')
    expect(appSource).not.toContain('#dc2626')
    expect(appSource).not.toContain('#fef2f2')
    expect(appSource).toContain('var(--primary)')
    expect(appSource).toContain('var(--secondary)')
    expect(evaluateStandaloneProjectFiles(result.artifact.operations).passed).toBe(true)
  })

  it('pins React dependencies over model-provided latest or canary versions', async () => {
    const policy = createDefaultDesignSystemPolicy()
    const ledger = await new ShadcnRegistryIndexer().retrieve({
      prompt: 'Create a task board',
      policy,
    })
    const artifact = {
      id: 'react-pin',
      kind: 'design-patch' as const,
      title: 'React pin',
      operations: [
        {
          kind: 'add' as const,
          path: 'apps/design/src/generated/generated-design-page/package.json',
          content: JSON.stringify({
            dependencies: {
              react: 'latest',
              'react-dom': '19.3.0-canary-fef12a01-20260413',
            },
          }),
        },
        {
          kind: 'add' as const,
          path: 'apps/design/src/generated/generated-design-page/src/App.tsx',
          content: 'export default function App() { return <main>Tasks</main> }',
        },
      ],
    }

    const result = new ShadcnRegistryMaterializer().materialize({
      artifact,
      ledger,
      policy,
    })

    const packageJson = operationContent(result.artifact.operations, 'package.json')
    expect(packageJson).toContain('"react": "19.1.0"')
    expect(packageJson).toContain('"react-dom": "19.1.0"')
    expect(packageJson).not.toContain('canary')
    expect(packageJson).not.toContain('"react": "latest"')
  })

  it('records shadcn component provenance from tool-installed source files', async () => {
    const policy = createDefaultDesignSystemPolicy()
    const ledger = await new ShadcnRegistryIndexer().retrieve({
      prompt: 'Create a profile page',
      policy,
    })
    ledger.selected.push({
      registry: '@shadcn',
      name: 'Badge',
      type: 'registry:ui',
      description: 'Status labels and compact metadata.',
      score: 8,
      reason: 'Selected by the shadcn component tool.',
      dependencies: ['class-variance-authority'],
      files: ['src/components/ui/Badge.tsx'],
      materializedFiles: ['src/components/ui/Badge.tsx'],
      importExamples: ['import { Badge } from "@/components/ui/Badge"'],
    })

    const artifact = createTemplateDesignPatchArtifact({
      runId: 'run-local-badge',
      prompt: 'Create a profile page',
    })
    artifact.operations.push({
      kind: 'add',
      path: 'apps/design/src/generated/create-a-profile-page-page/src/components/ui/badge.tsx',
      content: 'export function Badge() { return <div /> }\n',
    })
    artifact.metadata = {
      shadcnToolInstallations: [
        {
          name: 'badge',
          source: '@shadcn/badge',
          sourceKind: 'registry-cache-fallback',
          command: 'add_shadcn_component badge',
          files: ['apps/design/src/generated/create-a-profile-page-page/src/components/ui/badge.tsx'],
          dependencies: ['class-variance-authority'],
          reason: 'Status labels and compact metadata.',
        },
      ],
    }

    const result = new ShadcnRegistryMaterializer().materialize({
      artifact,
      ledger,
      policy,
    })

    const provenance = operationContent(result.artifact.operations, 'design-system.provenance.json')
    expect(provenance).toContain('"name": "badge"')
    expect(provenance).toContain('"sourceKind": "registry-cache-fallback"')
    expect(provenance).toContain('"command": "add_shadcn_component badge"')
    expect(operationContent(result.artifact.operations, 'src/components/ui/badge.tsx')).toContain('Badge')
    expect(operationContent(result.artifact.operations, 'package.json')).toContain('class-variance-authority')
    expect(evaluateStandaloneProjectFiles(result.artifact.operations).passed).toBe(true)
  })

  it('emits stable pack-specific CSS variable differences for the same prompt', async () => {
    const ledger = await new ShadcnRegistryIndexer().retrieve({
      prompt: 'Create a dashboard',
      policy: createDefaultDesignSystemPolicy(),
    })
    const artifact = createTemplateDesignPatchArtifact({
      runId: 'run-theme-pack',
      prompt: 'Create a dashboard',
    })
    const neutralPolicy = createDefaultDesignSystemPolicy()
    const darkPolicy = {
      ...neutralPolicy,
      themePack: {
        id: 'studio-dark',
        label: 'Studio Dark',
        source: 'built-in' as const,
      },
    }

    const neutral = new ShadcnRegistryMaterializer().materialize({
      artifact,
      ledger,
      policy: neutralPolicy,
    })
    const dark = new ShadcnRegistryMaterializer().materialize({
      artifact,
      ledger,
      policy: darkPolicy,
    })

    expect(operationContent(neutral.artifact.operations, 'src/styles.css')).toContain('--background: #ffffff;')
    expect(operationContent(dark.artifact.operations, 'src/styles.css')).toContain('--background: #0d1117;')
    expect(operationContent(dark.artifact.operations, 'design-system.theme.json')).toContain('"id": "studio-dark"')
  })
})

function operationContent(operations: Array<{ path: string; content?: string }>, suffix: string): string {
  return operations.find(operation => operation.path.endsWith(suffix))?.content ?? ''
}
