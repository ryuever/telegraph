import {
  isDesignBuildArtifact,
  type DesignBuildArtifact,
} from './DesignBuildArtifacts'
import type { DesignBuildReview } from './DesignBuildInitialState'

export interface DesignBuildArtifactSummary {
  artifactId: string
  kind: string
  title: string
  parentArtifactId?: string
  revision?: number
  operationCount?: number
  repairAttempt?: number
}

export function createArtifactSummary(
  artifact: {
    id: string
    kind: string
    title: string
    operations?: unknown[]
    parentArtifactId?: string
    revision?: number
  },
  options: { repairAttempt?: number } = {},
): DesignBuildArtifactSummary {
  return {
    artifactId: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    parentArtifactId: artifact.kind === 'design-patch' ? artifact.parentArtifactId : undefined,
    revision: artifact.kind === 'design-patch' ? artifact.revision : undefined,
    operationCount: artifact.kind === 'design-patch' ? artifact.operations?.length : undefined,
    repairAttempt: options.repairAttempt,
  }
}

export function artifactFromChildOutput(output: unknown): DesignBuildArtifact | undefined {
  const artifact = recordField(output, 'artifact')
  return isDesignBuildArtifact(artifact) ? artifact : undefined
}

export function reviewFromChildOutput(output: unknown): DesignBuildReview | undefined {
  const review = recordField(output, 'review')
  const verdict = typeof review?.verdict === 'string' ? review.verdict : undefined
  const checks = Array.isArray(review?.checks) ? review.checks : undefined
  if ((verdict === 'pass' || verdict === 'repair_required' || verdict === 'blocked') && checks) {
    return {
      verdict,
      checks: checks
        .filter((check): check is { id: string; passed: boolean; summary: string } => {
          return Boolean(check) &&
            typeof check === 'object' &&
            !Array.isArray(check) &&
            typeof (check as { id?: unknown }).id === 'string' &&
            typeof (check as { passed?: unknown }).passed === 'boolean' &&
            typeof (check as { summary?: unknown }).summary === 'string'
        }),
    }
  }
  return undefined
}

export function evaluateDesignBuildArtifact(artifact: DesignBuildArtifact): DesignBuildReview {
  if (artifact.kind === 'design-preview') {
    return {
      verdict: artifact.html.trim().length > 0 ? 'pass' : 'repair_required',
      checks: [
        {
          id: 'artifact-structured',
          passed: true,
          summary: 'Produced structured design-preview artifact.',
        },
        {
          id: 'preview-html',
          passed: artifact.html.trim().length > 0,
          summary: 'Preview artifact includes non-empty HTML.',
        },
      ],
    }
  }

  const hasOperations = artifact.operations.length > 0
  const pathsInScope = artifact.operations.every(operation =>
    operation.path.trim().length > 0 && !operation.path.includes('..')
  )
  const sourceContentValid = artifact.operations.every(operation =>
    operation.kind === 'delete' || Boolean(operation.content?.trim())
  )
  const aliasValid = artifact.operations.every(operation =>
    !operation.content || operation.content.includes('@/packages/ui/')
  )

  const checks = [
    {
      id: 'artifact-structured',
      passed: true,
      summary: 'Produced structured design-patch artifact.',
    },
    {
      id: 'patch-first',
      passed: true,
      summary: 'Initial source output is a patch artifact, not a direct filesystem write.',
    },
    {
      id: 'patch-operations',
      passed: hasOperations,
      summary: 'Patch artifact contains at least one normalized file operation.',
    },
    {
      id: 'patch-path-scope',
      passed: pathsInScope,
      summary: 'Patch operation paths are non-empty and remain inside the workspace.',
    },
    {
      id: 'patch-source-content',
      passed: sourceContentValid,
      summary: 'Non-delete patch operations include source content.',
    },
    {
      id: 'alias-rule',
      passed: aliasValid,
      summary: 'Generated source uses monorepo-root @/ imports for shared UI components.',
    },
  ]

  return {
    verdict: pathsInScope
      ? checks.every(check => check.passed) ? 'pass' : 'repair_required'
      : 'blocked',
    checks,
  }
}

export function mergeDesignBuildReview(
  policyReview: DesignBuildReview,
  reviewerReview: DesignBuildReview | undefined,
): DesignBuildReview {
  if (!reviewerReview) return policyReview

  return {
    verdict: stricterVerdict(policyReview.verdict, reviewerReview.verdict),
    checks: [
      ...policyReview.checks.map(check => ({
        ...check,
        id: `policy:${check.id}`,
      })),
      ...reviewerReview.checks.map(check => ({
        ...check,
        id: `reviewer:${check.id}`,
      })),
    ],
  }
}

function stricterVerdict(
  first: DesignBuildReview['verdict'],
  second: DesignBuildReview['verdict'],
): DesignBuildReview['verdict'] {
  if (first === 'blocked' || second === 'blocked') return 'blocked'
  if (first === 'repair_required' || second === 'repair_required') return 'repair_required'
  return 'pass'
}

function recordField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return field && typeof field === 'object' && !Array.isArray(field)
    ? field as Record<string, unknown>
    : undefined
}
