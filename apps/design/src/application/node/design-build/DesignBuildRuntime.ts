import type { AgentEvent, RuntimeOrigin } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { BaseAgentRuntime, type RuntimeInput } from '@/packages/agent/runtime/AgentRuntime'
import { TELEGRAPH_DESIGN_BUILD_RUNTIME_ID } from '@/apps/design/application/common/design-build'
import {
  isDesignBuildArtifact,
  type DesignBuildArtifact,
} from './DesignBuildArtifacts'
import {
  DesignBuildRuntimeError,
  repairDesignBuildArtifact,
  runDesignBuildOrchestrator,
  reviewDesignBuildArtifact,
  type DesignBuildReview,
  type DesignBuildFailureCode,
} from './DesignBuildOrchestrator'
import {
  DESIGN_BUILD_CHILD_PROFILES,
  childRunRaw,
} from './DesignBuildChildContracts'
import {
  ModelBackedDesignBuildChildRunner,
  type DesignBuildChildRunner,
} from './DesignBuildChildRunner'
import { assertValidDesignBuildOutput } from './DesignBuildValidation'

export const TELEGRAPH_DESIGN_BUILD_PRODUCER_VERSION = 'telegraph-design-build@0.1.0'

const SV = RUNTIME_CONTRACT_SCHEMA_VERSION
const PV = TELEGRAPH_DESIGN_BUILD_PRODUCER_VERSION
const ORIGIN: RuntimeOrigin = {
  framework: 'telegraph',
  runtimeId: TELEGRAPH_DESIGN_BUILD_RUNTIME_ID,
}
export class DesignBuildRuntime extends BaseAgentRuntime {
  readonly id = TELEGRAPH_DESIGN_BUILD_RUNTIME_ID
  readonly label = 'Telegraph Design Build'
  private readonly childRunner: DesignBuildChildRunner

  constructor(options: { childRunner?: DesignBuildChildRunner } = {}) {
    super()
    this.childRunner = options.childRunner ?? new ModelBackedDesignBuildChildRunner()
  }

  async *run(input: RuntimeInput): AsyncIterable<AgentEvent> {
    yield runStarted(input.runId)

    if (input.signal?.aborted) {
      yield runCancelled(input.runId)
      return
    }

    try {
      const briefStepId = `${input.runId}:brief`
      const plannerRunId = childRunId(input.runId, DESIGN_BUILD_CHILD_PROFILES.planner)
      yield stepStarted(input.runId, briefStepId, 'Intent Brief')
      yield childRunStarted(
        input.runId,
        plannerRunId,
        'Design Product Planner',
        childRunRaw(DESIGN_BUILD_CHILD_PROFILES.planner, 'intent-brief'),
      )
      await abortableCheckpoint(input.signal)
      if (input.signal?.aborted) {
        yield runCancelled(input.runId)
        return
      }

      const result = assertValidDesignBuildOutput(runDesignBuildOrchestrator({
        runId: input.runId,
        prompt: input.message,
        metadata: input.metadata,
      }))
      const childRuns: Array<{ childRunId: string; profileId: string; output: unknown }> = []
      const brief = result.brief
      const plannerOutput = await this.runChild({
        parentRunId: input.runId,
        childRunId: plannerRunId,
        profileId: DESIGN_BUILD_CHILD_PROFILES.planner,
        stage: 'intent-brief',
        label: 'Design Product Planner',
        input: { brief },
        modelInput: {
          prompt: input.message,
          brief,
        },
        settings: input.settings,
        metadata: input.metadata,
        signal: input.signal,
      })
      yield childRunCompleted(
        input.runId,
        plannerRunId,
        plannerOutput,
        childRunRaw(DESIGN_BUILD_CHILD_PROFILES.planner, 'intent-brief'),
      )
      childRuns.push({
        childRunId: plannerRunId,
        profileId: DESIGN_BUILD_CHILD_PROFILES.planner,
        output: plannerOutput,
      })
      yield stepCompleted(input.runId, briefStepId, brief)

      const contextStepId = `${input.runId}:context`
      yield stepStarted(input.runId, contextStepId, 'Context Assembly')
      await abortableCheckpoint(input.signal)
      if (input.signal?.aborted) {
        yield runCancelled(input.runId)
        return
      }
      yield stepCompleted(input.runId, contextStepId, result.context)

      const retrievalStepId = `${input.runId}:component-retrieval`
      const scoutRunId = childRunId(input.runId, DESIGN_BUILD_CHILD_PROFILES.scout)
      yield stepStarted(input.runId, retrievalStepId, 'Component Retrieval')
      yield childRunStarted(
        input.runId,
        scoutRunId,
        'Design Component Scout',
        childRunRaw(DESIGN_BUILD_CHILD_PROFILES.scout, 'component-retrieval'),
      )
      await abortableCheckpoint(input.signal)
      if (input.signal?.aborted) {
        yield runCancelled(input.runId)
        return
      }
      const retrievalOutput = await this.runChild({
        parentRunId: input.runId,
        childRunId: scoutRunId,
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
      })
      yield childRunCompleted(
        input.runId,
        scoutRunId,
        retrievalOutput,
        childRunRaw(DESIGN_BUILD_CHILD_PROFILES.scout, 'component-retrieval'),
      )
      childRuns.push({
        childRunId: scoutRunId,
        profileId: DESIGN_BUILD_CHILD_PROFILES.scout,
        output: retrievalOutput,
      })
      yield stepCompleted(input.runId, retrievalStepId, {
        query: input.message,
        components: result.components,
      })

      const planStepId = `${input.runId}:page-plan`
      yield stepStarted(input.runId, planStepId, 'Page Plan')
      await abortableCheckpoint(input.signal)
      if (input.signal?.aborted) {
        yield runCancelled(input.runId)
        return
      }
      yield stepCompleted(input.runId, planStepId, result.plan)

      const artifactStepId = `${input.runId}:artifact`
      const workerRunId = childRunId(input.runId, DESIGN_BUILD_CHILD_PROFILES.worker)
      yield stepStarted(input.runId, artifactStepId, 'Code Artifact')
      yield childRunStarted(
        input.runId,
        workerRunId,
        'Design Worker',
        childRunRaw(DESIGN_BUILD_CHILD_PROFILES.worker, 'code-artifact'),
      )
      await abortableCheckpoint(input.signal)
      if (input.signal?.aborted) {
        yield runCancelled(input.runId)
        return
      }

      let artifact = result.artifact
      let artifactSummary = createArtifactSummary(artifact)
      const workerOutput = await this.runChild({
        parentRunId: input.runId,
        childRunId: workerRunId,
        profileId: DESIGN_BUILD_CHILD_PROFILES.worker,
        stage: 'code-artifact',
        label: 'Design Worker',
        input: artifactSummary,
        modelInput: {
          prompt: input.message,
          brief,
          context: result.context,
          components: result.components,
          plan: result.plan,
          artifact,
        },
        settings: input.settings,
        metadata: input.metadata,
        signal: input.signal,
      })
      artifact = artifactFromChildOutput(workerOutput) ?? artifact
      artifactSummary = createArtifactSummary(artifact)
      yield childRunCompleted(
        input.runId,
        workerRunId,
        workerOutput,
        childRunRaw(DESIGN_BUILD_CHILD_PROFILES.worker, 'code-artifact'),
      )
      childRuns.push({
        childRunId: workerRunId,
        profileId: DESIGN_BUILD_CHILD_PROFILES.worker,
        output: workerOutput,
      })
      yield stepCompleted(input.runId, artifactStepId, artifactSummary)

      const reviewStepId = `${input.runId}:review`
      const reviewerRunId = childRunId(input.runId, DESIGN_BUILD_CHILD_PROFILES.reviewer)
      yield stepStarted(input.runId, reviewStepId, 'Review')
      yield childRunStarted(
        input.runId,
        reviewerRunId,
        'Design Reviewer',
        childRunRaw(DESIGN_BUILD_CHILD_PROFILES.reviewer, 'review'),
      )
      await abortableCheckpoint(input.signal)
      if (input.signal?.aborted) {
        yield runCancelled(input.runId)
        return
      }
      let review = result.review
      const reviewOutput = await this.runChild({
        parentRunId: input.runId,
        childRunId: reviewerRunId,
        profileId: DESIGN_BUILD_CHILD_PROFILES.reviewer,
        stage: 'review',
        label: 'Design Reviewer',
        input: { review },
        modelInput: {
          artifact,
          review,
          aliasRule: result.context.aliasRule,
        },
        settings: input.settings,
        metadata: input.metadata,
        signal: input.signal,
      })
      review = reviewFromChildOutput(reviewOutput) ?? review
      yield childRunCompleted(
        input.runId,
        reviewerRunId,
        reviewOutput,
        childRunRaw(DESIGN_BUILD_CHILD_PROFILES.reviewer, 'review'),
      )
      childRuns.push({
        childRunId: reviewerRunId,
        profileId: DESIGN_BUILD_CHILD_PROFILES.reviewer,
        output: reviewOutput,
      })
      yield stepCompleted(input.runId, reviewStepId, review)

      if (review.verdict === 'repair_required') {
        const repairStepId = `${input.runId}:repair`
        const repairWorkerRunId = `${childRunId(input.runId, DESIGN_BUILD_CHILD_PROFILES.worker)}:repair-1`
        yield stepStarted(input.runId, repairStepId, 'Repair')
        yield childRunStarted(
          input.runId,
          repairWorkerRunId,
          'Design Worker Repair',
          childRunRaw(DESIGN_BUILD_CHILD_PROFILES.worker, 'repair', { attempt: 1 }),
        )
        await abortableCheckpoint(input.signal)
        if (input.signal?.aborted) {
          yield runCancelled(input.runId)
          return
        }
        artifact = repairDesignBuildArtifact(artifact, review)
        artifactSummary = {
          ...createArtifactSummary(artifact),
          repairAttempt: 1,
        }
        const repairOutput = await this.runChild({
          parentRunId: input.runId,
          childRunId: repairWorkerRunId,
          profileId: DESIGN_BUILD_CHILD_PROFILES.worker,
          stage: 'repair',
          label: 'Design Worker Repair',
          input: artifactSummary,
          modelInput: {
            prompt: input.message,
            brief,
            context: result.context,
            components: result.components,
            plan: result.plan,
            artifact,
            review,
            repairAttempt: 1,
          },
          settings: input.settings,
          metadata: input.metadata,
          signal: input.signal,
          attempt: 1,
        })
        artifact = artifactFromChildOutput(repairOutput) ?? artifact
        artifactSummary = {
          ...createArtifactSummary(artifact),
          repairAttempt: 1,
        }
        yield childRunCompleted(
          input.runId,
          repairWorkerRunId,
          repairOutput,
          childRunRaw(DESIGN_BUILD_CHILD_PROFILES.worker, 'repair', { attempt: 1 }),
        )
        childRuns.push({
          childRunId: repairWorkerRunId,
          profileId: DESIGN_BUILD_CHILD_PROFILES.worker,
          output: repairOutput,
        })
        yield stepCompleted(input.runId, repairStepId, artifactSummary)

        const repairReviewStepId = `${input.runId}:review-repair`
        const repairReviewerRunId = `${childRunId(input.runId, DESIGN_BUILD_CHILD_PROFILES.reviewer)}:repair-1`
        yield stepStarted(input.runId, repairReviewStepId, 'Review Repair')
        yield childRunStarted(
          input.runId,
          repairReviewerRunId,
          'Design Reviewer Repair Check',
          childRunRaw(DESIGN_BUILD_CHILD_PROFILES.reviewer, 'review-repair', { attempt: 1 }),
        )
        await abortableCheckpoint(input.signal)
        if (input.signal?.aborted) {
          yield runCancelled(input.runId)
          return
        }
        review = reviewDesignBuildArtifact(artifact)
        const repairReviewOutput = await this.runChild({
          parentRunId: input.runId,
          childRunId: repairReviewerRunId,
          profileId: DESIGN_BUILD_CHILD_PROFILES.reviewer,
          stage: 'review-repair',
          label: 'Design Reviewer Repair Check',
          input: { review, repairAttempt: 1 },
          modelInput: {
            artifact,
            review,
            aliasRule: result.context.aliasRule,
            repairAttempt: 1,
          },
          settings: input.settings,
          metadata: input.metadata,
          signal: input.signal,
          attempt: 1,
        })
        review = reviewFromChildOutput(repairReviewOutput) ?? review
        yield childRunCompleted(
          input.runId,
          repairReviewerRunId,
          repairReviewOutput,
          childRunRaw(DESIGN_BUILD_CHILD_PROFILES.reviewer, 'review-repair', { attempt: 1 }),
        )
        childRuns.push({
          childRunId: repairReviewerRunId,
          profileId: DESIGN_BUILD_CHILD_PROFILES.reviewer,
          output: repairReviewOutput,
        })
        yield stepCompleted(input.runId, repairReviewStepId, repairReviewOutput)
      }

      if (review.verdict !== 'pass') {
        yield runFailed(input.runId, 'review_failed', 'Design artifact review did not pass.', review)
        return
      }

      const requestId = this.generateRequestId(input.runId)
      yield {
        type: 'assistant_delta',
        schemaVersion: SV,
        producerVersion: PV,
        origin: ORIGIN,
        runId: input.runId,
        requestId,
        text: `已生成「${artifact.title}」预览。`,
        raw: { artifactId: artifact.id, kind: artifact.kind },
        ts: this.now(),
      }

      yield {
        type: 'run_completed',
        schemaVersion: SV,
        producerVersion: PV,
        origin: ORIGIN,
        runId: input.runId,
        output: {
          artifact,
          orchestration: {
            childRuns,
          },
        },
        ts: this.now(),
      }
    } catch (error) {
      const normalized = normalizeDesignBuildError(error)
      yield runFailed(input.runId, normalized.code, normalized.message, normalized.details)
    }
  }

  private async runChild(input: Parameters<DesignBuildChildRunner['runChild']>[0]): Promise<unknown> {
    const result = await this.childRunner.runChild(input)
    return result.output
  }
}

function childRunId(parentRunId: string, profileId: string): string {
  return `${parentRunId}:${profileId}`
}

function createArtifactSummary(artifact: { id: string; kind: string; title: string; operations?: unknown[]; parentArtifactId?: string; revision?: number }): Record<string, unknown> {
  return {
    artifactId: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    parentArtifactId: artifact.kind === 'design-patch' ? artifact.parentArtifactId : undefined,
    revision: artifact.kind === 'design-patch' ? artifact.revision : undefined,
    operationCount: artifact.kind === 'design-patch' ? artifact.operations?.length : undefined,
  }
}

function artifactFromChildOutput(output: unknown): DesignBuildArtifact | undefined {
  const artifact = recordField(output, 'artifact')
  return isDesignBuildArtifact(artifact) ? artifact : undefined
}

function reviewFromChildOutput(output: unknown): DesignBuildReview | undefined {
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

function recordField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return field && typeof field === 'object' && !Array.isArray(field)
    ? field as Record<string, unknown>
    : undefined
}

function runStarted(runId: string): AgentEvent {
  return {
    type: 'run_started',
    schemaVersion: SV,
    producerVersion: PV,
    origin: ORIGIN,
    runId,
    pattern: 'prompt_chain',
    ts: Date.now(),
  }
}

function runCancelled(runId: string): AgentEvent {
  return {
    type: 'run_cancelled',
    schemaVersion: SV,
    producerVersion: PV,
    origin: ORIGIN,
    runId,
    reason: 'Cancelled',
    ts: Date.now(),
  }
}

function runFailed(runId: string, code: DesignBuildFailureCode, message: string, details?: unknown): AgentEvent {
  return {
    type: 'run_failed',
    schemaVersion: SV,
    producerVersion: PV,
    origin: ORIGIN,
    runId,
    error: {
      code,
      message,
      details,
    },
    ts: Date.now(),
  }
}

function childRunStarted(
  parentRunId: string,
  childRunId: string,
  label: string,
  raw?: unknown,
): AgentEvent {
  return {
    type: 'child_run_started',
    schemaVersion: SV,
    producerVersion: PV,
    origin: ORIGIN,
    parentRunId,
    childRunId,
    label,
    raw,
    ts: Date.now(),
  }
}

function childRunCompleted(
  parentRunId: string,
  childRunId: string,
  output: unknown,
  raw?: unknown,
): AgentEvent {
  return {
    type: 'child_run_completed',
    schemaVersion: SV,
    producerVersion: PV,
    origin: ORIGIN,
    parentRunId,
    childRunId,
    output,
    raw,
    ts: Date.now(),
  }
}

function stepStarted(runId: string, stepId: string, label: string): AgentEvent {
  return {
    type: 'step_started',
    schemaVersion: SV,
    producerVersion: PV,
    origin: ORIGIN,
    runId,
    stepId,
    label,
    kind: 'worker',
    ts: Date.now(),
  }
}

function stepCompleted(runId: string, stepId: string, output: unknown): AgentEvent {
  return {
    type: 'step_completed',
    schemaVersion: SV,
    producerVersion: PV,
    origin: ORIGIN,
    runId,
    stepId,
    output,
    ts: Date.now(),
  }
}

async function abortableCheckpoint(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 10)
  })
}

function normalizeDesignBuildError(error: unknown): {
  code: DesignBuildFailureCode
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
