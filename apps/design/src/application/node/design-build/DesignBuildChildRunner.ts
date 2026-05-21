import type { RuntimeEvent, RuntimeSettings } from '@/packages/agent-protocol'
import {
  streamPiAiRuntimeEvents,
  type PiAiExecutableTool,
} from '@/packages/agent/runtime/streamPiAiRuntime'
import type { AgentRuntimeSettings } from '@/packages/agent/types'
import { TELEGRAPH_DESIGN_BUILD_RUNTIME_ID } from '@/apps/design/application/common/design-build'
import type {
  DesignBuildChildProfileId,
  DesignBuildChildStage,
} from './DesignBuildChildContracts'
import { isDesignBuildArtifact } from './DesignBuildArtifacts'

export interface DesignBuildChildRunRequest {
  parentRunId: string
  childRunId: string
  profileId: DesignBuildChildProfileId
  stage: DesignBuildChildStage
  label: string
  input: unknown
  modelInput?: unknown
  settings?: RuntimeSettings
  metadata?: Record<string, unknown>
  signal?: AbortSignal
  attempt?: number
}

export interface DesignBuildChildRunResult {
  output: unknown
  source: 'model-backed'
}

export interface DesignBuildChildRunner {
  runChild(request: DesignBuildChildRunRequest): Promise<DesignBuildChildRunResult>
}

export class ModelBackedDesignBuildChildRunner implements DesignBuildChildRunner {
  async runChild(request: DesignBuildChildRunRequest): Promise<DesignBuildChildRunResult> {
    const settings = toAgentRuntimeSettings(request.settings)
    if (!settings) {
      throw new Error('Design build model settings are required: provider, modelId, and apiKey must be configured.')
    }

    return {
      output: await runModelChild(request, settings),
      source: 'model-backed',
    }
  }
}

class ModelChildOutputContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelChildOutputContractError'
  }
}

async function runModelChild(
  request: DesignBuildChildRunRequest,
  settings: AgentRuntimeSettings,
): Promise<unknown> {
  let lastContractError: ModelChildOutputContractError | undefined
  for (let contractAttempt = 1; contractAttempt <= 2; contractAttempt += 1) {
    try {
      return await runModelChildAttempt(request, settings, contractAttempt, lastContractError)
    } catch (error) {
      if (!(error instanceof ModelChildOutputContractError) || contractAttempt >= 2) throw error
      lastContractError = error
    }
  }

  throw lastContractError ?? new ModelChildOutputContractError(
    `Design build child "${request.label}" did not produce a valid structured output.`,
  )
}

async function runModelChildAttempt(
  request: DesignBuildChildRunRequest,
  settings: AgentRuntimeSettings,
  contractAttempt: number,
  previousError?: ModelChildOutputContractError,
): Promise<unknown> {
  const submitTool = createSubmitDesignChildOutputTool(request.stage)

  for await (const event of streamPiAiRuntimeEvents({
    runId: request.childRunId,
    settings,
    message: createChildUserPrompt(request, contractAttempt, previousError),
    systemPrompt: createChildSystemPrompt(request),
    signal: request.signal,
    tools: [submitTool],
    maxToolIterations: 1,
  })) {
    if (event.type === 'tool_call' && event.toolName === SUBMIT_DESIGN_CHILD_OUTPUT_TOOL_NAME) {
      return validateStageOutput(extractSubmittedOutput(event.input), request.stage)
    }
    if (event.type === 'run_failed') {
      throw new Error(runtimeFailureMessage(event))
    }
  }

  throw new ModelChildOutputContractError(
    `Design build child "${request.label}" did not call ${SUBMIT_DESIGN_CHILD_OUTPUT_TOOL_NAME}.`,
  )
}

function createChildSystemPrompt(request: DesignBuildChildRunRequest): string {
  return [
    'You are a Telegraph design page generation child agent.',
    `You must call the ${SUBMIT_DESIGN_CHILD_OUTPUT_TOOL_NAME} tool exactly once. Do not answer with text.`,
    'Put the final stage result in the tool argument field named "output".',
    'If you cannot improve the provided input, submit an output object with the same shape as the input.',
    'Use the provided input as the source of truth. Keep imports using "@/..." monorepo-root aliases when source code appears.',
    `Stage output contract: ${stageContractDescription(request.stage)}`,
    stageInstruction(request),
  ].join('\n')
}

function stageInstruction(request: DesignBuildChildRunRequest): string {
  switch (request.stage) {
    case 'intent-brief':
      return 'For intent-brief, return {"brief": {...}} with summary and acceptanceCriteria if present.'
    case 'component-retrieval':
      return 'For component-retrieval, return {"query": string, "components": [...], "summary": string}.'
    case 'code-artifact':
      return 'For code-artifact, return either the input summary object or {"artifact": <DesignBuildArtifact>} when producing replacement source.'
    case 'review':
      return 'For review, return {"review": {"verdict": "pass" | "repair_required" | "blocked", "checks": [{"id": string, "passed": boolean, "summary": string}]}}.'
    case 'repair':
      return 'For repair, return either the repaired input summary object or {"artifact": <DesignBuildArtifact>} when producing a repaired patch.'
    case 'review-repair':
      return 'For review-repair, return {"review": {"verdict": "pass" | "repair_required" | "blocked", "checks": [{"id": string, "passed": boolean, "summary": string}]}}.'
  }
}

function createChildUserPrompt(
  request: DesignBuildChildRunRequest,
  contractAttempt: number,
  previousError?: ModelChildOutputContractError,
): string {
  return JSON.stringify({
    parentRunId: request.parentRunId,
    childRunId: request.childRunId,
    profileId: request.profileId,
    stage: request.stage,
    label: request.label,
    attempt: request.attempt,
    contractAttempt,
    previousContractError: previousError
      ? {
          message: previousError.message,
          instruction: `Call ${SUBMIT_DESIGN_CHILD_OUTPUT_TOOL_NAME} again with an output object that satisfies the stage output contract.`,
        }
      : undefined,
    input: request.modelInput ?? request.input,
  }, null, 2)
}

function toAgentRuntimeSettings(settings: RuntimeSettings | undefined): AgentRuntimeSettings | undefined {
  if (!settings?.provider || !settings.modelId || !settings.apiKey) return undefined
  return {
    provider: settings.provider,
    modelId: settings.modelId,
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    backend: settings.backend === TELEGRAPH_DESIGN_BUILD_RUNTIME_ID
      ? 'pi-ai'
      : settings.backend as AgentRuntimeSettings['backend'],
    orchestration: settings.orchestration as AgentRuntimeSettings['orchestration'],
    orchestrationPattern: settings.orchestrationPattern as AgentRuntimeSettings['orchestrationPattern'],
    worktreeIsolation: settings.worktreeIsolation,
    extensionBlocklist: settings.extensionBlocklist,
    taskCapabilityProfile: settings.taskCapabilityProfile,
  }
}

function runtimeFailureMessage(event: RuntimeEvent): string {
  if (event.type !== 'run_failed') return 'Model child run failed.'
  return event.error.message || event.error.code || 'Model child run failed.'
}

const SUBMIT_DESIGN_CHILD_OUTPUT_TOOL_NAME = 'submit_design_child_output'

function createSubmitDesignChildOutputTool(stage: DesignBuildChildStage): PiAiExecutableTool {
  return {
    name: SUBMIT_DESIGN_CHILD_OUTPUT_TOOL_NAME,
    description: 'Submit the final structured output for the current Telegraph design-build child stage.',
    parameters: {
      type: 'object',
      properties: {
        output: stageOutputSchema(stage),
      },
      required: ['output'],
      additionalProperties: false,
    } as PiAiExecutableTool['parameters'],
    execute: async input => ({ accepted: Boolean(input.output) }),
  }
}

function extractSubmittedOutput(input: unknown): unknown {
  if (!isRecord(input)) {
    throw new ModelChildOutputContractError('Design build child submitted non-object tool input.')
  }
  return input.output
}

function validateStageOutput(output: unknown, stage: DesignBuildChildStage): unknown {
  if (!isRecord(output)) {
    throw new ModelChildOutputContractError('Design build child output must be an object.')
  }

  switch (stage) {
    case 'intent-brief':
      assertBriefOutput(output, 'intent-brief output requires a brief object with a summary string.')
      return output
    case 'component-retrieval':
      assertStringField(output, 'query', 'component-retrieval output requires a query string.')
      assertArrayField(output, 'components', 'component-retrieval output requires a components array.')
      assertStringField(output, 'summary', 'component-retrieval output requires a summary string.')
      return output
    case 'code-artifact':
    case 'repair': {
      const artifact = output.artifact
      if (artifact !== undefined && !isDesignBuildArtifact(artifact)) {
        throw new ModelChildOutputContractError(`${stage} output contains an invalid artifact.`)
      }
      if (artifact === undefined) {
        assertStringField(output, 'artifactId', `${stage} summary output requires an artifactId string.`)
        assertStringField(output, 'kind', `${stage} summary output requires a kind string.`)
        assertStringField(output, 'title', `${stage} summary output requires a title string.`)
      }
      return output
    }
    case 'review':
    case 'review-repair':
      assertReviewOutput(output, `${stage} output requires a valid review object.`)
      return output
  }
}

function assertBriefOutput(output: Record<string, unknown>, message: string): void {
  const brief = output.brief
  if (!isRecord(brief)) throw new ModelChildOutputContractError(message)
  assertStringField(brief, 'summary', message)
  const acceptanceCriteria = brief.acceptanceCriteria
  if (acceptanceCriteria !== undefined && !Array.isArray(acceptanceCriteria)) {
    throw new ModelChildOutputContractError(message)
  }
}

function assertReviewOutput(output: Record<string, unknown>, message: string): void {
  const review = output.review
  if (!isRecord(review)) throw new ModelChildOutputContractError(message)
  const verdict = review.verdict
  if (verdict !== 'pass' && verdict !== 'repair_required' && verdict !== 'blocked') {
    throw new ModelChildOutputContractError(message)
  }
  const checks = review.checks
  if (!Array.isArray(checks)) throw new ModelChildOutputContractError(message)
  for (const check of checks) {
    if (!isRecord(check) ||
      typeof check.id !== 'string' ||
      typeof check.passed !== 'boolean' ||
      typeof check.summary !== 'string') {
      throw new ModelChildOutputContractError(message)
    }
  }
}

function assertRecordField(value: Record<string, unknown>, key: string, message: string): void {
  if (!isRecord(value[key])) throw new ModelChildOutputContractError(message)
}

function assertStringField(value: Record<string, unknown>, key: string, message: string): void {
  if (typeof value[key] !== 'string') throw new ModelChildOutputContractError(message)
}

function assertArrayField(value: Record<string, unknown>, key: string, message: string): void {
  if (!Array.isArray(value[key])) throw new ModelChildOutputContractError(message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stageContractDescription(stage: DesignBuildChildStage): string {
  switch (stage) {
    case 'intent-brief':
      return '{"brief": {"summary": string, "acceptanceCriteria"?: string[]}}'
    case 'component-retrieval':
      return '{"query": string, "components": unknown[], "summary": string}'
    case 'code-artifact':
    case 'repair':
      return '{"artifactId": string, "kind": string, "title": string} or {"artifact": DesignBuildArtifact}; DesignBuildArtifact is either design-preview {id, kind, title, html, prompt} or design-patch {id, kind, title, operations[]}.'
    case 'review':
    case 'review-repair':
      return '{"review": {"verdict": "pass" | "repair_required" | "blocked", "checks": [{"id": string, "passed": boolean, "summary": string}]}}'
  }
}

function stageOutputSchema(stage: DesignBuildChildStage): Record<string, unknown> {
  switch (stage) {
    case 'intent-brief':
      return objectSchema({
        brief: objectSchema({
          summary: { type: 'string' },
          acceptanceCriteria: { type: 'array', items: { type: 'string' } },
        }, ['summary']),
      }, ['brief'])
    case 'component-retrieval':
      return objectSchema({
        query: { type: 'string' },
        components: { type: 'array', items: {} },
        summary: { type: 'string' },
      }, ['query', 'components', 'summary'])
    case 'code-artifact':
    case 'repair':
      return {
        anyOf: [
          objectSchema({
            artifactId: { type: 'string' },
            kind: { type: 'string' },
            title: { type: 'string' },
            parentArtifactId: { type: 'string' },
            revision: { type: 'number' },
            operationCount: { type: 'number' },
            repairAttempt: { type: 'number' },
          }, ['artifactId', 'kind', 'title']),
          objectSchema({
            artifact: artifactSchema(),
          }, ['artifact']),
        ],
      }
    case 'review':
    case 'review-repair':
      return objectSchema({
        review: reviewSchema(),
      }, ['review'])
  }
}

function artifactSchema(): Record<string, unknown> {
  return {
    anyOf: [
      objectSchema({
        id: { type: 'string' },
        kind: { const: 'design-preview' },
        title: { type: 'string' },
        html: { type: 'string' },
        prompt: { type: 'string' },
      }, ['id', 'kind', 'title', 'html', 'prompt']),
      objectSchema({
        id: { type: 'string' },
        kind: { const: 'design-patch' },
        title: { type: 'string' },
        parentArtifactId: { type: 'string' },
        revision: { type: 'number' },
        changeSummary: { type: 'string' },
        operations: {
          type: 'array',
          items: objectSchema({
            path: { type: 'string' },
            kind: { enum: ['add', 'update', 'delete'] },
            content: { type: 'string' },
            expectedOriginal: { type: 'string' },
          }, ['path', 'kind']),
        },
      }, ['id', 'kind', 'title', 'operations']),
    ],
  }
}

function reviewSchema(): Record<string, unknown> {
  return objectSchema({
    verdict: { enum: ['pass', 'repair_required', 'blocked'] },
    checks: {
      type: 'array',
      items: objectSchema({
        id: { type: 'string' },
        passed: { type: 'boolean' },
        summary: { type: 'string' },
      }, ['id', 'passed', 'summary']),
    },
  }, ['verdict', 'checks'])
}

function objectSchema(
  properties: Record<string, unknown>,
  required: string[],
): Record<string, unknown> {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  }
}
