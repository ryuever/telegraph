import { describe, expect, it } from 'vitest'
import {
  createTemplateDesignPatchArtifact,
  createTemplateDesignPreviewArtifact,
  isDesignBuildArtifact,
  isDesignPatchArtifact,
  isDesignPreviewArtifact,
} from '../DesignBuildArtifacts'

describe('DesignBuildArtifacts', () => {
  it('recognizes design preview artifacts', () => {
    const artifact = createTemplateDesignPreviewArtifact({
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
    const artifact = createTemplateDesignPatchArtifact({
      runId: 'run-patch',
      prompt: 'Create a pricing page',
    })

    expect(isDesignPatchArtifact(artifact)).toBe(true)
    expect(isDesignBuildArtifact(artifact)).toBe(true)
    expect(artifact.operations.map(operation => operation.path)).toEqual([
      'apps/design/src/generated/create-a-pricing-page-page/package.json',
      'apps/design/src/generated/create-a-pricing-page-page/index.html',
      'apps/design/src/generated/create-a-pricing-page-page/vite.config.ts',
      'apps/design/src/generated/create-a-pricing-page-page/src/index.tsx',
      'apps/design/src/generated/create-a-pricing-page-page/src/App.tsx',
      'apps/design/src/generated/create-a-pricing-page-page/src/styles.css',
    ])
    expect(artifact.operations[0]?.content).toContain('"react": "19.1.0"')
    expect(artifact.operations[4]?.content).toContain('export function CreateAPricingPagePage')
    expect(artifact.operations[4]?.content).not.toContain('@/packages/ui/')
  })

  it('generates a package.json-driven standalone app scaffold', () => {
    const artifact = createTemplateDesignPatchArtifact({
      runId: 'run-dashboard',
      prompt: 'Create a dashboard page',
    })

    expect(artifact.operations.find(operation => operation.path.endsWith('/package.json'))?.content)
      .toContain('"dev": "vite"')
    expect(artifact.operations.find(operation => operation.path.endsWith('/index.html'))?.content)
      .toContain('src="./src/index.tsx?entry"')
    expect(artifact.operations.find(operation => operation.path.endsWith('/src/index.tsx'))?.content)
      .toContain("import App from './App'")
    expect(artifact.operations.find(operation => operation.path.endsWith('/src/styles.css'))?.content)
      .toContain('.app-shell')
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
