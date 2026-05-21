/**
 * Telegraph Native Subagent Harness.
 *
 * Implements the `RuntimeExecutor` interface for Telegraph-owned subagent
 * orchestration. It runs subagent workflows (single/chain/parallel) through
 * Telegraph's native harness and embedded pi-ai kernel, without pretending to
 * be an adapter for any external subagent package.
 *
 * This runtime is selected only by `telegraph-subagents`.
 */

import type { RuntimeEvent } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { BaseAgentRuntime, type RuntimeInput } from '@/packages/agent/runtime/AgentRuntime'
import { streamPiAiRuntimeEvents, type PiAiExecutableTool } from '@/packages/agent/runtime/streamPiAiRuntime'
import type { AgentRuntimeSettings } from '@/packages/agent/types'
import {
  agentAliasList,
  agentCatalogText,
  type HarnessContributionSnapshot,
} from '@/packages/agent/extensions/harness'
import {
  TELEGRAPH_SUBAGENTS_PRODUCER_VERSION,
  TELEGRAPH_SUBAGENTS_RUNTIME_ID,
} from './constants'
import { orchestrate } from './orchestrator'
import { SubagentManager } from './SubagentManager'
import type { SubagentOrchestratorInput, SubagentRecord, TeamRouteDecision, TeamSpec } from './types'
import { createTelegraphSubagentsSnapshot, subagentDefinitionsFromSnapshot } from './agentDiscovery'
import {
  createDefaultTeamSpec,
  orchestratorInputFromRouteDecision,
  routeDecisionFromOrchestratorInput,
  teamRouteSummary,
  teamRouteTaskCount,
} from './teamRouter'

const SV = RUNTIME_CONTRACT_SCHEMA_VERSION
const PV = TELEGRAPH_SUBAGENTS_PRODUCER_VERSION

export interface TelegraphSubagentHarnessOptions {
  subagentManager?: SubagentManager
}

export class TelegraphSubagentHarness extends BaseAgentRuntime {
  readonly id = TELEGRAPH_SUBAGENTS_RUNTIME_ID
  readonly label = 'Telegraph Native Subagents'
  private readonly subagents: SubagentManager

  constructor(options: TelegraphSubagentHarnessOptions = {}) {
    super()
    this.subagents = options.subagentManager ?? new SubagentManager()
  }

  async *run(input: RuntimeInput): AsyncIterable<RuntimeEvent> {
    const { runId, sessionId, message, settings, signal } = input

    // Determine orchestration pattern from settings
    const agentSettings = settings as AgentRuntimeSettings
    const pattern = agentSettings.orchestrationPattern ?? 'chain'
    const origin = {
      framework: 'telegraph' as const,
      runtimeId: TELEGRAPH_SUBAGENTS_RUNTIME_ID,
    }

    // Emit run_started
    yield {
      type: 'run_started',
      schemaVersion: SV,
      producerVersion: PV,
      runId,
      ts: Date.now(),
      pattern: pattern === 'parallel' ? 'parallelization' : 'prompt_chain',
      origin,
    } as RuntimeEvent

    try {
      if (agentSettings.extensionBlocklist?.includes(TELEGRAPH_SUBAGENTS_RUNTIME_ID)) {
        yield {
          type: 'run_failed',
          schemaVersion: SV,
          producerVersion: PV,
          origin,
          runId,
          error: {
            code: 'telegraph_subagents_blocked',
            message: 'Telegraph native subagent orchestration is blocked for this run',
          },
          ts: Date.now(),
        } as RuntimeEvent
        return
      }

      const snapshot = createTelegraphSubagentsSnapshot({ cwd: process.cwd() })
      const agents = subagentDefinitionsFromSnapshot(snapshot)
      const team = createDefaultTeamSpec(snapshot)
      const route = yield* selectTeamRouteWithModel({
        runId,
        message,
        settings: agentSettings,
        signal,
        pattern,
        snapshot,
        team,
      })
      yield teamRouteStarted(runId, team, route)
      yield teamRouteCompleted(runId, team, route)

      const orchInput = orchestratorInputFromRouteDecision(route, team, message)
      if (!orchInput) {
        if (route.kind === 'clarify') {
          yield {
            type: 'assistant_delta',
            schemaVersion: SV,
            producerVersion: PV,
            origin,
            runId,
            requestId: this.generateRequestId(runId),
            text: route.question,
            ts: Date.now(),
            raw: { source: 'team-router-clarify', route },
          } as RuntimeEvent
        }
        yield {
          type: 'run_completed',
          schemaVersion: SV,
          producerVersion: PV,
          origin,
          runId,
          output: { mode: 'direct', route },
          ts: Date.now(),
        } as RuntimeEvent
        return
      }

      let childFailure: Extract<RuntimeEvent, { type: 'run_failed' }> | undefined
      const childOutputs: string[] = []

      // Run the orchestrator
      for await (const ev of orchestrate(orchInput, {
        runId,
        sessionId,
        settings: agentSettings,
        signal,
        agents,
        manager: this.subagents,
      })) {
        yield ev

        if ((ev.type === 'run_failed' || ev.type === 'run_cancelled') && ev.runId === runId) {
          return
        }

        if (ev.type === 'run_failed' && ev.runId !== runId && !childFailure) {
          childFailure = ev
        }

        if (ev.type === 'child_run_completed' && ev.parentRunId === runId) {
          const text = extractChildOutputText(ev.output)
          if (text) {
            childOutputs.push(text)
          }
        }
      }

      if (childFailure) {
        yield {
          type: 'run_failed',
          schemaVersion: SV,
          producerVersion: PV,
          origin,
          runId,
          error: {
            code: 'telegraph_subagents_child_failed',
            message: childFailure.error.message,
            details: {
              childRunId: childFailure.runId,
              childError: childFailure.error,
            },
          },
          ts: Date.now(),
        } as RuntimeEvent
        return
      }

      const synthesized = yield* synthesizeFinalAnswerWithModel({
        runId,
        message,
        settings: agentSettings,
        signal,
        mode: orchInput.mode,
        subagents: this.subagents,
      })

      const finalText = synthesized ? '' : formatFinalOutput(orchInput.mode, childOutputs)
      if (!synthesized && finalText) {
        yield {
          type: 'assistant_delta',
          schemaVersion: SV,
          producerVersion: PV,
          origin,
          runId,
          requestId: this.generateRequestId(runId),
          text: finalText,
          ts: Date.now(),
          raw: { source: 'telegraph-subagents-final-output', mode: orchInput.mode },
        } as RuntimeEvent
      }

      // Emit run_completed
      yield {
        type: 'run_completed',
        schemaVersion: SV,
        producerVersion: PV,
        origin,
        runId,
        output: { mode: orchInput.mode },
        raw: { route },
        ts: Date.now(),
      } as RuntimeEvent
    } catch (error) {
      yield {
        type: 'run_failed',
        schemaVersion: SV,
        producerVersion: PV,
        origin,
        runId,
        error: {
          code: 'telegraph_subagents_runtime_error',
          message: error instanceof Error ? error.message : String(error),
          details: normalizeErrorDetails(error),
        },
        ts: Date.now(),
      } as RuntimeEvent
    }
  }
}

function normalizeErrorDetails(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }
  return error
}

function extractChildOutputText(output: unknown): string | undefined {
  if (typeof output === 'string') return output
  if (!output || typeof output !== 'object') return undefined
  const text = (output as { text?: unknown }).text
  return typeof text === 'string' && text.length > 0 ? text : undefined
}

function formatFinalOutput(mode: SubagentOrchestratorInput['mode'], childOutputs: string[]): string {
  if (childOutputs.length === 0) return ''
  if (mode === 'parallel') {
    return childOutputs
      .map((text, index) => `=== Subagent ${index + 1} ===\n${text}`)
      .join('\n\n')
  }
  return childOutputs[childOutputs.length - 1] ?? ''
}

async function* synthesizeFinalAnswerWithModel(options: {
  runId: string
  message: string
  settings: AgentRuntimeSettings
  signal?: AbortSignal
  mode: SubagentOrchestratorInput['mode']
  subagents: SubagentManager
}): AsyncGenerator<RuntimeEvent, boolean, void> {
  const records = options.subagents
    .listRecords()
    .filter(record => record.parentRunId === options.runId)
    .sort((a, b) => a.startedAt - b.startedAt)
  if (records.length === 0) return false

  let producedAssistantText = false
  const tools = [
    createGetSubagentResultTool({
      parentRunId: options.runId,
      subagents: options.subagents,
    }),
  ]

  try {
    for await (const event of streamPiAiRuntimeEvents({
      runId: options.runId,
      settings: options.settings,
      message: buildFinalSynthesisUserMessage(options.message, options.mode, records),
      signal: options.signal,
      tools,
      maxToolIterations: Math.max(2, records.length + 1),
      systemPrompt: buildFinalSynthesisSystemPrompt(),
    })) {
      if (event.type === 'run_completed') {
        return producedAssistantText
      }
      if (event.type === 'run_failed') {
        yield finalSynthesisFallbackLog(options.runId, event.error.message, event.error)
        return false
      }
      if (event.type === 'assistant_delta') {
        producedAssistantText = true
      }
      yield event
    }
  } catch (error) {
    yield finalSynthesisFallbackLog(
      options.runId,
      error instanceof Error ? error.message : String(error),
      normalizeErrorDetails(error),
    )
    return false
  }

  return producedAssistantText
}

function createGetSubagentResultTool(options: {
  parentRunId: string
  subagents: SubagentManager
}): PiAiExecutableTool {
  return {
    name: 'get_subagent_result',
    description: [
      'Fetch the current Telegraph subagent child-run snapshot and result by childRunId.',
      'Use this before writing the final answer after subagent work completes.',
    ].join(' '),
    parameters: objectSchema({
      childRunId: stringSchema('Child run id returned by the subagent orchestration.'),
      consume: {
        type: 'boolean',
        description: 'Mark the result as consumed. Defaults to true for final synthesis.',
      },
    }, ['childRunId']),
    async execute(input) {
      const childRunId = readRequiredString(input.childRunId, 'childRunId')
      const consume = input.consume === undefined ? true : input.consume === true
      const record = options.subagents.getResult(childRunId, { consume })
      if (!record || record.parentRunId !== options.parentRunId) {
        return {
          found: false,
          childRunId,
          error: 'Subagent child run not found in the current parent run.',
        }
      }
      return {
        found: true,
        record: snapshotSubagentRecord(record),
      }
    },
  }
}

function snapshotSubagentRecord(record: SubagentRecord): Record<string, unknown> {
  return {
    id: record.id,
    parentRunId: record.parentRunId,
    agent: record.agent,
    label: record.label,
    description: record.description,
    task: record.task,
    status: record.status,
    result: record.result,
    error: record.error,
    toolUses: record.toolUses,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    resultConsumed: record.resultConsumed,
    origin: record.origin,
  }
}

function buildFinalSynthesisSystemPrompt(): string {
  return [
    'You are the Telegraph parent agent writing the final answer after delegated subagent work.',
    'Before answering, call get_subagent_result for each childRunId whose result you need.',
    'Use only fetched subagent results and the original user request; do not invent child findings.',
    'Return a concise answer for the user. Do not mention internal tool mechanics unless useful.',
  ].join('\n')
}

function buildFinalSynthesisUserMessage(
  message: string,
  mode: SubagentOrchestratorInput['mode'],
  records: SubagentRecord[],
): string {
  return [
    'Original user request:',
    message,
    '',
    `Subagent orchestration mode: ${mode}`,
    '',
    'Child runs available for result lookup:',
    ...records.map(record => [
      `- ${record.id}`,
      `  agent: ${record.agent}`,
      `  label: ${record.label}`,
      `  status: ${record.status}`,
      `  task: ${record.task}`,
    ].join('\n')),
    '',
    'Call get_subagent_result for the relevant childRunId values, then write the final answer.',
  ].join('\n')
}

function finalSynthesisFallbackLog(runId: string, message: string, details?: unknown): RuntimeEvent {
  return {
    type: 'runtime_log',
    schemaVersion: SV,
    producerVersion: PV,
    runId,
    level: 'warn',
    message: `Final subagent synthesis failed; falling back to deterministic child output aggregation: ${message}`,
    raw: details,
    ts: Date.now(),
  } as RuntimeEvent
}

function teamRouteStarted(runId: string, team: TeamSpec, route: TeamRouteDecision): RuntimeEvent {
  return {
    type: 'step_started',
    schemaVersion: SV,
    producerVersion: PV,
    runId,
    stepId: `${runId}:team-router`,
    label: 'Team Router',
    kind: 'router',
    raw: {
      team,
      route,
      summary: teamRouteSummary(route),
    },
    ts: Date.now(),
  } as RuntimeEvent
}

function teamRouteCompleted(runId: string, team: TeamSpec, route: TeamRouteDecision): RuntimeEvent {
  return {
    type: 'step_completed',
    schemaVersion: SV,
    producerVersion: PV,
    runId,
    stepId: `${runId}:team-router`,
    output: {
      teamId: team.id,
      decision: route,
      taskCount: teamRouteTaskCount(route),
      summary: teamRouteSummary(route),
    },
    raw: {
      teamMembers: team.members,
      policies: team.policies,
    },
    ts: Date.now(),
  } as RuntimeEvent
}

// ---------------------------------------------------------------------------
// Model-driven delegation
// ---------------------------------------------------------------------------

async function* selectTeamRouteWithModel(options: {
  runId: string
  message: string
  settings: AgentRuntimeSettings
  signal?: AbortSignal
  pattern: 'chain' | 'parallel'
  snapshot: HarnessContributionSnapshot
  team: TeamSpec
}): AsyncGenerator<RuntimeEvent, TeamRouteDecision, void> {
  let selectedInput: SubagentOrchestratorInput | undefined
  let selectedRoute: TeamRouteDecision | undefined
  const subagentTool = createSubagentSelectionTool({
    message: options.message,
    pattern: options.pattern,
    snapshot: options.snapshot,
    team: options.team,
    onSelect: input => {
      selectedInput = input
    },
    onRoute: route => {
      selectedRoute = route
    },
  })

  for await (const event of streamPiAiRuntimeEvents({
    runId: options.runId,
    settings: options.settings,
    message: options.message,
    signal: options.signal,
    tools: [subagentTool],
    maxToolIterations: 1,
    systemPrompt: buildParentOrchestratorSystemPrompt(options.pattern, options.snapshot),
  })) {
    if (event.type === 'run_failed') {
      if (!selectedInput) {
        yield event
        return {
          kind: 'direct',
          reason: `Router model failed before selecting a team route: ${event.error.message}`,
        }
      }
      break
    }
    if (event.type === 'run_completed') {
      continue
    }
    if (event.type === 'assistant_delta' && selectedInput) {
      continue
    }
    yield event
  }

  return selectedRoute ?? routeDecisionFromOrchestratorInput(
    selectedInput,
    options.team,
    options.message,
    selectedInput ? 'Model router selected a Telegraph team route.' : undefined,
  )
}

function createSubagentSelectionTool(options: {
  message: string
  pattern: 'chain' | 'parallel'
  snapshot: HarnessContributionSnapshot
  team: TeamSpec
  onSelect: (input: SubagentOrchestratorInput) => void
  onRoute: (route: TeamRouteDecision) => void
}): PiAiExecutableTool {
  const agentAliases = agentAliasList(options.snapshot)
  const agentSchema = agentAliases.length > 0
    ? stringEnumSchema(agentAliases, 'Agent profile alias from the enabled subagent registry.')
    : stringSchema('Agent profile alias from the enabled subagent registry.')
  return {
    name: 'subagent',
    description: [
      'Route work to the Telegraph team.',
      'Use agent + task for a single member, tasks[] for parallel members, or chain[] for worker-review handoff.',
      'Call this only when team delegation materially helps the user request.',
    ].join(' '),
    parameters: objectSchema({
      agent: agentSchema,
      task: stringSchema('Task for the selected agent or the top-level objective.'),
      tasks: {
        type: 'array',
        description: 'Parallel delegation tasks.',
        items: objectSchema({
          agent: agentSchema,
          label: stringSchema('Optional display label for the child run.'),
          task: stringSchema('Concrete task for this child run.'),
          count: numberSchema('Repeat this task N times.'),
          output: stringSchema('Optional output path.'),
          reads: arrayOfStringsSchema('Files to read before running.'),
          model: stringSchema('Optional model override.'),
          skills: arrayOfStringsSchema('Skills to inject.'),
        }, ['agent', 'task']),
      },
      chain: {
        type: 'array',
        description: 'Sequential delegation steps.',
        items: objectSchema({
          agent: agentSchema,
          label: stringSchema('Optional display label for this step.'),
          task: stringSchema('Task template. May use {task} and {previous}.'),
          parallel: {
            type: 'array',
            description: 'Parallel fan-out within this chain step.',
            items: objectSchema({
              agent: agentSchema,
              label: stringSchema('Optional display label.'),
              task: stringSchema('Task template.'),
            }, ['agent']),
          },
          output: stringSchema('Optional output path.'),
          reads: arrayOfStringsSchema('Files to read before running.'),
          model: stringSchema('Optional model override.'),
          skills: arrayOfStringsSchema('Skills to inject.'),
        }, []),
      },
      concurrency: numberSchema('Maximum number of parallel tasks to run concurrently.'),
      context: {
        type: 'string',
        enum: ['fresh', 'fork'],
        description: 'Context strategy for child runs.',
      },
      reason: stringSchema('Why this route is appropriate. This becomes routing rationale in Run Console.'),
      clarifyQuestion: stringSchema('Question to ask if the request is too ambiguous for routing.'),
      routeKind: {
        type: 'string',
        enum: ['direct', 'clarify', 'single', 'parallel', 'review'],
        description: 'High-level Team Router v0 decision kind.',
      },
    }, []),
    async execute(input) {
      const routeKind = readRouteKind(input.routeKind)
      const reason = readString(input.reason) ?? 'Model selected a team route.'
      const task = readString(input.task) ?? options.message
      const hasExplicitDelegation =
        Boolean(readString(input.agent)) ||
        readParallelTasks(input.tasks).length > 0 ||
        readChainSteps(input.chain).length > 0

      if (routeKind === 'direct') {
        options.onRoute({
          kind: 'direct',
          reason,
        })
        return {
          accepted: true,
          mode: 'direct',
          teamId: options.team.id,
          reason,
          childRuns: 0,
        }
      }

      if (routeKind === 'clarify') {
        const question = readString(input.clarifyQuestion) ?? 'Can you clarify the intended team task and success criteria?'
        options.onRoute({
          kind: 'clarify',
          question,
          reason,
        })
        return {
          accepted: true,
          mode: 'clarify',
          teamId: options.team.id,
          reason,
          childRuns: 0,
        }
      }

      if (routeKind === 'review' && !hasExplicitDelegation) {
        options.onRoute({
          kind: 'review',
          workerTask: task,
          reviewerTask: 'Review the worker output for correctness, regressions, and gaps.',
          reason,
        })
        return {
          accepted: true,
          mode: 'review',
          teamId: options.team.id,
          reason,
          childRuns: 2,
        }
      }

      const selected = readToolOrchestratorInput(input, options.message, options.pattern, agentAliases)
      options.onSelect(selected)
      return {
        accepted: true,
        mode: selected.mode,
        teamId: options.team.id,
        reason,
        childRuns: selected.mode === 'parallel'
          ? selected.tasks?.length ?? 0
          : selected.mode === 'chain'
            ? selected.chain?.length ?? 0
            : 1,
      }
    },
  }
}

function buildParentOrchestratorSystemPrompt(
  pattern: 'chain' | 'parallel',
  snapshot: HarnessContributionSnapshot,
): string {
  return [
    'You are the Telegraph parent agent.',
    'Act as Team Router v0. Decide whether the request should be direct, clarify, single, parallel, or review.',
    'Available team members for this run:',
    agentCatalogText(snapshot),
    'If the user asks for subagents, parallel reviewers, delegated investigation, implementation plus review, or work that benefits from isolated specialist runs, call the subagent tool exactly once and include a concise reason.',
    'If the request is simple enough for one assistant response, answer directly without calling tools.',
    'If the request is too ambiguous to route safely, answer with a concise clarifying question without calling tools.',
    `The UI preference is ${pattern}, but the user message and your judgment decide the actual subagent shape.`,
    'Do not ask the user to write JSON. Natural language is the product interface; the tool call arguments are your private structured decision.',
  ].join('\n')
}

function readToolOrchestratorInput(
  input: Record<string, unknown>,
  message: string,
  pattern: 'chain' | 'parallel',
  availableAgents: string[],
): SubagentOrchestratorInput {
  const task = readString(input.task) ?? message
  const tasks = readParallelTasks(input.tasks)
  if (tasks.length > 0) {
    return {
      mode: 'parallel',
      task,
      tasks,
      context: readContext(input.context),
      concurrency: readPositiveInteger(input.concurrency),
    }
  }

  const chain = readChainSteps(input.chain)
  if (chain.length > 0) {
    return {
      mode: 'chain',
      task,
      chain,
      context: readContext(input.context),
    }
  }

  const agent = readString(input.agent)
  if (agent) {
    return {
      mode: 'single',
      task,
      agent,
      context: readContext(input.context),
    }
  }

  return createDefaultOrchestratorInput(message, pattern, availableAgents)
}

function createDefaultOrchestratorInput(
  message: string,
  pattern: 'chain' | 'parallel',
  availableAgents: string[],
): SubagentOrchestratorInput {
  // This fallback is intentionally data-driven. Specific presets such as scout
  // are not special-cased here; the parent model should normally provide the
  // selected plan through the subagent tool.
  const selectedAgents = availableAgents.slice(0, 4)
  if (selectedAgents.length === 0) {
    return {
      mode: 'single',
      task: message,
    }
  }
  if (pattern === 'parallel') {
    return {
      mode: 'parallel',
      task: message,
      tasks: selectedAgents.map(agent => ({ agent, task: message })),
      concurrency: Math.max(1, selectedAgents.length),
    }
  }

  return {
    mode: 'chain',
    task: message,
    chain: selectedAgents.map((agent, index) => ({
      agent,
      task: index === 0 ? '{task}' : '{previous}',
    })),
  }
}

function objectSchema(properties: Record<string, unknown>, required: string[]): PiAiExecutableTool['parameters'] {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  } as PiAiExecutableTool['parameters']
}

function stringSchema(description: string): unknown {
  return { type: 'string', description }
}

function numberSchema(description: string): unknown {
  return { type: 'number', description }
}

function stringEnumSchema(values: string[], description: string): unknown {
  return { type: 'string', enum: values, description }
}

function arrayOfStringsSchema(description: string): unknown {
  return {
    type: 'array',
    description,
    items: { type: 'string' },
  }
}

function readParallelTasks(value: unknown): NonNullable<SubagentOrchestratorInput['tasks']> {
  if (!Array.isArray(value)) return []
  return value
    .map(readParallelTask)
    .filter((task): task is NonNullable<SubagentOrchestratorInput['tasks']>[number] => task !== undefined)
}

function readParallelTask(value: unknown): NonNullable<SubagentOrchestratorInput['tasks']>[number] | undefined {
  if (!isRecord(value)) return undefined
  const agent = readString(value.agent)
  if (!agent) return undefined
  return {
    agent,
    label: readString(value.label),
    task: readString(value.task),
    count: readPositiveInteger(value.count),
    output: readString(value.output),
    reads: readStringArray(value.reads),
    model: readString(value.model),
    skills: readStringArray(value.skills),
  }
}

function readChainSteps(value: unknown): NonNullable<SubagentOrchestratorInput['chain']> {
  if (!Array.isArray(value)) return []
  return value
    .map(readChainStep)
    .filter((step): step is NonNullable<SubagentOrchestratorInput['chain']>[number] => step !== undefined)
}

function readChainStep(value: unknown): NonNullable<SubagentOrchestratorInput['chain']>[number] | undefined {
  if (!isRecord(value)) return undefined
  const agent = readString(value.agent)
  const parallel = readParallelTasks(value.parallel)
  if (!agent && parallel.length === 0) return undefined
  return {
    agent: agent ?? 'parallel',
    label: readString(value.label),
    task: readString(value.task),
    parallel: parallel.length > 0 ? parallel : undefined,
    output: readString(value.output),
    reads: readStringArray(value.reads),
    model: readString(value.model),
    skills: readStringArray(value.skills),
  }
}

function readContext(value: unknown): SubagentOrchestratorInput['context'] | undefined {
  return value === 'fresh' || value === 'fork' ? value : undefined
}

function readRouteKind(value: unknown): TeamRouteDecision['kind'] | undefined {
  if (
    value === 'direct' ||
    value === 'clarify' ||
    value === 'single' ||
    value === 'parallel' ||
    value === 'review'
  ) {
    return value
  }
  return undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function readRequiredString(value: unknown, name: string): string {
  const string = readString(value)
  if (!string) {
    throw new Error(`${name} must be a non-empty string`)
  }
  return string
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  return strings.length > 0 ? strings : undefined
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
