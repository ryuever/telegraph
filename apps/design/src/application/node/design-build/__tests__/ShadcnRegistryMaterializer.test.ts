import { describe, expect, it } from 'vitest'
import { evaluateStandaloneProjectFiles } from '@/apps/design/application/common/design-project-contract'
import { createDefaultDesignSystemPolicy } from '@/apps/design/application/common/design-system-contract'
import { createTemplateDesignPatchArtifact } from '../DesignBuildArtifacts'
import { ShadcnRegistryIndexer } from '../ShadcnRegistryIndexer'
import { ShadcnRegistryMaterializer } from '../ShadcnRegistryMaterializer'

describe('ShadcnRegistryMaterializer', () => {
  it('vendors selected shadcn UI files, dependency closure, aliases, and provenance', async () => {
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
    expect(operationContent(result.artifact.operations, 'tsconfig.json')).toContain('"@/*"')
    expect(operationContent(result.artifact.operations, 'vite.config.ts')).toContain("'@': new URL('./src', import.meta.url).pathname")
    expect(operationContent(result.artifact.operations, 'src/lib/utils.ts')).toContain('twMerge(clsx(inputs))')
    expect(operationContent(result.artifact.operations, 'src/styles.css')).toContain('--primary')
    expect(operationContent(result.artifact.operations, 'design-system.theme.json')).toContain('"id": "shadcn-new-york-neutral"')
    expect(operationContent(result.artifact.operations, 'src/components/ui/button.tsx')).toContain('buttonVariants')
    expect(operationContent(result.artifact.operations, 'src/components/ui/card.tsx')).toContain('Card')
    expect(operationContent(result.artifact.operations, 'design-system.provenance.json')).toContain('"policyId": "shadcn-first-standalone"')
    expect(result.aliases).toEqual({ '@': './src' })
    expect(result.provenance.some(item => item.name === 'button')).toBe(true)

    const contract = evaluateStandaloneProjectFiles(result.artifact.operations)
    expect(contract.checks).toEqual(expect.arrayContaining([
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
