import type { AgentEvent } from '@/packages/agent-protocol'
import type { RuntimeInput } from '@/packages/agent/runtime/AgentRuntime'
import {
  FeatureWorkflowRunner,
  immediateFeatureStage,
} from '@/apps/design/application/node/feature-workflow/FeatureWorkflowRunner'
import {
  createDesignBuildInitialState,
  DesignBuildRuntimeError,
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
import {
  createDesignBuildShadcnTools,
  createDesignBuildShadcnProjectTools,
  SHADCN_COMPONENT_RETRIEVAL_TOOL_NAMES,
  SHADCN_PROJECT_TOOL_NAMES,
} from './DesignBuildShadcnTools'
import { ShadcnRegistryMaterializer } from './ShadcnRegistryMaterializer'
import {
  VisualReviewWorker,
  type VisualReviewReport,
} from './VisualReviewWorker'
import {
  assistantArtifactDelta,
  runCancelled,
  runCompleted,
  stepCompleted,
  stepStarted,
} from './DesignBuildRuntimeEvents'

export interface DesignBuildWorkflowOptions {
  childRunner?: DesignBuildChildRunner
  profileResolver?: DesignBuildSubagentProfileResolver
  shadcnRegistryMaterializer?: ShadcnRegistryMaterializer
  visualReviewWorker?: VisualReviewWorker
}

export interface DesignBuildWorkflowRunOptions {
  assistantRequestId: string
}

export class DesignBuildWorkflow {
  private readonly childRunner?: DesignBuildChildRunner
  private readonly profileResolver?: DesignBuildSubagentProfileResolver
  private readonly shadcnRegistryMaterializer: ShadcnRegistryMaterializer
  private readonly visualReviewWorker: VisualReviewWorker

  constructor(options: DesignBuildWorkflowOptions = {}) {
    this.childRunner = options.childRunner
    this.profileResolver = options.profileResolver
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
    const tools = createDesignBuildShadcnTools({
      prompt: input.message,
      policy: result.context.designSystem,
    })
    const retrievalOutput = yield* subagents.runChild({
      parentRunId: input.runId,
      childRunId: childRunId(input.runId, DESIGN_BUILD_CHILD_PROFILES.scout),
      profileId: DESIGN_BUILD_CHILD_PROFILES.scout,
      stage: 'component-retrieval',
      label: 'Design Component Scout',
      input: {
        query: input.message,
        components: [],
        summary: 'Use shadcn tools to retrieve, inspect, and select registry assets for this page.',
      },
      modelInput: {
        prompt: input.message,
        brief,
        context: result.context,
        designSystem: result.context.designSystem,
        componentEdit: result.context.revision?.componentEdit,
        candidateComponents: result.components,
        requiredToolWorkflow: [
          ...SHADCN_COMPONENT_RETRIEVAL_TOOL_NAMES,
          'submit_design_child_output',
        ],
      },
      settings: input.settings,
      metadata: input.metadata,
      signal: input.signal,
      tools,
      requiredTools: [...SHADCN_COMPONENT_RETRIEVAL_TOOL_NAMES],
    })
    const ledger = componentLedgerFromChildOutput(retrievalOutput)
    if (!ledger) {
      throw new DesignBuildRuntimeError(
        'retrieval_failed',
        'Design component scout did not submit a valid shadcn component retrieval ledger.',
        retrievalOutput,
      )
    }
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
    const projectTools = artifact.kind === 'design-patch'
      ? createDesignBuildShadcnProjectTools({
          prompt: input.message,
          policy: result.context.designSystem,
          artifact,
          ledger: componentLedger,
          materializer: this.shadcnRegistryMaterializer,
        })
      : undefined
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
      tools: projectTools,
      requiredTools: projectTools
        ? componentLedger.selected.length > 0 ? [...SHADCN_PROJECT_TOOL_NAMES] : ['create_shadcn_project']
        : undefined,
    })
    const nextArtifact = mergePatchArtifact(artifact, artifactFromChildOutput(workerOutput) ?? artifact)
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

function componentLedgerFromChildOutput(output: unknown): ComponentRetrievalLedger | undefined {
  if (!isRecord(output)) return undefined
  const ledger = output.ledger
  if (!isComponentRetrievalLedger(ledger)) return undefined
  return ledger
}

function isComponentRetrievalLedger(value: unknown): value is ComponentRetrievalLedger {
  if (!isRecord(value)) return false
  return isRecord(value.query) &&
    isRecord(value.policy) &&
    isRecord(value.trust) &&
    isRecord(value.retrieval) &&
    Array.isArray(value.candidates) &&
    Array.isArray(value.selected) &&
    Array.isArray(value.fallbacks) &&
    Array.isArray(value.rejected)
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

function mergePatchArtifact(
  base: DesignBuildInitialState['artifact'],
  nextArtifact: DesignBuildInitialState['artifact'],
): DesignBuildInitialState['artifact'] {
  if (base.kind !== 'design-patch' || nextArtifact.kind !== 'design-patch') return nextArtifact
  const operationsByPath = new Map(base.operations.map(operation => [operation.path, operation]))
  for (const operation of nextArtifact.operations) {
    operationsByPath.set(operation.path, operation)
  }
  const merged: DesignPatchArtifact = {
    ...base,
    ...nextArtifact,
    metadata: {
      ...base.metadata,
      ...nextArtifact.metadata,
    },
    operations: [...operationsByPath.values()],
  }
  return merged
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
