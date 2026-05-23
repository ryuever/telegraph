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
}

export interface DesignBuildWorkflowRunOptions {
  assistantRequestId: string
}

export class DesignBuildWorkflow {
  private readonly childRunner?: DesignBuildChildRunner
  private readonly profileResolver?: DesignBuildSubagentProfileResolver

  constructor(options: DesignBuildWorkflowOptions = {}) {
    this.childRunner = options.childRunner
    this.profileResolver = options.profileResolver
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
      run: () => this.runChildStage(subagents, {
        parentRunId: input.runId,
        childRunId: childRunId(input.runId, DESIGN_BUILD_CHILD_PROFILES.scout),
        profileId: DESIGN_BUILD_CHILD_PROFILES.scout,
        stage: 'component-retrieval',
        label: 'Design Component Scout',
        input: {
          query: input.message,
          components: result.components,
          summary: `Selected ${String(result.components.length)} component assets for the generated page.`,
        },
        modelInput: {
          prompt: input.message,
          brief,
          context: result.context,
          candidateComponents: result.components,
        },
        settings: input.settings,
        metadata: input.metadata,
        signal: input.signal,
      }, {
        query: input.message,
        components: result.components,
      }),
    })
    if (retrievalStage.cancelled) return

    const planStage = yield* runner.runStep({
      stepId: `${input.runId}:page-plan`,
      label: 'Page Plan',
      completedOutput: value => value,
      run: () => immediateFeatureStage(result.plan),
    })
    if (planStage.cancelled) return

    let artifact = result.artifact
    const artifactStage = yield* runner.runStep({
      stepId: `${input.runId}:artifact`,
      label: 'Code Artifact',
      completedOutput: value => value.summary,
      run: () => this.runArtifactStage(input, subagents, result, artifact),
    })
    if (artifactStage.cancelled) return
    artifact = artifactStage.value.artifact

    const reviewStage = yield* runner.runStep({
      stepId: `${input.runId}:review`,
      label: 'Review',
      completedOutput: value => value,
      run: () => this.runReviewStage(input, subagents, artifact, result.context.sandboxProject),
    })
    if (reviewStage.cancelled) return
    let review = reviewStage.value

    if (review.verdict === 'repair_required') {
      const repairResult = yield* this.runRepairPass({
        input,
        subagents,
        brief,
        context: result.context,
        components: result.components,
        plan: result.plan,
        artifact,
        review,
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
      },
      settings: input.settings,
      metadata: input.metadata,
      signal: input.signal,
    })
    return result
  }

  private async *runChildStage<T>(
    subagents: DesignBuildSubagentGateway,
    request: Parameters<DesignBuildSubagentGateway['runChild']>[0],
    value: T,
  ): AsyncGenerator<AgentEvent, T, void> {
    yield* subagents.runChild(request)
    return value
  }

  private async *runArtifactStage(
    input: RuntimeInput,
    subagents: DesignBuildSubagentGateway,
    result: DesignBuildInitialState,
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
        components: result.components,
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
    sandboxProject: DesignBuildInitialState['context']['sandboxProject'],
  ): AsyncGenerator<AgentEvent, DesignBuildInitialState['review'], void> {
    const policyReview = evaluateDesignBuildArtifact(artifact)
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
        sandboxProject,
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
    plan: unknown
    artifact: DesignBuildInitialState['artifact']
    review: DesignBuildInitialState['review']
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
    const artifact = repairStage.value.artifact

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
    plan: unknown
    artifact: DesignBuildInitialState['artifact']
    review: DesignBuildInitialState['review']
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
        components: input.components,
        plan: input.plan,
        artifact,
        review: input.review,
        repairAttempt: 1,
      },
      settings: runtimeInput.settings,
      metadata: runtimeInput.metadata,
      signal: runtimeInput.signal,
      attempt: 1,
    })
    artifact = artifactFromChildOutput(repairOutput) ?? artifact
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
    const policyReview = evaluateDesignBuildArtifact(artifact)
    const repairReviewOutput = yield* subagents.runChild({
      parentRunId: runtimeInput.runId,
      childRunId: `${childRunId(runtimeInput.runId, DESIGN_BUILD_CHILD_PROFILES.reviewer)}:repair-1`,
      profileId: DESIGN_BUILD_CHILD_PROFILES.reviewer,
      stage: 'review-repair',
      label: 'Design Reviewer Repair Check',
      input: { review: policyReview, repairAttempt: 1 },
      modelInput: {
        artifact,
        review: policyReview,
        sandboxProject: input.context && typeof input.context === 'object' && 'sandboxProject' in input.context
          ? (input.context as { sandboxProject?: unknown }).sandboxProject
          : undefined,
        repairAttempt: 1,
      },
      settings: runtimeInput.settings,
      metadata: runtimeInput.metadata,
      signal: runtimeInput.signal,
      attempt: 1,
    })
    return {
      review: mergeDesignBuildReview(policyReview, reviewFromChildOutput(repairReviewOutput)),
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
