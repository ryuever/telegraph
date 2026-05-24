import type { RuntimeEvent } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { streamPiAiRuntimeEvents } from '@/packages/agent/runtime/streamPiAiRuntime'
import type { AgentRuntimeSettings } from '@/packages/agent/types'
import {
  formatSelectedSkillBodiesForPrompt,
  formatSkillsForPrompt,
  loadSkills,
  resolveSkillSearchRoot,
} from '@/packages/agent/skills'
import { createSubagentTools } from './tools'
import type { SubagentDefinition, SubagentRecord } from './types'
import { TELEGRAPH_SUBAGENTS_PRODUCER_VERSION } from './constants'

const SV = RUNTIME_CONTRACT_SCHEMA_VERSION
const PV = TELEGRAPH_SUBAGENTS_PRODUCER_VERSION

export interface SubagentRunRequest {
  parentRunId: string
  childRunId: string
  label: string
  agent: SubagentDefinition
  task: string
  settings: AgentRuntimeSettings
  sessionId?: string
  signal?: AbortSignal
  modelOverride?: string
  skills?: string[]
}

export interface SubagentRunner {
  run(request: SubagentRunRequest, record: SubagentRecord): AsyncGenerator<RuntimeEvent, SubagentRecord, void>
}

export class StreamingSubagentRunner implements SubagentRunner {
  async *run(request: SubagentRunRequest, record: SubagentRecord): AsyncGenerator<RuntimeEvent, SubagentRecord, void> {
    const { parentRunId, childRunId, label, agent, task, settings, sessionId, signal, modelOverride } = request
    const childSettings = applyAgentSettings(settings, agent, modelOverride)
    const prompt = buildPromptForAgent(agent, task, {
      selectedSkillNames: request.skills,
    })
    const tools = createSubagentTools({
      runId: childRunId,
      sessionId,
      settings: childSettings,
      allowedTools: agent.tools,
    })

    yield childStarted(parentRunId, childRunId, label)

    let childText = ''

    try {
      for await (const ev of streamPiAiRuntimeEvents({
        runId: childRunId,
        settings: childSettings,
        message: prompt,
        signal,
        tools,
      })) {
        if (ev.type === 'run_completed' || ev.type === 'run_failed') {
          if (ev.type === 'run_failed') {
            record.status = 'error'
            record.error = ev.error.message
            record.result = childText
            record.completedAt = now()
            yield childCompleted(parentRunId, childRunId, label, childText, 1, record.completedAt - record.startedAt)
            yield ev
            return record
          }
          continue
        }

        if (ev.type === 'assistant_delta') {
          childText += ev.text
        }
        if (ev.type === 'tool_call') {
          record.toolUses += 1
        }

        yield ev
      }
    } catch (error) {
      record.status = signal?.aborted ? 'stopped' : 'error'
      record.error = error instanceof Error ? error.message : String(error)
      record.completedAt = now()
      yield childCompleted(parentRunId, childRunId, label, childText, 1, record.completedAt - record.startedAt)
      yield failEvent(childRunId, 'child_run_error', record.error)
      return record
    }

    record.status = signal?.aborted ? 'stopped' : 'completed'
    record.result = childText
    record.completedAt = now()
    yield childCompleted(parentRunId, childRunId, label, childText, record.status === 'completed' ? 0 : 1, record.completedAt - record.startedAt)
    return record
  }
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

export interface BuildPromptForAgentOptions {
  cwd?: string
  selectedSkillNames?: string[]
}

export function buildPromptForAgent(
  agent: SubagentDefinition,
  task: string,
  options: BuildPromptForAgentOptions = {},
): string {
  const skillPrompt = buildSkillPromptForAgent(agent, options)
  const promptSections = [
    agent.systemPromptMode === 'append' || !agent.systemPrompt ? undefined : agent.systemPrompt,
    skillPrompt,
  ].filter(Boolean)

  if (promptSections.length === 0) return task
  return `${promptSections.join('\n\n')}\n\n---\n\nTask: ${task}`
}

function buildSkillPromptForAgent(
  agent: SubagentDefinition,
  options: BuildPromptForAgentOptions,
): string {
  const selectedSkillNames = [
    ...(agent.skills ?? []),
    ...(options.selectedSkillNames ?? []),
  ]
  if (!agent.inheritSkills && selectedSkillNames.length === 0) return ''

  const { skills } = loadSkills({
    cwd: resolveSkillSearchRoot(options.cwd),
  })
  return [
    agent.inheritSkills ? formatSkillsForPrompt(skills) : '',
    selectedSkillNames.length > 0
      ? formatSelectedSkillBodiesForPrompt(skills, selectedSkillNames)
      : '',
  ].filter(Boolean).join('\n\n')
}

export function applyAgentSettings(
  base: AgentRuntimeSettings,
  agent: SubagentDefinition,
  modelOverride?: string,
): AgentRuntimeSettings {
  const settings = { ...base }
  const model = modelOverride ?? agent.model
  if (model) {
    const slashIdx = model.indexOf('/')
    if (slashIdx > 0) {
      settings.provider = model.slice(0, slashIdx)
      const rest = model.slice(slashIdx + 1)
      const colonIdx = rest.lastIndexOf(':')
      settings.modelId = colonIdx > 0 ? rest.slice(0, colonIdx) : rest
    } else {
      settings.modelId = model
    }
  }

  settings.backend = 'pi-ai'
  settings.orchestration = 'none'
  return settings
}

function childStarted(parentRunId: string, childRunId: string, label: string): RuntimeEvent {
  return {
    type: 'child_run_started',
    schemaVersion: SV,
    producerVersion: PV,
    parentRunId,
    childRunId,
    label,
    ts: now(),
  } as RuntimeEvent
}

function childCompleted(
  parentRunId: string,
  childRunId: string,
  label: string,
  text: string,
  exitCode: number,
  durationMs: number,
): RuntimeEvent {
  return {
    type: 'child_run_completed',
    schemaVersion: SV,
    producerVersion: PV,
    parentRunId,
    childRunId,
    label,
    output: { text, exitCode, durationMs },
    ts: now(),
  } as RuntimeEvent
}

function failEvent(runId: string, code: string, message: string): RuntimeEvent {
  return {
    type: 'run_failed',
    schemaVersion: SV,
    producerVersion: PV,
    runId,
    error: { code, message },
    ts: now(),
  } as RuntimeEvent
}

function now(): number {
  return Date.now()
}
