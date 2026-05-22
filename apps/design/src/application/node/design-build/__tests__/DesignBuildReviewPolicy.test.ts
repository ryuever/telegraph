import { describe, expect, it } from 'vitest'
import type { DesignBuildArtifact } from '../DesignBuildArtifacts'
import {
  evaluateDesignBuildArtifact,
  mergeDesignBuildReview,
} from '../DesignBuildReviewPolicy'

describe('DesignBuildReviewPolicy', () => {
  it('blocks unsafe patch paths before reviewer output can pass the artifact', () => {
    const policyReview = evaluateDesignBuildArtifact(patchArtifact({
      path: '../outside.tsx',
      content: "import { Button } from '@/packages/ui/components/ui/button'\n",
    }))

    const merged = mergeDesignBuildReview(policyReview, {
      verdict: 'pass',
      checks: [{ id: 'semantic-review', passed: true, summary: 'Looks good visually.' }],
    })

    expect(policyReview.verdict).toBe('blocked')
    expect(merged.verdict).toBe('blocked')
    expect(merged.checks.some(check => check.id === 'policy:patch-path-scope' && !check.passed)).toBe(true)
  })

  it('keeps repair required when deterministic checks fail but reviewer passes', () => {
    const policyReview = evaluateDesignBuildArtifact(patchArtifact({
      path: 'apps/design/src/generated/page.tsx',
      content: "import { Button } from '@/invalid-ui/components/ui/button'\n",
    }))

    const merged = mergeDesignBuildReview(policyReview, {
      verdict: 'pass',
      checks: [{ id: 'semantic-review', passed: true, summary: 'Meets the brief.' }],
    })

    expect(policyReview.verdict).toBe('repair_required')
    expect(merged.verdict).toBe('repair_required')
    expect(merged.checks.some(check => check.id === 'policy:alias-rule' && !check.passed)).toBe(true)
  })
})

function patchArtifact(operation: { path: string; content: string }): DesignBuildArtifact {
  return {
    id: 'artifact-1',
    kind: 'design-patch',
    title: 'Generated page',
    operations: [
      {
        kind: 'add',
        path: operation.path,
        content: operation.content,
      },
    ],
  }
}
