import { describe, expect, it } from 'vitest'
import { createMockDesignPatchArtifact } from '../DesignBuildArtifacts'
import type { DesignBuildOrchestratorOutput } from '../DesignBuildOrchestrator'
import {
  assertValidDesignBuildOutput,
  validateDesignBuildOutput,
} from '../DesignBuildValidation'

describe('DesignBuildValidation', () => {
  it('repairs invalid shared UI aliases once', () => {
    const output = outputFixture()
    const artifact = output.artifact
    if (artifact.kind === 'design-patch') {
      artifact.operations[0] = {
        ...artifact.operations[0],
        content: artifact.operations[0]?.content?.replace(/@\/packages\/ui\//g, '@/invalid-ui/'),
      }
    }

    const result = validateDesignBuildOutput(output)

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('patch operation does not use shared UI alias: apps/design/src/generated/create-a-dashboard-page.tsx')
    expect(JSON.stringify(result.repaired)).toContain('@/packages/ui/components/ui/button')
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
  const artifact = createMockDesignPatchArtifact({
    runId: 'run-validation',
    prompt: 'Create a dashboard',
  })
  artifact.operations[0] = {
    ...artifact.operations[0],
    path: 'apps/design/src/generated/create-a-dashboard-page.tsx',
  }
  return {
    brief: {
      prompt: 'Create a dashboard',
      summary: 'Create a dashboard',
      acceptanceCriteria: ['Produce a visible preview artifact.'],
    },
    context: {
      runtime: 'telegraph-design-build',
      aliasRule: '@/ mirrors the monorepo root with src elided',
      artifactPolicy: 'preview',
      defaultOutputMode: 'design-patch',
    },
    components: [],
    plan: {
      sourceTarget: 'apps/design/src/generated/create-a-dashboard-page.tsx',
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
