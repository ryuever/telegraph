import { describe, expect, it } from 'vitest'
import type { DesignBuildArtifact } from '../DesignBuildArtifacts'
import {
  createDefaultDesignSystemPolicy,
} from '@/apps/design/application/common/design-system-contract'
import {
  evaluateDesignBuildArtifact,
  mergeDesignBuildReview,
} from '../DesignBuildReviewPolicy'

describe('DesignBuildReviewPolicy', () => {
  it('blocks unsafe patch paths before reviewer output can pass the artifact', () => {
    const policyReview = evaluateDesignBuildArtifact(patchArtifact([
      {
        path: '../outside.tsx',
        content: 'export default function App() { return <main /> }\n',
      },
    ]))

    const merged = mergeDesignBuildReview(policyReview, {
      verdict: 'pass',
      checks: [{ id: 'semantic-review', passed: true, summary: 'Looks good visually.' }],
    })

    expect(policyReview.verdict).toBe('blocked')
    expect(merged.verdict).toBe('blocked')
    expect(merged.checks.some(check => check.id === 'policy:patch-path-scope' && !check.passed)).toBe(true)
  })

  it('keeps repair required when deterministic checks fail but reviewer passes', () => {
    const policyReview = evaluateDesignBuildArtifact(patchArtifact([
      {
        path: 'apps/design/src/generated/page.tsx',
        content: "import { Button } from '@/packages/ui/components/ui/button'\n\nexport default function App() { return <Button /> }\n",
      },
    ]))

    const merged = mergeDesignBuildReview(policyReview, {
      verdict: 'pass',
      checks: [{ id: 'semantic-review', passed: true, summary: 'Meets the brief.' }],
    })

    expect(policyReview.verdict).toBe('repair_required')
    expect(merged.verdict).toBe('repair_required')
    expect(merged.checks.some(check => check.id === 'policy:standalone-package-root' && !check.passed)).toBe(true)
    expect(merged.checks.some(check => check.id === 'policy:standalone-imports' && !check.passed)).toBe(true)
  })

  it('adds policy evidence checks when a design system policy is provided', () => {
    const policyReview = evaluateDesignBuildArtifact(patchArtifact([
      {
        path: 'apps/design/src/generated/page/package.json',
        content: JSON.stringify({
          dependencies: {
            react: '19.1.0',
            'react-dom': '19.1.0',
          },
        }),
      },
      {
        path: 'apps/design/src/generated/page/index.html',
        content: '<div id="root"></div><script type="module" src="./src/index.tsx?entry"></script>',
      },
      {
        path: 'apps/design/src/generated/page/src/index.tsx',
        content: "import App from './App'\n",
      },
      {
        path: 'apps/design/src/generated/page/src/App.tsx',
        content: 'export default function App() { return <main /> }\n',
      },
    ]), {
      designSystemPolicy: createDefaultDesignSystemPolicy(),
    })

    expect(policyReview.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'design-system-policy-resolved', passed: true }),
      expect.objectContaining({ id: 'design-system-handwrite-policy', passed: true }),
      expect.objectContaining({ id: 'design-system-dependency-closure', passed: true }),
    ]))
  })

  it('requires component edits to target composition files instead of dirtying shadcn primitives', () => {
    const policyReview = evaluateDesignBuildArtifact(patchArtifact([
      {
        path: 'apps/design/src/generated/page/package.json',
        content: JSON.stringify({
          dependencies: {
            react: '19.1.0',
            'react-dom': '19.1.0',
          },
        }),
      },
      {
        path: 'apps/design/src/generated/page/index.html',
        content: '<div id="root"></div><script type="module" src="./src/index.tsx?entry"></script>',
      },
      {
        path: 'apps/design/src/generated/page/src/index.tsx',
        content: "import App from './App'\n",
      },
      {
        path: 'apps/design/src/generated/page/src/App.tsx',
        content: 'export default function App() { return <main /> }\n',
      },
    ]), {
      componentEdit: {
        kind: 'component-edit',
        artifactId: 'artifact-1',
        binding: {
          editScope: 'composition',
          preferredOperationPath: 'apps/design/src/generated/page/src/App.tsx',
          protectedPrimitivePaths: ['apps/design/src/generated/page/src/components/ui/button.tsx'],
          provenance: 'shadcn-primitive',
        },
        dirtyOperationPaths: ['apps/design/src/generated/page/src/components/ui/button.tsx'],
        dirtyOperations: [
          {
            kind: 'update',
            path: 'apps/design/src/generated/page/src/components/ui/button.tsx',
            source: 'style-editor',
          },
        ],
      },
    })

    expect(policyReview.verdict).toBe('repair_required')
    expect(policyReview.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'component-edit-context-bound', passed: true }),
      expect.objectContaining({ id: 'component-edit-composition-target', passed: true }),
      expect.objectContaining({ id: 'component-edit-primitive-guard', passed: false }),
    ]))
  })
})

function patchArtifact(operations: Array<{ path: string; content: string }>): DesignBuildArtifact {
  return {
    id: 'artifact-1',
    kind: 'design-patch',
    title: 'Generated page',
    operations: operations.map(operation => ({
      kind: 'add',
      path: operation.path,
      content: operation.content,
    })),
  }
}
