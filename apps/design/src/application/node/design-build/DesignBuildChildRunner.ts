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
import { mergeGeneratedPackageJsonContent } from '@/apps/design/application/common/design-package-json'
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
import type { ComponentRetrievalLedger } from './ComponentRetrievalLedger'
import {
  artifactFromChildOutput,
  evaluateDesignBuildArtifact,
} from './DesignBuildReviewPolicy'

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
  const completedShadcnUsageLookups = new Set<string>()
  const completedShadcnComponentInstalls = new Set<string>()
  let shadcnUsageValidationPassed = false
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
    maxToolIterations: Math.max(2, tools.length + selectedShadcnComponentNames(request.modelInput).length + 5),
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
      if (event.toolName === 'get_shadcn_component_usage') {
        for (const name of componentNamesFromUsageResult(event.output)) {
          completedShadcnUsageLookups.add(name)
        }
      }
      if (
        event.toolName === 'create_shadcn_project' ||
        event.toolName === 'add_shadcn_component' ||
        event.toolName === 'validate_shadcn_component_usage'
      ) {
        toolArtifact = mergeToolArtifact(toolArtifact, artifactFromToolResult(event.output))
      }
      if (event.toolName === 'add_shadcn_component') {
        const installedName = installedComponentNameFromToolResult(event.output)
        if (installedName) completedShadcnComponentInstalls.add(installedName)
      }
      if (event.toolName === 'validate_shadcn_component_usage') {
        shadcnUsageValidationPassed = validationPassed(event.output)
      }
      if (event.toolName === SUBMIT_DESIGN_CHILD_OUTPUT_TOOL_NAME) {
        const submittedOutput = submittedOutputs.get(event.callId)
        const validated = validateStageOutput(submittedOutput, request.stage)
        return finalizeSubmittedStageOutput(
          validated,
          request,
          request.requiredTools ?? [],
          completedWorkflowTools,
          selectedComponentLedger,
          toolArtifact,
          completedShadcnUsageLookups,
          completedShadcnComponentInstalls,
          shadcnUsageValidationPassed,
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
  request: DesignBuildChildRunRequest,
  requiredTools: string[],
  completedWorkflowTools: Set<string>,
  selectedComponentLedger: unknown,
  toolArtifact: DesignBuildArtifact | undefined,
  completedShadcnUsageLookups: Set<string>,
  completedShadcnComponentInstalls: Set<string>,
  shadcnUsageValidationPassed: boolean,
): unknown {
  const missing = requiredTools.filter(toolName => !completedWorkflowTools.has(toolName))
  if (missing.length > 0) {
    throw new ModelChildOutputContractError(
      `${request.stage} did not complete required function-call tools: ${missing.join(', ')}.`,
    )
  }
  if (request.stage === 'code-artifact') {
    const missingUsage = missingSelectedShadcnUsageLookups(request.modelInput, completedShadcnUsageLookups)
    if (missingUsage.length > 0) {
      throw new ModelChildOutputContractError(
        `${request.stage} did not fetch usage docs for every selected shadcn component: ${missingUsage.join(', ')}.`,
      )
    }
    const missingInstalls = missingSelectedShadcnInstalls(request.modelInput, completedShadcnComponentInstalls)
    if (missingInstalls.length > 0) {
      throw new ModelChildOutputContractError(
        `${request.stage} did not install every selected shadcn component: ${missingInstalls.join(', ')}.`,
      )
    }
    if (selectedShadcnComponentNames(request.modelInput).length > 0 && !shadcnUsageValidationPassed) {
      throw new ModelChildOutputContractError(
        `${request.stage} did not pass validate_shadcn_component_usage before submitting final output.`,
      )
    }
    const mergedOutput = mergeSubmittedOutputWithToolArtifact(output, toolArtifact)
    assertFinalSelectedShadcnUsage(mergedOutput, request)
    return mergedOutput
  }
  if (request.stage !== 'component-retrieval') return output
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
      ? 'For code-artifact, you must call get_shadcn_component_usage for every selected shadcn component, then create_shadcn_project, then add_shadcn_component once for each selected component, then validate_shadcn_component_usage with the candidate artifact that includes src/App.tsx, before submitting final output. Wait for each tool result and use the returned usage docs to write the composition source.'
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
      return [
        'For code-artifact, return {"artifact": <DesignBuildArtifact>} when producing source. The main composition source, usually src/App.tsx, must import and render each selected shadcn component from componentLedger.selected using the usage docs returned to this worker. The artifact should include the composition source update, not only installed primitive files. Return the input summary object only if no source changes are possible.',
        revisionCodeArtifactInstruction(request),
      ].filter(Boolean).join('\n')
    case 'review':
      return 'For review, return {"review": {"verdict": "pass" | "repair_required" | "blocked", "checks": [{"id": string, "passed": boolean, "summary": string}]}}.'
  }
}

function revisionCodeArtifactInstruction(request: DesignBuildChildRunRequest): string {
  if (!hasRevisionContext(request.modelInput)) return ''
  return [
    'Revision contract:',
    '- This run is a follow-up revision of the existing design-patch artifact.',
    '- Treat the prompt as an incremental change request, not as a new page topic.',
    '- Preserve the existing project root and operations from input.artifact; update only files needed for the requested change.',
    '- For dependency-only requests such as package.json or npm package changes, update the existing package.json operation and leave UI source files unchanged unless the prompt explicitly asks to use the dependency.',
  ].join('\n')
}

function hasRevisionContext(modelInput: unknown): boolean {
  if (!isRecord(modelInput)) return false
  const context = isRecord(modelInput.context) ? modelInput.context : undefined
  if (context && isRecord(context.revision)) return true
  const artifact = isRecord(modelInput.artifact) ? modelInput.artifact : undefined
  return typeof artifact?.parentArtifactId === 'string'
}

function standaloneProjectInstruction(stage: DesignBuildChildStage): string {
  if (stage !== 'code-artifact') return ''
  return [
    'Standalone app contract:',
    '- Produce a complete Sandpacker/Vite React project as a design-patch artifact.',
    '- Include package.json, index.html, src/index.tsx or src/main.tsx, renderable React component files, and CSS files needed by the UI.',
    '- Keep the entry file and component files consistent: if src/index.tsx imports "./ProfilePage", include src/ProfilePage.tsx; if the only component file is src/App.tsx, import "./App".',
    '- Declare every external runtime library imported by source in package.json dependencies; declare build-only packages in devDependencies.',
    '- Use package.json as the dependency source of truth. Do not rely on Telegraph workspace dependencies.',
    '- Do not import from Telegraph monorepo aliases such as "@/packages/..." or "@telegraph/...". Implement local UI primitives or use npm packages declared in package.json.',
    '- For shadcn primitives selected by the component scout, do not handwrite src/components/ui/*; call add_shadcn_component so the tool installs source and records provenance.',
    '- For every selected shadcn component, import it from its local "@/components/ui/<name>" module in composition source and render it in JSX; installing source files without using them is invalid.',
    '- Keep files under the safe generated project root shown in the input artifact paths, for example apps/design/src/generated/<slug>/package.json; do not target the repository root package.json.',
    '- index.html must use a sandbox-relative module script such as ./src/index.tsx?entry or ./src/main.tsx?entry.',
    '- index.html must load Tailwind Play CDN in the head with <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>; use <style type="text/tailwindcss"> for custom Tailwind theme CSS when needed.',
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

function componentNamesFromUsageResult(output: unknown): string[] {
  if (!isRecord(output) || !Array.isArray(output.components)) return []
  return output.components.flatMap(component => {
    if (!isRecord(component)) return []
    const name = stringField(component, 'name')
    return name ? [normalizeComponentName(name)] : []
  })
}

function installedComponentNameFromToolResult(output: unknown): string | undefined {
  if (!isRecord(output)) return undefined
  if (output.available === false) return undefined
  const component = isRecord(output.component) ? output.component : undefined
  const installation = isRecord(output.installation) ? output.installation : undefined
  return normalizeComponentName(stringField(component, 'name') ?? stringField(installation, 'name') ?? '')
}

function validationPassed(output: unknown): boolean {
  return isRecord(output) && output.passed === true
}

function assertFinalSelectedShadcnUsage(
  output: unknown,
  request: DesignBuildChildRunRequest,
): void {
  const ledger = componentLedgerFromModelInput(request.modelInput)
  if (!ledger || selectedShadcnComponentNames(request.modelInput).length === 0) return

  const artifact = artifactFromChildOutput(output)
  if (!artifact) {
    throw new ModelChildOutputContractError(
      `${request.stage} final output did not include a design artifact after shadcn tool merge.`,
    )
  }
  if (artifact.kind !== 'design-patch') {
    throw new ModelChildOutputContractError(
      `${request.stage} final output must be a design-patch artifact when shadcn components are selected.`,
    )
  }

  const review = evaluateDesignBuildArtifact(artifact, { componentLedger: ledger })
  const failed = review.checks.filter(check =>
    check.id.startsWith('selected-shadcn-components-') && !check.passed
  )
  if (failed.length > 0) {
    throw new ModelChildOutputContractError(
      `${request.stage} final artifact did not use every selected shadcn component after merge: ${
        failed.map(check => check.summary).join(' ')
      }`,
    )
  }
}

function missingSelectedShadcnUsageLookups(
  modelInput: unknown,
  completedUsageLookups: Set<string>,
): string[] {
  return selectedShadcnComponentNames(modelInput)
    .filter(name => !completedUsageLookups.has(name))
}

function missingSelectedShadcnInstalls(
  modelInput: unknown,
  completedInstalls: Set<string>,
): string[] {
  return selectedShadcnComponentNames(modelInput)
    .filter(name => !completedInstalls.has(name))
}

function selectedShadcnComponentNames(modelInput: unknown): string[] {
  const ledger = componentLedgerFromModelInput(modelInput)
  if (!ledger) return []
  return ledger.selected
    .flatMap(component => {
      if (!isRecord(component) || component.registry !== '@shadcn' || component.type !== 'registry:ui') return []
      return [normalizeComponentName(component.name)]
    })
    .filter(name => name.length > 0)
}

function componentLedgerFromModelInput(modelInput: unknown): ComponentRetrievalLedger | undefined {
  return isRecord(modelInput) && isComponentRetrievalLedger(modelInput.componentLedger)
    ? modelInput.componentLedger
    : undefined
}

function mergeSubmittedOutputWithToolArtifact(
  output: unknown,
  toolArtifact: DesignBuildArtifact | undefined,
): unknown {
  if (!toolArtifact || !isRecord(output)) return output
  const submittedArtifact = isDesignBuildArtifact(output.artifact) ? output.artifact : undefined
  return {
    ...output,
    artifact: submittedArtifact ? mergeToolArtifact(toolArtifact, submittedArtifact) : toolArtifact,
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
  if (second.kind === 'delete' || !second.path.endsWith('/package.json')) return second
  if (!first) {
    return {
      ...second,
      content: mergeGeneratedPackageJsonContent(undefined, second.content) ?? second.content,
    }
  }
  if (!first.content || !second.content) return second
  return {
    ...second,
    kind: first.kind === 'add' ? 'add' : second.kind,
    content: mergeGeneratedPackageJsonContent(first.content, second.content) ?? second.content,
  }
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

function stringField(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const field = value?.[key]
  return typeof field === 'string' && field.trim().length > 0 ? field.trim() : undefined
}

function normalizeComponentName(name: string): string {
  return name
    .trim()
    .replace(/\.(tsx|jsx|ts|js)$/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
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
    case 'code-artifact': {
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
      return '{"artifactId": string, "kind": string, "title": string} or {"artifact": DesignBuildArtifact}; for source generation, DesignBuildArtifact should be a design-patch whose operations describe a standalone Vite React app with package.json-driven dependencies.'
    case 'review':
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
      return {
        anyOf: [
          objectSchema({
            artifactId: { type: 'string' },
            kind: { type: 'string' },
            title: { type: 'string' },
            parentArtifactId: { type: 'string' },
            revision: { type: 'number' },
            operationCount: { type: 'number' },
          }, ['artifactId', 'kind', 'title']),
          objectSchema({
            artifact: artifactSchema(),
          }, ['artifact']),
        ],
      }
    case 'review':
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
