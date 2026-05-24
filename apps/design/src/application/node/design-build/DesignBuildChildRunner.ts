import type { RuntimeEvent, RuntimeSettings } from '@/packages/agent-protocol'
import {
  streamPiAiRuntimeEvents,
  type PiAiExecutableTool,
} from '@/packages/agent/runtime/streamPiAiRuntime'
import {
  formatSelectedSkillBodiesForPrompt,
  loadSkills,
  resolveSkillSearchRoot,
} from '@/packages/agent/skills'
import type { AgentRuntimeSettings } from '@/packages/agent/types'
import { TELEGRAPH_DESIGN_BUILD_RUNTIME_ID } from '@/apps/design/application/common/design-build'
import type {
  DesignBuildChildProfile,
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
  profile?: DesignBuildChildProfile
  emitEvent?: (event: RuntimeEvent) => void
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
    request.emitEvent?.(event)
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
    formatProfilePrompt(request.profile),
    formatProfileSkillPrompt(request.profile),
    `You must call the ${SUBMIT_DESIGN_CHILD_OUTPUT_TOOL_NAME} tool exactly once. Do not answer with text.`,
    'Put the final stage result in the tool argument field named "output".',
    'If you cannot improve the provided input, submit an output object with the same shape as the input.',
    'Use the provided input as the source of truth.',
    `Stage output contract: ${stageContractDescription(request.stage)}`,
    standaloneProjectInstruction(request.stage),
    stageInstruction(request),
  ].filter(Boolean).join('\n')
}

function formatProfileSkillPrompt(profile: DesignBuildChildProfile | undefined): string {
  const skillNames = profile?.skills ?? []
  if (skillNames.length === 0) return ''

  const { skills } = loadSkills({
    cwd: resolveSkillSearchRoot(),
  })
  const selectedSkills = formatSelectedSkillBodiesForPrompt(skills, skillNames)
  if (!selectedSkills) return ''

  return [
    'Selected skills for this DesignBuild child are embedded below.',
    'Follow these skill instructions directly; this structured child run does not need to read skill files before submitting output.',
    selectedSkills,
  ].join('\n')
}

function formatProfilePrompt(profile: DesignBuildChildProfile | undefined): string {
  if (!profile?.systemPrompt.trim()) return ''
  return [
    `Subagent profile: ${profile.title ?? profile.id}`,
    profile.description ? `Profile description: ${profile.description}` : undefined,
    profile.systemPrompt.trim(),
  ].filter(Boolean).join('\n')
}

function stageInstruction(request: DesignBuildChildRunRequest): string {
  switch (request.stage) {
    case 'intent-brief':
      return 'For intent-brief, return {"brief": {...}} with summary and acceptanceCriteria if present.'
    case 'component-retrieval':
      return 'For component-retrieval, return {"query": string, "components": [...], "summary": string}.'
    case 'code-artifact':
      return 'For code-artifact, return {"artifact": <DesignBuildArtifact>} when producing source. Return the input summary object only if no source changes are possible.'
    case 'review':
      return 'For review, return {"review": {"verdict": "pass" | "repair_required" | "blocked", "checks": [{"id": string, "passed": boolean, "summary": string}]}}.'
    case 'repair':
      return 'For repair, return {"artifact": <DesignBuildArtifact>} when producing a repaired patch. Return the input summary object only if no source changes are possible.'
    case 'review-repair':
      return 'For review-repair, return {"review": {"verdict": "pass" | "repair_required" | "blocked", "checks": [{"id": string, "passed": boolean, "summary": string}]}}.'
  }
}

function standaloneProjectInstruction(stage: DesignBuildChildStage): string {
  if (stage !== 'code-artifact' && stage !== 'repair') return ''
  return [
    'Standalone app contract:',
    '- Produce a complete Sandpacker/Vite React project as a design-patch artifact.',
    '- Include package.json, index.html, src/index.tsx or src/main.tsx, renderable React component files, and CSS files needed by the UI.',
    '- Keep the entry file and component files consistent: if src/index.tsx imports "./ProfilePage", include src/ProfilePage.tsx; if the only component file is src/App.tsx, import "./App".',
    '- Declare every external runtime library imported by source in package.json dependencies; declare build-only packages in devDependencies.',
    '- Use package.json as the dependency source of truth. Do not rely on Telegraph workspace dependencies.',
    '- Do not import from Telegraph monorepo aliases such as "@/packages/..." or "@telegraph/...". Implement local UI primitives or use npm packages declared in package.json.',
    '- Keep files under the safe generated project root shown in the input artifact paths, for example apps/design/src/generated/<slug>/package.json; do not target the repository root package.json.',
    '- index.html must use a sandbox-relative module script such as ./src/index.tsx?entry or ./src/main.tsx?entry.',
  ].join('\n')
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
    },
    execute: input => Promise.resolve({ accepted: Boolean(input.output) }),
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
      return '{"artifactId": string, "kind": string, "title": string} or {"artifact": DesignBuildArtifact}; for source generation, DesignBuildArtifact should be a design-patch whose operations describe a standalone Vite React app with package.json-driven dependencies.'
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
