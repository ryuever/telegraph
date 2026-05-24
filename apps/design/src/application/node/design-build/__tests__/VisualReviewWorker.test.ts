import { describe, expect, it } from 'vitest'
import { createDefaultDesignSystemPolicy } from '@/apps/design/application/common/design-system-contract'
import { createTemplateDesignPatchArtifact } from '../DesignBuildArtifacts'
import { ShadcnRegistryIndexer } from '../ShadcnRegistryIndexer'
import { ShadcnRegistryMaterializer } from '../ShadcnRegistryMaterializer'
import { VisualReviewWorker } from '../VisualReviewWorker'

describe('VisualReviewWorker', () => {
  it('passes the shadcn-compatible generated scaffold', async () => {
    const policy = createDefaultDesignSystemPolicy()
    const ledger = await new ShadcnRegistryIndexer().retrieve({
      prompt: 'Create a SaaS dashboard landing page',
      policy,
    })
    const artifact = new ShadcnRegistryMaterializer().materialize({
      artifact: createTemplateDesignPatchArtifact({
        runId: 'visual-pass',
        prompt: 'Create a SaaS dashboard landing page',
      }),
      ledger,
      policy,
    }).artifact

    const report = new VisualReviewWorker().review(artifact)

    expect(report.status).toBe('pass')
    expect(report.viewports.map(viewport => viewport.id)).toEqual(['desktop', 'mobile'])
  })

  it('fails blank renderable source', () => {
    const artifact = createTemplateDesignPatchArtifact({
      runId: 'visual-blank',
      prompt: 'Blank',
    })
    artifact.operations = artifact.operations.map(operation => operation.path.endsWith('/src/App.tsx')
      ? { ...operation, content: 'export default function App() { return null }' }
      : operation)

    const report = new VisualReviewWorker().review(artifact)

    expect(report.status).toBe('repair_required')
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'visual-nonblank', passed: false }),
    ]))
  })

  it('fails likely mobile overflow and button clipping rules', () => {
    const artifact = createTemplateDesignPatchArtifact({
      runId: 'visual-overflow',
      prompt: 'Overflow',
    })
    artifact.operations = artifact.operations.map(operation => operation.path.endsWith('/src/styles.css')
      ? { ...operation, content: 'main { width: 120vw; } button { height: 18px; overflow: hidden; white-space: nowrap; }' }
      : operation)

    const report = new VisualReviewWorker().review(artifact)

    expect(report.status).toBe('repair_required')
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'visual-mobile-horizontal-overflow', passed: false }),
      expect.objectContaining({ id: 'visual-text-button-clipping', passed: false }),
    ]))
  })

  it('fails likely overlap and runtime error signals', () => {
    const artifact = createTemplateDesignPatchArtifact({
      runId: 'visual-runtime',
      prompt: 'Runtime',
    })
    artifact.operations = artifact.operations.map(operation => operation.path.endsWith('/src/App.tsx')
      ? { ...operation, content: 'export default function App() { throw new Error("boom") }' }
      : operation.path.endsWith('/src/styles.css')
        ? { ...operation, content: '.a { position: absolute; top: 0; left: 0; } .b { position: fixed; top: 0; left: 0; }' }
        : operation)

    const report = new VisualReviewWorker().review(artifact)

    expect(report.status).toBe('repair_required')
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'visual-element-overlap', passed: false }),
      expect.objectContaining({ id: 'visual-compile-runtime-errors', passed: false }),
    ]))
    expect(report.compileRuntime.status).toBe('error-signals')
  })
})
