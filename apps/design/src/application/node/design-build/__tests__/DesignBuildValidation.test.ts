import { describe, expect, it } from 'vitest'
import { createDefaultDesignSystemPolicy } from '@/apps/design/application/common/design-system-contract'
import { createTemplateDesignPatchArtifact } from '../DesignBuildArtifacts'
import type { DesignBuildOrchestratorOutput } from '../DesignBuildOrchestrator'
import {
  assertValidDesignBuildOutput,
  validateDesignBuildOutput,
} from '../DesignBuildValidation'

describe('DesignBuildValidation', () => {
  it('accepts the standalone project scaffold', () => {
    const output = outputFixture()

    const result = validateDesignBuildOutput(output)

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('flags source that is not a complete standalone project', () => {
    const output = outputFixture()
    if (output.artifact.kind === 'design-patch') {
      output.artifact.operations = [
        {
          kind: 'add',
          path: 'apps/design/src/generated/create-a-dashboard-page.tsx',
          content: 'export default function App() { return <main /> }',
        },
      ]
    }

    const result = validateDesignBuildOutput(output)

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('standalone project check failed: standalone-package-root')
    expect(result.errors).toContain('standalone project check failed: standalone-react-entry')
  })

  it('flags entry imports that do not resolve to generated files', () => {
    const output = outputFixture()
    if (output.artifact.kind === 'design-patch') {
      const entry = output.artifact.operations.find(operation => operation.path.endsWith('/src/index.tsx'))
      if (entry) {
        entry.content = [
          "import { createRoot } from 'react-dom/client'",
          "import ProfilePage from './ProfilePage'",
          '',
          "createRoot(document.getElementById('root')!).render(<ProfilePage />)",
        ].join('\n')
      }
    }

    const result = validateDesignBuildOutput(output)

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('standalone project check failed: standalone-local-imports')
  })

  it('allows component names that match the entry import instead of forcing App.tsx', () => {
    const output = outputFixture()
    if (output.artifact.kind === 'design-patch') {
      output.artifact.operations = output.artifact.operations.map(operation => {
        if (operation.path.endsWith('/src/index.tsx')) {
          return {
            ...operation,
            content: [
              "import { createRoot } from 'react-dom/client'",
              "import ProfilePage from './ProfilePage'",
              '',
              "createRoot(document.getElementById('root')!).render(<ProfilePage />)",
            ].join('\n'),
          }
        }
        if (operation.path.endsWith('/src/App.tsx')) {
          return {
            ...operation,
            path: operation.path.replace('/src/App.tsx', '/src/ProfilePage.tsx'),
            content: 'export default function ProfilePage() { return <main>Profile</main> }',
          }
        }
        return operation
      })
    }

    const result = validateDesignBuildOutput(output)

    expect(result.valid).toBe(true)
  })

  it('throws patch_invalid when output cannot be repaired', () => {
    const output = outputFixture()
    if (output.artifact.kind === 'design-patch') {
      output.artifact.operations = []
    }

    expect(() => { assertValidDesignBuildOutput(output) }).toThrow('DesignBuild output failed validation.')
  })
})

function outputFixture(): DesignBuildOrchestratorOutput {
  const artifact = createTemplateDesignPatchArtifact({
    runId: 'run-validation',
    prompt: 'Create a dashboard',
  })
  return {
    brief: {
      prompt: 'Create a dashboard',
      summary: 'Create a dashboard',
      acceptanceCriteria: ['Produce a visible preview artifact.'],
    },
    context: {
      runtime: 'telegraph-design-build',
      artifactPolicy: 'preview',
      defaultOutputMode: 'design-patch',
      designSystem: createDefaultDesignSystemPolicy(),
      sandboxProject: {
        projectRoot: 'apps/design/src/generated/create-a-dashboard-page',
        dependencySource: 'package.json',
        requiredFiles: [
          'package.json',
          'index.html',
          'src/index.tsx or src/main.tsx',
          'component files imported by the entry',
        ],
      },
    },
    components: [],
    plan: {
      sourceTarget: 'apps/design/src/generated/create-a-dashboard-page/src/App.tsx',
      sections: ['Dashboard'],
      componentTree: ['main'],
      responsiveStrategy: 'Responsive',
    },
    artifact,
    review: {
      verdict: 'pass',
      checks: [{ id: 'ok', passed: true, summary: 'ok' }],
    },
  }
}
