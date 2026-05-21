import { describe, expect, it } from 'vitest'
import {
  createMockDesignPatchArtifact,
  createMockDesignPreviewArtifact,
  isDesignBuildArtifact,
  isDesignPatchArtifact,
  isDesignPreviewArtifact,
} from '../DesignBuildArtifacts'

describe('DesignBuildArtifacts', () => {
  it('recognizes design preview artifacts', () => {
    const artifact = createMockDesignPreviewArtifact({
      runId: 'run-preview',
      prompt: 'Create a pricing page',
    })

    expect(isDesignPreviewArtifact(artifact)).toBe(true)
    expect(isDesignBuildArtifact(artifact)).toBe(true)
    expect(artifact).toMatchObject({
      id: 'run-preview-preview',
      kind: 'design-preview',
      title: 'Create a pricing page',
    })
  })

  it('recognizes valid design patch artifacts', () => {
    const artifact = createMockDesignPatchArtifact({
      runId: 'run-patch',
      prompt: 'Create a pricing page',
    })

    expect(isDesignPatchArtifact(artifact)).toBe(true)
    expect(isDesignBuildArtifact(artifact)).toBe(true)
    expect(artifact.operations[0]?.path).toBe('apps/design/src/generated/create-a-pricing-page-page.tsx')
    expect(artifact.operations[0]?.content).toContain('export function CreateAPricingPagePage')
    expect(artifact.operations[0]?.content).toContain('const plans = [')
    expect(artifact.operations[0]?.content).toContain('Choose {plan.name}')
  })

  it('generates prompt-aware source variants', () => {
    const login = createMockDesignPatchArtifact({
      runId: 'run-login',
      prompt: 'Create a login page',
    })
    const settings = createMockDesignPatchArtifact({
      runId: 'run-settings',
      prompt: 'Create a settings page with tabs',
    })

    expect(login.operations[0]?.content).toContain("@/packages/ui/components/ui/input")
    expect(login.operations[0]?.content).toContain('<Input placeholder="email@company.com" />')
    expect(settings.operations[0]?.content).toContain("@/packages/ui/components/ui/tabs")
    expect(settings.operations[0]?.content).toContain('<TabsTrigger value="workspace">Workspace</TabsTrigger>')
  })

  it('rejects malformed design patch artifacts', () => {
    expect(isDesignPatchArtifact({
      id: 'patch-1',
      kind: 'design-patch',
      title: 'Bad patch',
      operations: [{ kind: 'update', content: 'missing path' }],
    })).toBe(false)
  })
})
