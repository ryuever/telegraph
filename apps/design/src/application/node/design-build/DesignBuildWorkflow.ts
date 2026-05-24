import type { AgentEvent } from '@/packages/agent-protocol'
import type { RuntimeInput } from '@/packages/agent/runtime/AgentRuntime'
import {
  FeatureWorkflowRunner,
  immediateFeatureStage,
} from '@/apps/design/application/node/feature-workflow/FeatureWorkflowRunner'
import {
  createDesignBuildInitialState,
  DesignBuildRuntimeError,
  repairDesignBuildArtifact,
  type DesignBuildInitialState,
} from './DesignBuildInitialState'
import type { DesignPatchArtifact } from './DesignBuildArtifacts'
import {
  DESIGN_BUILD_CHILD_PROFILES,
} from './DesignBuildChildContracts'
import type { DesignBuildChildRunner } from './DesignBuildChildRunner'
import { assertValidDesignBuildOutput } from './DesignBuildValidation'
import {
  artifactFromChildOutput,
  createArtifactSummary,
  evaluateDesignBuildArtifact,
  mergeDesignBuildReview,
  reviewFromChildOutput,
} from './DesignBuildReviewPolicy'
import {
  DesignBuildSubagentGateway,
  type DesignBuildSubagentProfileResolver,
} from './DesignBuildSubagentGateway'
import type { ComponentRetrievalLedger } from './ComponentRetrievalLedger'
import { ShadcnRegistryIndexer } from './ShadcnRegistryIndexer'
import { ShadcnRegistryMaterializer } from './ShadcnRegistryMaterializer'
import {
  reviewFromVisualReport,
  VisualReviewWorker,
  type VisualReviewReport,
} from './VisualReviewWorker'
import {
  assistantArtifactDelta,
  runCancelled,
  runCompleted,
  runFailed,
  stepCompleted,
  stepStarted,
} from './DesignBuildRuntimeEvents'

export interface DesignBuildWorkflowOptions {
  childRunner?: DesignBuildChildRunner
  profileResolver?: DesignBuildSubagentProfileResolver
  shadcnRegistryIndexer?: ShadcnRegistryIndexer
  shadcnRegistryMaterializer?: ShadcnRegistryMaterializer
  visualReviewWorker?: VisualReviewWorker
}

export interface DesignBuildWorkflowRunOptions {
  assistantRequestId: string
}

export class DesignBuildWorkflow {
  private readonly childRunner?: DesignBuildChildRunner
  private readonly profileResolver?: DesignBuildSubagentProfileResolver
  private readonly shadcnRegistryIndexer: ShadcnRegistryIndexer
  private readonly shadcnRegistryMaterializer: ShadcnRegistryMaterializer
  private readonly visualReviewWorker: VisualReviewWorker

  constructor(options: DesignBuildWorkflowOptions = {}) {
    this.childRunner = options.childRunner
    this.profileResolver = options.profileResolver
    this.shadcnRegistryIndexer = options.shadcnRegistryIndexer ?? new ShadcnRegistryIndexer({
      enableCli: process.env.TELEGRAPH_DESIGN_SHADCN_CLI === '1',
    })
    this.shadcnRegistryMaterializer = options.shadcnRegistryMaterializer ?? new ShadcnRegistryMaterializer()
    this.visualReviewWorker = options.visualReviewWorker ?? new VisualReviewWorker()
  }

  async *run(
    input: RuntimeInput,
    options: DesignBuildWorkflowRunOptions,
  ): AsyncIterable<AgentEvent> {
    const subagents = new DesignBuildSubagentGateway({
      childRunner: this.childRunner,
      profileResolver: this.profileResolver,
    })
    const runner = createDesignBuildFeatureRunner(input)

    const initialStage = yield* runner.runStep({
      stepId: `${input.runId}:brief`,
      label: 'Intent Brief',
      completedOutput: value => value.brief,
      run: () => this.runBriefStage(input, subagents),
    })
    if (initialStage.cancelled) return
    const result = initialStage.value
    const brief = result.brief

    const contextStage = yield* runner.runStep({
      stepId: `${input.runId}:context`,
      label: 'Context Assembly',
      completedOutput: value => value,
      run: () => immediateFeatureStage(result.context),
    })
    if (contextStage.cancelled) return

    const retrievalStage = yield* runner.runStep({
      stepId: `${input.runId}:component-retrieval`,
      label: 'Component Retrieval',
      completedOutput: value => value,
      run: () => this.runComponentRetrievalStage(input, subagents, result, brief),
    })
    if (retrievalStage.cancelled) return
    const componentLedger = retrievalStage.value

    const planStage = yield* runner.runStep({
      stepId: `${input.runId}:page-plan`,
      label: 'Page Plan',
      completedOutput: value => value,
      run: () => immediateFeatureStage(result.plan),
    })
    if (planStage.cancelled) return

    let artifact = materializeShadcnArtifact(
      result.artifact,
      componentLedger,
      result.context.designSystem,
      this.shadcnRegistryMaterializer,
    )
    const artifactStage = yield* runner.runStep({
      stepId: `${input.runId}:artifact`,
      label: 'Code Artifact',
      completedOutput: value => value.summary,
      run: () => this.runArtifactStage(input, subagents, result, componentLedger, artifact),
    })
    if (artifactStage.cancelled) return
    artifact = attachComponentRetrievalMetadata(
      materializeShadcnArtifact(
        artifactStage.value.artifact,
        componentLedger,
        result.context.designSystem,
        this.shadcnRegistryMaterializer,
      ),
      componentLedger,
    )

    const reviewStage = yield* runner.runStep({
      stepId: `${input.runId}:review`,
      label: 'Review',
      completedOutput: value => value,
      run: () => this.runReviewStage(input, subagents, artifact, result.context),
    })
    if (reviewStage.cancelled) return
    let review = reviewStage.value
    let visualReview = this.visualReviewWorker.review(artifact)

    const visualReviewStage = yield* runner.runStep({
      stepId: `${input.runId}:visual-review`,
      label: 'Visual Review',
      completedOutput: value => value,
      run: () => immediateFeatureStage(visualReview),
    })
    if (visualReviewStage.cancelled) return
    visualReview = visualReviewStage.value
    artifact = attachVisualReviewMetadata(artifact, visualReview)
    review = mergeDesignBuildReview(review, reviewFromVisualReport(visualReview))

    if (review.verdict === 'repair_required') {
      const repairResult = yield* this.runRepairPass({
        input,
        subagents,
        brief,
        context: result.context,
        components: componentLedger.selected,
        componentLedger,
        plan: result.plan,
        artifact,
        review,
        visualReview,
      })
      if (!repairResult) return
      artifact = repairResult.artifact
      review = repairResult.review
    }

    if (review.verdict !== 'pass') {
      yield runFailed(input.runId, 'review_failed', 'Design artifact review did not pass.', review)
      return
    }

    yield assistantArtifactDelta({
      runId: input.runId,
      requestId: options.assistantRequestId,
      artifact,
    })

    yield runCompleted({
      runId: input.runId,
      artifact,
      childRuns: subagents.listChildRuns(),
    })

  }

  private async *runBriefStage(
    input: RuntimeInput,
    subagents: DesignBuildSubagentGateway,
  ): AsyncGenerator<AgentEvent, DesignBuildInitialState, void> {
    const result = assertValidDesignBuildOutput(createDesignBuildInitialState({
      runId: input.runId,
      prompt: input.message,
      metadata: input.metadata,
    }))
    yield* subagents.runChild({
      parentRunId: input.runId,
      childRunId: childRunId(input.runId, DESIGN_BUILD_CHILD_PROFILES.planner),
      profileId: DESIGN_BUILD_CHILD_PROFILES.planner,
      stage: 'intent-brief',
      label: 'Design Product Planner',
      input: { brief: result.brief },
      modelInput: {
        prompt: input.message,
        brief: result.brief,
        designSystem: result.context.designSystem,
        componentEdit: result.context.revision?.componentEdit,
      },
      settings: input.settings,
      metadata: input.metadata,
      signal: input.signal,
    })
    return result
  }

  private async *runComponentRetrievalStage(
    input: RuntimeInput,
    subagents: DesignBuildSubagentGateway,
    result: DesignBuildInitialState,
    brief: DesignBuildInitialState['brief'],
  ): AsyncGenerator<AgentEvent, ComponentRetrievalLedger, void> {
    const ledger = await this.shadcnRegistryIndexer.retrieve({
      prompt: input.message,
      policy: result.context.designSystem,
    })
    const retrievalOutput = {
      query: input.message,
      components: ledger.selected,
      summary: `Selected ${String(ledger.selected.length)} shadcn registry assets for the generated page.`,
      ledger,
    }
    yield* subagents.runChild({
      parentRunId: input.runId,
      childRunId: childRunId(input.runId, DESIGN_BUILD_CHILD_PROFILES.scout),
      profileId: DESIGN_BUILD_CHILD_PROFILES.scout,
      stage: 'component-retrieval',
      label: 'Design Component Scout',
      input: retrievalOutput,
      modelInput: {
        prompt: input.message,
        brief,
        context: result.context,
        designSystem: result.context.designSystem,
        componentEdit: result.context.revision?.componentEdit,
        componentLedger: ledger,
        candidateComponents: result.components,
      },
      settings: input.settings,
      metadata: input.metadata,
      signal: input.signal,
    })
    return ledger
  }

  private async *runArtifactStage(
    input: RuntimeInput,
    subagents: DesignBuildSubagentGateway,
    result: DesignBuildInitialState,
    componentLedger: ComponentRetrievalLedger,
    artifact: DesignBuildInitialState['artifact'],
  ): AsyncGenerator<AgentEvent, {
    artifact: DesignBuildInitialState['artifact']
    summary: ReturnType<typeof createArtifactSummary>
  }, void> {
    const workerOutput = yield* subagents.runChild({
      parentRunId: input.runId,
      childRunId: childRunId(input.runId, DESIGN_BUILD_CHILD_PROFILES.worker),
      profileId: DESIGN_BUILD_CHILD_PROFILES.worker,
      stage: 'code-artifact',
      label: 'Design Worker',
      input: createArtifactSummary(artifact),
      modelInput: {
        prompt: input.message,
        brief: result.brief,
        context: result.context,
        designSystem: result.context.designSystem,
        componentEdit: result.context.revision?.componentEdit,
        components: componentLedger.selected,
        componentLedger,
        plan: result.plan,
        artifact,
      },
      settings: input.settings,
      metadata: input.metadata,
      signal: input.signal,
    })
    const nextArtifact = artifactFromChildOutput(workerOutput) ?? artifact
    return {
      artifact: nextArtifact,
      summary: createArtifactSummary(nextArtifact),
    }
  }

  private async *runReviewStage(
    input: RuntimeInput,
    subagents: DesignBuildSubagentGateway,
    artifact: DesignBuildInitialState['artifact'],
    context: DesignBuildInitialState['context'],
  ): AsyncGenerator<AgentEvent, DesignBuildInitialState['review'], void> {
    const policyReview = evaluateDesignBuildArtifact(artifact, {
      designSystemPolicy: context.designSystem,
      componentEdit: context.revision?.componentEdit,
    })
    const reviewOutput = yield* subagents.runChild({
      parentRunId: input.runId,
      childRunId: childRunId(input.runId, DESIGN_BUILD_CHILD_PROFILES.reviewer),
      profileId: DESIGN_BUILD_CHILD_PROFILES.reviewer,
      stage: 'review',
      label: 'Design Reviewer',
      input: { review: policyReview },
      modelInput: {
        artifact,
        review: policyReview,
        sandboxProject: context.sandboxProject,
        designSystem: context.designSystem,
        componentEdit: context.revision?.componentEdit,
      },
      settings: input.settings,
      metadata: input.metadata,
      signal: input.signal,
    })
    return mergeDesignBuildReview(policyReview, reviewFromChildOutput(reviewOutput))
  }

  private async *runRepairPass(input: {
    input: RuntimeInput
    subagents: DesignBuildSubagentGateway
    brief: unknown
    context: unknown
    components: unknown
    componentLedger?: unknown
    plan: unknown
    artifact: DesignBuildInitialState['artifact']
    review: DesignBuildInitialState['review']
    visualReview?: VisualReviewReport
  }): AsyncGenerator<AgentEvent, {
    artifact: DesignBuildInitialState['artifact']
    review: DesignBuildInitialState['review']
  } | undefined, void> {
    const { input: runtimeInput } = input
    const runner = createDesignBuildFeatureRunner(runtimeInput)
    const repairStage = yield* runner.runStep({
      stepId: `${runtimeInput.runId}:repair`,
      label: 'Repair',
      completedOutput: value => value.summary,
      run: () => this.runRepairWorkerStage(input),
    })
    if (repairStage.cancelled) return undefined
    const designSystem = contextDesignSystem(input.context)
    const repairedArtifact = input.componentLedger && designSystem
      ? materializeShadcnArtifact(
          repairStage.value.artifact,
          input.componentLedger as ComponentRetrievalLedger,
          designSystem,
          this.shadcnRegistryMaterializer,
        )
      : repairStage.value.artifact
    const artifact = attachComponentRetrievalMetadata(repairedArtifact, input.componentLedger)

    const reviewStage = yield* runner.runStep({
      stepId: `${runtimeInput.runId}:review-repair`,
      label: 'Review Repair',
      completedOutput: value => value.output,
      run: () => this.runRepairReviewStage(input, artifact),
    })
    if (reviewStage.cancelled) return undefined
    return { artifact, review: reviewStage.value.review }
  }

  private async *runRepairWorkerStage(input: {
    input: RuntimeInput
    subagents: DesignBuildSubagentGateway
    brief: unknown
    context: unknown
    components: unknown
    componentLedger?: unknown
    plan: unknown
    artifact: DesignBuildInitialState['artifact']
    review: DesignBuildInitialState['review']
    visualReview?: VisualReviewReport
  }): AsyncGenerator<AgentEvent, {
    artifact: DesignBuildInitialState['artifact']
    summary: ReturnType<typeof createArtifactSummary>
  }, void> {
    const { input: runtimeInput, subagents } = input
    let artifact = repairDesignBuildArtifact(input.artifact, input.review)
    const repairOutput = yield* subagents.runChild({
      parentRunId: runtimeInput.runId,
      childRunId: `${childRunId(runtimeInput.runId, DESIGN_BUILD_CHILD_PROFILES.worker)}:repair-1`,
      profileId: DESIGN_BUILD_CHILD_PROFILES.worker,
      stage: 'repair',
      label: 'Design Worker Repair',
      input: createArtifactSummary(artifact, { repairAttempt: 1 }),
      modelInput: {
        prompt: runtimeInput.message,
        brief: input.brief,
        context: input.context,
        designSystem: contextDesignSystem(input.context),
        componentEdit: contextComponentEdit(input.context),
        components: input.components,
        componentLedger: input.componentLedger,
        plan: input.plan,
        artifact,
        review: input.review,
        visualReview: input.visualReview,
        failedChecks: failedDesignBuildChecks(input.review),
        repairAttempt: 1,
      },
      settings: runtimeInput.settings,
      metadata: runtimeInput.metadata,
      signal: runtimeInput.signal,
      attempt: 1,
    })
    artifact = mergeRepairArtifact(artifact, artifactFromChildOutput(repairOutput) ?? artifact)
    return {
      artifact,
      summary: createArtifactSummary(artifact, { repairAttempt: 1 }),
    }
  }

  private async *runRepairReviewStage(
    input: {
      input: RuntimeInput
      subagents: DesignBuildSubagentGateway
      context: unknown
    },
    artifact: DesignBuildInitialState['artifact'],
  ): AsyncGenerator<AgentEvent, {
    review: DesignBuildInitialState['review']
    output: unknown
  }, void> {
    const { input: runtimeInput, subagents } = input
    const designSystem = contextDesignSystem(input.context)
    const policyReview = evaluateDesignBuildArtifact(artifact, {
      designSystemPolicy: designSystem,
      componentEdit: contextComponentEdit(input.context),
    })
    const visualReview = this.visualReviewWorker.review(artifact)
    const repairReviewOutput = yield* subagents.runChild({
      parentRunId: runtimeInput.runId,
      childRunId: `${childRunId(runtimeInput.runId, DESIGN_BUILD_CHILD_PROFILES.reviewer)}:repair-1`,
      profileId: DESIGN_BUILD_CHILD_PROFILES.reviewer,
      stage: 'review-repair',
      label: 'Design Reviewer Repair Check',
      input: { review: policyReview, repairAttempt: 1 },
      modelInput: {
        artifact,
        review: mergeDesignBuildReview(policyReview, reviewFromVisualReport(visualReview)),
        visualReview,
        sandboxProject: input.context && typeof input.context === 'object' && 'sandboxProject' in input.context
          ? (input.context as { sandboxProject?: unknown }).sandboxProject
          : undefined,
        designSystem,
        componentEdit: contextComponentEdit(input.context),
        repairAttempt: 1,
      },
      settings: runtimeInput.settings,
      metadata: runtimeInput.metadata,
      signal: runtimeInput.signal,
      attempt: 1,
    })
    return {
      review: mergeDesignBuildReview(
        mergeDesignBuildReview(policyReview, reviewFromVisualReport(visualReview)),
        reviewFromChildOutput(repairReviewOutput),
      ),
      output: repairReviewOutput,
    }
  }

}

export function normalizeDesignBuildError(error: unknown): {
  code: 'brief_failed' | 'retrieval_failed' | 'codegen_failed' | 'review_failed' | 'patch_invalid'
  message: string
  details?: unknown
} {
  if (error instanceof DesignBuildRuntimeError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details,
    }
  }
  return {
    code: 'codegen_failed',
    message: error instanceof Error ? error.message : String(error),
    details: error instanceof Error ? { name: error.name, message: error.message } : error,
  }
}

function createDesignBuildFeatureRunner(input: RuntimeInput): FeatureWorkflowRunner<AgentEvent> {
  return new FeatureWorkflowRunner({
    runId: input.runId,
    signal: input.signal,
    stepStarted: (stepId, label) => stepStarted(input.runId, stepId, label),
    stepCompleted: (stepId, output) => stepCompleted(input.runId, stepId, output),
    runCancelled: () => runCancelled(input.runId),
  })
}

function childRunId(parentRunId: string, profileId: string): string {
  return `${parentRunId}:${profileId}`
}

function contextDesignSystem(context: unknown): DesignBuildInitialState['context']['designSystem'] | undefined {
  return context && typeof context === 'object' && 'designSystem' in context
    ? (context as { designSystem?: DesignBuildInitialState['context']['designSystem'] }).designSystem
    : undefined
}

function contextComponentEdit(
  context: unknown,
): NonNullable<DesignBuildInitialState['context']['revision']>['componentEdit'] | undefined {
  if (!context || typeof context !== 'object' || !('revision' in context)) return undefined
  const revision = (context as { revision?: DesignBuildInitialState['context']['revision'] }).revision
  return revision?.componentEdit
}

function attachComponentRetrievalMetadata(
  artifact: DesignBuildInitialState['artifact'],
  componentLedger: unknown,
): DesignBuildInitialState['artifact'] {
  if (artifact.kind !== 'design-patch' || !componentLedger) return artifact
  return {
    ...artifact,
    metadata: {
      ...artifact.metadata,
      componentRetrievalLedger: componentLedger,
    },
  }
}

function attachVisualReviewMetadata(
  artifact: DesignBuildInitialState['artifact'],
  visualReview: VisualReviewReport,
): DesignBuildInitialState['artifact'] {
  if (artifact.kind !== 'design-patch') return artifact
  return {
    ...artifact,
    metadata: {
      ...artifact.metadata,
      visualReview,
    },
  }
}

function failedDesignBuildChecks(review: DesignBuildInitialState['review']): Array<{
  id: string
  summary: string
}> {
  return review.checks
    .filter(check => !check.passed)
    .map(check => ({
      id: check.id,
      summary: check.summary,
    }))
}

function materializeShadcnArtifact(
  artifact: DesignBuildInitialState['artifact'],
  componentLedger: ComponentRetrievalLedger,
  designSystem: DesignBuildInitialState['context']['designSystem'],
  materializer: ShadcnRegistryMaterializer,
): DesignBuildInitialState['artifact'] {
  if (artifact.kind !== 'design-patch') return artifact
  return materializer.materialize({
    artifact,
    ledger: componentLedger,
    policy: designSystem,
  }).artifact
}

function mergeRepairArtifact(
  base: DesignBuildInitialState['artifact'],
  repair: DesignBuildInitialState['artifact'],
): DesignBuildInitialState['artifact'] {
  if (base.kind !== 'design-patch' || repair.kind !== 'design-patch') return repair
  const operationsByPath = new Map(base.operations.map(operation => [operation.path, operation]))
  for (const operation of repair.operations) {
    operationsByPath.set(operation.path, operation)
  }
  const merged: DesignPatchArtifact = {
    ...base,
    ...repair,
    metadata: {
      ...base.metadata,
      ...repair.metadata,
    },
    operations: [...operationsByPath.values()],
  }
  return merged
}
