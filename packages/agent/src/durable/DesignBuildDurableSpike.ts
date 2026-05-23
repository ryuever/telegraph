import {
  type AgentEvent,
} from '@/packages/agent-protocol'
import {
  createDurableStepContext,
  type DurableRunEngine,
  type DurableStepDefinition,
} from './DurableRunEngine'

export type DesignBuildDurableStepId =
  | 'design-build:plan'
  | 'design-build:generate-artifact'
  | 'design-build:apply-patch'

export interface DesignBuildDurableSpikeInput {
  runId: string
  prompt: string
  artifactId: string
  signal?: AbortSignal
}

export interface DesignBuildDurableSpikePlan {
  summary: string
  files: string[]
}

export interface DesignBuildDurableSpikeArtifact {
  artifactId: string
  contentRef: string
}

export interface DesignBuildDurableSpikePatch {
  artifactId: string
  patchRef: string
  applied: boolean
}

export interface DesignBuildDurableSpikeOutput {
  plan: DesignBuildDurableSpikePlan
  artifact: DesignBuildDurableSpikeArtifact
  patch: DesignBuildDurableSpikePatch
  events: AgentEvent[]
  reusedStepIds: DesignBuildDurableStepId[]
}

export interface DesignBuildDurableSpikeExecutors {
  plan(input: DesignBuildDurableSpikeInput): Promise<DesignBuildDurableSpikePlan>
  generateArtifact(
    input: DesignBuildDurableSpikeInput,
    plan: DesignBuildDurableSpikePlan,
  ): Promise<DesignBuildDurableSpikeArtifact>
  applyPatch(
    input: DesignBuildDurableSpikeInput,
    artifact: DesignBuildDurableSpikeArtifact,
  ): Promise<DesignBuildDurableSpikePatch>
}

export class DesignBuildDurableSpike {
  constructor(
    private readonly engine: DurableRunEngine,
    private readonly executors: DesignBuildDurableSpikeExecutors,
  ) {}

  async run(input: DesignBuildDurableSpikeInput): Promise<DesignBuildDurableSpikeOutput> {
    const events: AgentEvent[] = []
    const reusedStepIds: DesignBuildDurableStepId[] = []

    const planResult = await this.engine.executeStep<DesignBuildDurableSpikePlan>(
      createDesignBuildStepContext(input, {
        stepId: 'design-build:plan',
        label: 'Plan design build',
        kind: 'llm_call',
        callId: 'plan',
        input: {
          prompt: input.prompt,
          artifactId: input.artifactId,
        },
      }),
      () => this.executors.plan(input),
    )
    events.push(...planResult.events)
    if (planResult.reused) reusedStepIds.push('design-build:plan')

    const artifactResult = await this.engine.executeStep<DesignBuildDurableSpikeArtifact>(
      createDesignBuildStepContext(input, {
        stepId: 'design-build:generate-artifact',
        label: 'Generate design artifact',
        kind: 'tool_call',
        callId: 'generate-artifact',
        input: {
          artifactId: input.artifactId,
          plan: requireCompletedStepOutput(planResult.record.output, 'design-build:plan'),
        },
      }),
      () => this.executors.generateArtifact(input, requireCompletedStepOutput(planResult.record.output, 'design-build:plan')),
    )
    events.push(...artifactResult.events)
    if (artifactResult.reused) reusedStepIds.push('design-build:generate-artifact')
    const artifactOutput = requireCompletedStepOutput(
      artifactResult.record.output,
      'design-build:generate-artifact',
    )

    const patchResult = await this.engine.executeStep<DesignBuildDurableSpikePatch>(
      createDesignBuildStepContext(input, {
        stepId: 'design-build:apply-patch',
        label: 'Apply design artifact patch',
        kind: 'artifact_patch',
        callId: 'apply-patch',
        input: {
          artifactId: input.artifactId,
          contentRef: artifactOutput.contentRef,
        },
      }),
      () => this.executors.applyPatch(input, artifactOutput),
    )
    events.push(...patchResult.events)
    if (patchResult.reused) reusedStepIds.push('design-build:apply-patch')

    return {
      plan: requireCompletedStepOutput(planResult.record.output, 'design-build:plan'),
      artifact: artifactOutput,
      patch: requireCompletedStepOutput(patchResult.record.output, 'design-build:apply-patch'),
      events,
      reusedStepIds,
    }
  }
}

function createDesignBuildStepContext(
  input: DesignBuildDurableSpikeInput,
  step: DurableStepDefinition,
) {
  return createDurableStepContext({
    runId: input.runId,
    step,
    signal: input.signal,
  })
}

function requireCompletedStepOutput<Output>(output: Output | undefined, stepId: DesignBuildDurableStepId): Output {
  if (output === undefined) {
    throw new Error(`Durable design-build step "${stepId}" completed without output.`)
  }
  return output
}
