import type {
  DesignBuildArtifact,
  DesignPatchArtifact,
  DesignPatchOperation,
} from './DesignBuildArtifacts'
import type {
  DesignBuildOrchestratorOutput,
  DesignBuildReview,
} from './DesignBuildOrchestrator'
import { DesignBuildRuntimeError } from './DesignBuildOrchestrator'

export interface DesignBuildValidationResult {
  valid: boolean
  errors: string[]
  repaired?: DesignBuildOrchestratorOutput
}

export function validateDesignBuildOutput(output: DesignBuildOrchestratorOutput): DesignBuildValidationResult {
  const errors = [
    ...validateArtifact(output.artifact),
    ...validateReview(output.review),
  ]
  if (errors.length === 0) return { valid: true, errors }

  const repairedArtifact = repairArtifact(output.artifact)
  if (!repairedArtifact) return { valid: false, errors }

  const repaired: DesignBuildOrchestratorOutput = {
    ...output,
    artifact: repairedArtifact,
  }
  const repairedErrors = [
    ...validateArtifact(repaired.artifact),
    ...validateReview(repaired.review),
  ]
  return repairedErrors.length === 0
    ? { valid: false, errors, repaired }
    : { valid: false, errors: [...errors, ...repairedErrors] }
}

export function assertValidDesignBuildOutput(output: DesignBuildOrchestratorOutput): DesignBuildOrchestratorOutput {
  const result = validateDesignBuildOutput(output)
  if (result.valid) return output
  if (result.repaired) return result.repaired
  throw new DesignBuildRuntimeError('patch_invalid', 'DesignBuild output failed validation.', {
    errors: result.errors,
  })
}

function validateArtifact(artifact: DesignBuildArtifact): string[] {
  if (artifact.kind === 'design-preview') {
    return artifact.html.trim().length > 0 ? [] : ['preview artifact html is empty']
  }

  const errors: string[] = []
  if (artifact.operations.length === 0) errors.push('patch artifact has no operations')
  for (const operation of artifact.operations) {
    errors.push(...validatePatchOperation(operation))
  }
  return errors
}

function validatePatchOperation(operation: DesignPatchOperation): string[] {
  const errors: string[] = []
  if (!operation.path.trim()) errors.push('patch operation path is empty')
  if (operation.path.includes('..')) errors.push(`patch operation path escapes workspace: ${operation.path}`)
  if (operation.kind !== 'delete' && !operation.content?.trim()) {
    errors.push(`patch ${operation.kind} operation has no source content: ${operation.path}`)
  }
  if (operation.content && !operation.content.includes("@/packages/ui/")) {
    errors.push(`patch operation does not use shared UI alias: ${operation.path}`)
  }
  return errors
}

function validateReview(review: DesignBuildReview): string[] {
  const errors: string[] = []
  if (review.checks.length === 0) errors.push('review has no checks')
  return errors
}

function repairArtifact(artifact: DesignBuildArtifact): DesignPatchArtifact | undefined {
  if (artifact.kind !== 'design-patch') return undefined

  const operations = artifact.operations
    .filter(operation => operation.path.trim().length > 0 && !operation.path.includes('..'))
    .map(operation => ({
      ...operation,
      content: operation.content
        ?.replace(/@telegraph\/ui\//g, '@/packages/ui/')
        .replace(/@\/invalid-ui\//g, '@/packages/ui/'),
    }))
    .filter(operation => operation.kind === 'delete' || Boolean(operation.content?.trim()))

  if (operations.length === 0) return undefined
  return {
    ...artifact,
    operations,
  }
}
