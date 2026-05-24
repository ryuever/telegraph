import type {
  RuntimeEvent,
  RuntimeSettings,
} from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
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
import {
  isDesignBuildArtifact,
  type DesignBuildArtifact,
  type DesignPatchArtifact,
} from './DesignBuildArtifacts'

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
  tools?: PiAiExecutableTool[]
  requiredTools?: string[]
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
      if (!(error instanceof ModelChildOutputContractError)) throw error
      if (contractAttempt >= 2) throw error
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
  const tools = [...(request.tools ?? []), submitTool]
  const submittedOutputs = new Map<string, unknown>()
  const completedWorkflowTools = new Set<string>()
  let selectedComponentLedger: unknown
  let toolArtifact: DesignBuildArtifact | undefined

  request.emitEvent?.(workflowToolsAttachedLog(request, tools))

  for await (const event of streamPiAiRuntimeEvents({
    runId: request.childRunId,
    settings,
    message: createChildUserPrompt(request, contractAttempt, previousError),
    systemPrompt: createChildSystemPrompt(request),
    signal: request.signal,
    tools,
    maxToolIterations: Math.max(2, tools.length + 3),
  })) {
    request.emitEvent?.(event)
    if (event.type === 'tool_call' && event.toolName === SUBMIT_DESIGN_CHILD_OUTPUT_TOOL_NAME) {
      submittedOutputs.set(event.callId, extractSubmittedOutput(event.input))
      continue
    }
    if (event.type === 'tool_result') {
      if (event.toolName !== SUBMIT_DESIGN_CHILD_OUTPUT_TOOL_NAME) {
        completedWorkflowTools.add(event.toolName)
      }
      if (event.toolName === 'select_shadcn_components') {
        selectedComponentLedger = ledgerFromToolResult(event.output)
      }
      if (event.toolName === 'create_shadcn_project' || event.toolName === 'add_shadcn_component') {
        toolArtifact = mergeToolArtifact(toolArtifact, artifactFromToolResult(event.output))
      }
      if (event.toolName === SUBMIT_DESIGN_CHILD_OUTPUT_TOOL_NAME) {
        const submittedOutput = submittedOutputs.get(event.callId)
        const validated = validateStageOutput(submittedOutput, request.stage)
        return finalizeSubmittedStageOutput(
          validated,
          request.stage,
          request.requiredTools ?? [],
          completedWorkflowTools,
          selectedComponentLedger,
          toolArtifact,
        )
      }
    }
    if (event.type === 'run_failed') {
      throw new Error(runtimeFailureMessage(event))
    }
  }

  throw new ModelChildOutputContractError(
    `Design build child "${request.label}" did not call ${SUBMIT_DESIGN_CHILD_OUTPUT_TOOL_NAME}.`,
  )
}

function workflowToolsAttachedLog(
  request: DesignBuildChildRunRequest,
  tools: PiAiExecutableTool[],
): RuntimeEvent {
  const workflowTools = tools
    .map(tool => tool.name)
    .filter(name => name !== SUBMIT_DESIGN_CHILD_OUTPUT_TOOL_NAME)
  return {
    type: 'runtime_log',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: 'telegraph-design-build@0.1.0',
    origin: {
      framework: 'telegraph',
      runtimeId: TELEGRAPH_DESIGN_BUILD_RUNTIME_ID,
    },
    runId: request.childRunId,
    level: workflowTools.length > 0 ? 'info' : 'debug',
    message: workflowTools.length > 0
      ? `Workflow tools attached for ${request.stage}: ${workflowTools.join(', ')}`
      : `No workflow tools attached for ${request.stage}.`,
    raw: {
      stage: request.stage,
      profileId: request.profileId,
      tools: workflowTools,
    },
    ts: Date.now(),
  }
}

function finalizeSubmittedStageOutput(
  output: unknown,
  stage: DesignBuildChildStage,
  requiredTools: string[],
  completedWorkflowTools: Set<string>,
  selectedComponentLedger: unknown,
  toolArtifact: DesignBuildArtifact | undefined,
): unknown {
  const missing = requiredTools.filter(toolName => !completedWorkflowTools.has(toolName))
  if (missing.length > 0) {
    throw new ModelChildOutputContractError(
      `${stage} did not complete required function-call tools: ${missing.join(', ')}.`,
    )
  }
  if (stage === 'code-artifact' || stage === 'repair') {
    return mergeSubmittedOutputWithToolArtifact(output, toolArtifact)
  }
  if (stage !== 'component-retrieval') return output
  if (!isComponentRetrievalLedger(selectedComponentLedger)) {
    throw new ModelChildOutputContractError(
      'component-retrieval did not receive a valid ledger from select_shadcn_components.',
    )
  }
  if (!isRecord(output)) {
    throw new ModelChildOutputContractError('component-retrieval output must be an object.')
  }
  return {
    ...output,
    components: selectedComponentLedger.selected,
    ledger: selectedComponentLedger,
  }
}

function createChildSystemPrompt(request: DesignBuildChildRunRequest): string {
  return [
    'You are a Telegraph design page generation child agent.',
    formatProfilePrompt(request.profile),
    formatProfileSkillPrompt(request.profile),
    formatToolWorkflowPrompt(request),
    `You must call the ${SUBMIT_DESIGN_CHILD_OUTPUT_TOOL_NAME} tool exactly once. Do not answer with text.`,
    'Put the final stage result in the tool argument field named "output".',
    'Use the provided input as the source of truth.',
    `Stage output contract: ${stageContractDescription(request.stage)}`,
    standaloneProjectInstruction(request.stage),
    stageInstruction(request),
  ].filter(Boolean).join('\n')
}

function formatToolWorkflowPrompt(request: DesignBuildChildRunRequest): string {
  const toolNames = request.tools?.map(tool => tool.name).filter(name => name !== SUBMIT_DESIGN_CHILD_OUTPUT_TOOL_NAME) ?? []
  const requiredTools = request.requiredTools ?? []
  if (toolNames.length === 0) return ''
  return [
    `Available function-call tools: ${toolNames.join(', ')}.`,
    requiredTools.length > 0
      ? `Required function-call tools for this stage: ${requiredTools.join(', ')}. Call all of them and wait for their tool results before submitting final output.`
      : 'Use the function-call tools when they are relevant to the stage before submitting final output.',
    request.stage === 'component-retrieval'
      ? 'For component-retrieval, you must call get_shadcn_project_llms, get_shadcn_component_usage, and select_shadcn_components; include the ledger returned by select_shadcn_components in the final submitted output.'
      : undefined,
    request.stage === 'code-artifact'
      ? 'For code-artifact, you must call create_shadcn_project, then call add_shadcn_component once for each selected shadcn component before submitting final output. The final artifact may be a summary; tool-created artifact operations will be merged into the child output.'
      : undefined,
    request.stage === 'repair'
      ? 'For repair, use create_shadcn_project or add_shadcn_component when failed checks indicate missing shadcn project files or missing local component source.'
      : undefined,
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
      return 'For component-retrieval, return {"query": string, "components": [...], "summary": string, "ledger": ComponentRetrievalLedger}; ledger must be the object returned by select_shadcn_components.'
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
    '- For shadcn primitives selected by the component scout, do not handwrite src/components/ui/*; call add_shadcn_component so the tool installs source and records provenance.',
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

function ledgerFromToolResult(output: unknown): unknown {
  if (!isRecord(output)) return undefined
  return output.ledger
}

function artifactFromToolResult(output: unknown): DesignBuildArtifact | undefined {
  if (!isRecord(output)) return undefined
  return isDesignBuildArtifact(output.artifact) ? output.artifact : undefined
}

function mergeSubmittedOutputWithToolArtifact(
  output: unknown,
  toolArtifact: DesignBuildArtifact | undefined,
): unknown {
  if (!toolArtifact || !isRecord(output)) return output
  const submittedArtifact = isDesignBuildArtifact(output.artifact) ? output.artifact : undefined
  return {
    ...output,
    artifact: submittedArtifact ? mergeToolArtifact(submittedArtifact, toolArtifact) : toolArtifact,
  }
}

function mergeToolArtifact(
  base: DesignBuildArtifact | undefined,
  next: DesignBuildArtifact | undefined,
): DesignBuildArtifact | undefined {
  if (!base) return next
  if (!next) return base
  if (base.kind !== 'design-patch' || next.kind !== 'design-patch') return next

  const operationsByPath = new Map(base.operations.map(operation => [operation.path, operation]))
  for (const operation of next.operations) {
    operationsByPath.set(operation.path, mergeOperationsByPath(operationsByPath.get(operation.path), operation))
  }
  const merged: DesignPatchArtifact = {
    ...base,
    metadata: mergeArtifactMetadata(base.metadata, next.metadata),
    operations: [...operationsByPath.values()],
  }
  return merged
}

function mergeOperationsByPath(
  first: DesignPatchArtifact['operations'][number] | undefined,
  second: DesignPatchArtifact['operations'][number],
): DesignPatchArtifact['operations'][number] {
  if (!first) return second
  if (!first.content || !second.content || !second.path.endsWith('/package.json')) return second
  const firstJson = parseRecord(first.content)
  const secondJson = parseRecord(second.content)
  if (!firstJson || !secondJson) return second
  return {
    ...second,
    kind: first.kind === 'add' && second.kind !== 'delete' ? 'add' : second.kind,
    content: JSON.stringify({
      ...firstJson,
      ...secondJson,
      dependencies: {
        ...recordField(firstJson, 'dependencies'),
        ...recordField(secondJson, 'dependencies'),
      },
      devDependencies: {
        ...recordField(firstJson, 'devDependencies'),
        ...recordField(secondJson, 'devDependencies'),
      },
    }, null, 2),
  }
}

function parseRecord(content: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(content) as unknown
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

function recordField(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const field = value[key]
  return isRecord(field) ? field : {}
}

function mergeArtifactMetadata(
  first: Record<string, unknown> | undefined,
  second: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return {
    ...first,
    ...second,
    shadcnToolInstallations: [
      ...arrayField(first, 'shadcnToolInstallations'),
      ...arrayField(second, 'shadcnToolInstallations'),
    ],
  }
}

function arrayField(value: Record<string, unknown> | undefined, key: string): unknown[] {
  const field = value?.[key]
  return Array.isArray(field) ? field : []
}

function isComponentRetrievalLedger(value: unknown): value is {
  selected: unknown[]
} {
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
      if (!isRecord(output.ledger)) {
        throw new ModelChildOutputContractError('component-retrieval output requires a ledger object from select_shadcn_components.')
      }
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
      return '{"query": string, "components": unknown[], "summary": string, "ledger": ComponentRetrievalLedger}'
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
        ledger: { type: 'object' },
      }, ['query', 'components', 'summary', 'ledger'])
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
            metadata: { type: 'object' },
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
