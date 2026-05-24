import {
  isDesignBuildArtifact,
  type DesignBuildArtifact,
} from './DesignBuildArtifacts'
import type { DesignBuildReview } from './DesignBuildInitialState'
import {
  evaluateStandaloneProjectFiles,
  isSafeProjectPatchPath,
} from '@/apps/design/application/common/design-project-contract'
import type { DesignSystemPolicy } from '@/apps/design/application/common/design-system-contract'
import {
  isShadcnPrimitivePath,
  type ComponentEditContext,
} from '@/apps/design/application/common/component-edit-contract'
import { ThemePackRegistry } from './ThemePackRegistry'

export interface DesignBuildArtifactSummary {
  artifactId: string
  kind: string
  title: string
  parentArtifactId?: string
  revision?: number
  operationCount?: number
  repairAttempt?: number
}

export interface DesignBuildReviewPolicyOptions {
  designSystemPolicy?: DesignSystemPolicy
  componentEdit?: ComponentEditContext
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

export function evaluateDesignBuildArtifact(
  artifact: DesignBuildArtifact,
  options: DesignBuildReviewPolicyOptions = {},
): DesignBuildReview {
  if (artifact.kind === 'design-preview') {
    return {
      verdict: artifact.html.trim().length > 0 ? 'pass' : 'repair_required',
      checks: [
        ...designSystemChecks(options.designSystemPolicy),
        ...componentEditChecks(options.componentEdit),
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
  const pathsInScope = artifact.operations.every(operation => isSafeProjectPatchPath(operation.path))
  const sourceContentValid = artifact.operations.every(operation =>
    operation.kind === 'delete' || Boolean(operation.content?.trim())
  )
  const projectContract = evaluateStandaloneProjectFiles(artifact.operations)

  const checks = [
    ...designSystemChecks(options.designSystemPolicy),
    ...componentEditChecks(options.componentEdit),
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
    ...projectContract.checks,
  ]

  return {
    verdict: pathsInScope
      ? checks.every(check => check.passed) ? 'pass' : 'repair_required'
      : 'blocked',
    checks,
  }
}

function componentEditChecks(componentEdit: ComponentEditContext | undefined): DesignBuildReview['checks'] {
  if (!componentEdit) return []
  const dirtyPrimitivePaths = componentEdit.dirtyOperations
    .map(operation => operation.path)
    .filter(isShadcnPrimitivePath)
  const hasTargetBinding = Boolean(
    componentEdit.target?.path ||
    componentEdit.target?.sourceLocation ||
    componentEdit.binding.preferredOperationPath,
  )
  const hasCompositionTarget = componentEdit.binding.editScope === 'composition' &&
    Boolean(componentEdit.binding.preferredOperationPath)

  return [
    {
      id: 'component-edit-context-bound',
      passed: componentEdit.artifactId.length > 0,
      summary: `Component edit context is bound to artifact ${componentEdit.artifactId}.`,
    },
    {
      id: 'component-edit-source-bound',
      passed: hasTargetBinding,
      summary: 'Component edit target includes source path, source location, or preferred operation path.',
    },
    {
      id: 'component-edit-composition-target',
      passed: hasCompositionTarget,
      summary: componentEdit.binding.preferredOperationPath
        ? `Component edit prefers composition path ${componentEdit.binding.preferredOperationPath}.`
        : 'Component edit must resolve to a composition usage path before editing.',
    },
    {
      id: 'component-edit-primitive-guard',
      passed: dirtyPrimitivePaths.length === 0,
      summary: dirtyPrimitivePaths.length === 0
        ? 'Dirty component edits do not directly modify shadcn primitive source files.'
        : `Dirty component edits touch protected primitive files: ${dirtyPrimitivePaths.join(', ')}.`,
    },
  ]
}

function designSystemChecks(policy: DesignSystemPolicy | undefined): DesignBuildReview['checks'] {
  if (!policy) return []
  const allowedRegistries = policy.uiLibrary.allowedRegistries.map(registry => registry.id).join(', ') || 'none'
  const themePack = new ThemePackRegistry().get(policy.themePack?.id)
  return [
    {
      id: 'design-system-policy-resolved',
      passed: true,
      summary: `DesignSystemPolicy ${policy.id} resolved for ${policy.mode}; allowed registries: ${allowedRegistries}.`,
    },
    {
      id: 'design-system-handwrite-policy',
      passed: policy.uiLibrary.handwritePolicy !== 'allowed',
      summary: `Handwritten UI policy is ${policy.uiLibrary.handwritePolicy}.`,
    },
    {
      id: 'design-system-dependency-closure',
      passed: policy.packagePolicy.requireDependencyClosure,
      summary: 'Design system package policy requires generated projects to declare dependency closure.',
    },
    {
      id: 'theme-pack-resolved',
      passed: Boolean(themePack.id),
      summary: `ThemePack ${themePack.id} resolved: ${themePack.description}`,
    },
    ...themePack.reviewerChecks.map(check => ({
      id: check.id,
      passed: true,
      summary: check.summary,
    })),
  ]
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
