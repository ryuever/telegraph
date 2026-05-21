import type { RuntimeEvent, RuntimeSettings } from '@/packages/agent-protocol'
import { streamPiAiRuntimeEvents } from '@/packages/agent/runtime/streamPiAiRuntime'
import type { AgentRuntimeSettings } from '@/packages/agent/types'
import { TELEGRAPH_DESIGN_BUILD_RUNTIME_ID } from '@/apps/design/application/common/design-build'
import type {
  DesignBuildChildProfileId,
  DesignBuildChildStage,
} from './DesignBuildChildContracts'

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
  source: 'deterministic' | 'model-backed'
}

export interface DesignBuildChildRunner {
  runChild(request: DesignBuildChildRunRequest): Promise<DesignBuildChildRunResult>
}

export class DeterministicDesignBuildChildRunner implements DesignBuildChildRunner {
  runChild(request: DesignBuildChildRunRequest): Promise<DesignBuildChildRunResult> {
    return Promise.resolve({
      output: request.input,
      source: 'deterministic',
    })
  }
}

export class ModelBackedDesignBuildChildRunner implements DesignBuildChildRunner {
  private readonly fallback = new DeterministicDesignBuildChildRunner()

  async runChild(request: DesignBuildChildRunRequest): Promise<DesignBuildChildRunResult> {
    const output = modelChildOutput(request.metadata, request.profileId, request.stage)
    if (output !== undefined) {
      return {
        output,
        source: 'model-backed',
      }
    }

    const settings = toAgentRuntimeSettings(request.settings)
    if (!settings) {
      return this.fallback.runChild(request)
    }

    return {
      output: await runModelChild(request, settings),
      source: 'model-backed',
    }
  }
}

async function runModelChild(
  request: DesignBuildChildRunRequest,
  settings: AgentRuntimeSettings,
): Promise<unknown> {
  let completedOutput: unknown
  let assistantText = ''

  for await (const event of streamPiAiRuntimeEvents({
    runId: request.childRunId,
    settings,
    message: createChildUserPrompt(request),
    systemPrompt: createChildSystemPrompt(request),
    signal: request.signal,
    maxToolIterations: 0,
  })) {
    if (event.type === 'assistant_delta') {
      assistantText += event.text
    } else if (event.type === 'run_completed') {
      completedOutput = event.output
    } else if (event.type === 'run_failed') {
      throw new Error(runtimeFailureMessage(event))
    }
  }

  const text = textFromModelOutput(completedOutput) ?? assistantText
  return parseJsonObject(text)
}

function createChildSystemPrompt(request: DesignBuildChildRunRequest): string {
  return [
    'You are a Telegraph design page generation child agent.',
    'Return only one valid JSON object. Do not include markdown fences, commentary, or extra text.',
    'Use the provided input as the source of truth. Keep imports using "@/..." monorepo-root aliases when source code appears.',
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

function createChildUserPrompt(request: DesignBuildChildRunRequest): string {
  return JSON.stringify({
    parentRunId: request.parentRunId,
    childRunId: request.childRunId,
    profileId: request.profileId,
    stage: request.stage,
    label: request.label,
    attempt: request.attempt,
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

function textFromModelOutput(output: unknown): string | undefined {
  if (typeof output === 'string') return output
  if (!output || typeof output !== 'object') return undefined
  const content = (output as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') {
          const text = (part as { text?: unknown; content?: unknown }).text ??
            (part as { text?: unknown; content?: unknown }).content
          return typeof text === 'string' ? text : ''
        }
        return ''
      })
      .join('')
  }
  return undefined
}

function parseJsonObject(text: string): unknown {
  const normalized = stripMarkdownFence(text).trim()
  const start = normalized.indexOf('{')
  const end = normalized.lastIndexOf('}')
  if (start < 0 || end < start) {
    throw new Error('Model child output did not contain a JSON object.')
  }

  const parsed: unknown = JSON.parse(normalized.slice(start, end + 1))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Model child output JSON must be an object.')
  }
  return parsed
}

function stripMarkdownFence(text: string): string {
  const trimmed = text.trim()
  const withoutOpening = trimmed.replace(/^```(?:json)?\s*/i, '')
  return withoutOpening.replace(/\s*```$/u, '')
}

function modelChildOutput(
  metadata: Record<string, unknown> | undefined,
  profileId: string,
  stage: string,
): unknown {
  const debug = recordField(metadata, 'designBuildModelChildOutputs')
  const profile = recordField(debug, profileId)
  if (!profile) return undefined
  return profile[stage]
}

function recordField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return field && typeof field === 'object' && !Array.isArray(field)
    ? field as Record<string, unknown>
    : undefined
}
