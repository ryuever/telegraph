/**
 * Subagent orchestrator.
 *
 * Executes single, chain, and parallel subagent workflows in-process
 * using Telegraph's pi-ai streaming infrastructure. Each child agent
 * run becomes a separate `streamPiAiRuntimeEvents()` call with the
 * agent's system prompt injected into the context.
 *
 * Emits `RuntimeEvent` including `child_run_started/completed`,
 * `step_started/completed`, and all model/tool events from each child.
 */

import type { RuntimeEvent } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { streamPiAiRuntimeEvents } from '../streamPiAiRuntime'
import type { AgentRuntimeSettings } from '../../types'
import { createSubagentTools } from './tools'
import type {
  SubagentChainStep,
  SubagentChildResult,
  SubagentDefinition,
  SubagentOrchestratorInput,
  SubagentParallelTask,
} from './types'
import { discoverAgents } from './agentDiscovery'

import { TELEGRAPH_SUBAGENTS_PRODUCER_VERSION } from './constants'
export { TELEGRAPH_SUBAGENTS_PRODUCER_VERSION }

const SV = RUNTIME_CONTRACT_SCHEMA_VERSION
const PV = TELEGRAPH_SUBAGENTS_PRODUCER_VERSION

function ts() {
  return Date.now()
}

// ---------------------------------------------------------------------------
// Public orchestrator
// ---------------------------------------------------------------------------

export interface OrchestratorOptions {
  runId: string
  sessionId?: string
  settings: AgentRuntimeSettings
  signal?: AbortSignal
  /** Override agent discovery (e.g. for testing). */
  agents?: Map<string, SubagentDefinition>
}

/**
 * Execute a subagent orchestration plan and yield all RuntimeEvents.
 */
export async function* orchestrate(
  input: SubagentOrchestratorInput,
  opts: OrchestratorOptions,
): AsyncGenerator<RuntimeEvent> {
  const agents = opts.agents ?? discoverAgents({ cwd: process.cwd() })

  switch (input.mode) {
    case 'single': {
      if (!input.agent) {
        yield failEvent(opts.runId, 'missing_agent', 'Single mode requires an agent name')
        return
      }
      const def = agents.get(input.agent)
      if (!def) {
        yield failEvent(opts.runId, 'agent_not_found', `Agent "${input.agent}" not found. Available: ${[...agents.keys()].join(', ')}`)
        return
      }
      yield* runSingleAgent(def, input.task, opts)
      return
    }

    case 'chain': {
      if (!input.chain?.length) {
        yield failEvent(opts.runId, 'empty_chain', 'Chain mode requires at least one step')
        return
      }
      yield* runChain(input.chain, input.task, agents, opts)
      return
    }

    case 'parallel': {
      if (!input.tasks?.length) {
        yield failEvent(opts.runId, 'empty_parallel', 'Parallel mode requires at least one task')
        return
      }
      yield* runParallel(input.tasks, input.task, agents, opts, input.concurrency)
      return
    }

    default:
      yield failEvent(opts.runId, 'unknown_mode', `Unknown execution mode: ${input.mode}`)
  }
}

// ---------------------------------------------------------------------------
// Single agent execution
// ---------------------------------------------------------------------------

async function* runSingleAgent(
  agent: SubagentDefinition,
  task: string,
  opts: OrchestratorOptions,
): AsyncGenerator<RuntimeEvent> {
  const childRunId = `${opts.runId}-${agent.name}`

  yield childStarted(opts.runId, childRunId, agent.name)

  const childSettings = applyAgentSettings(opts.settings, agent)
  const prompt = buildPromptForAgent(agent, task)
  const tools = createSubagentTools({
    runId: childRunId,
    sessionId: opts.sessionId,
    settings: childSettings,
    allowedTools: agent.tools,
  })

  let childText = ''
  const startMs = ts()

  try {
    for await (const ev of streamPiAiRuntimeEvents({
      runId: childRunId,
      settings: childSettings,
      message: prompt,
      signal: opts.signal,
      tools,
    })) {
      // Re-emit child events (skip run_started/completed — we wrap with child_run_*)
      if (ev.type === 'run_completed' || ev.type === 'run_failed') {
        // Extract text from run_completed
        if (ev.type === 'run_completed') {
          // Text was already accumulated via assistant_delta
        }
        if (ev.type === 'run_failed') {
          yield childCompleted(opts.runId, childRunId, agent.name, childText, 1, ts() - startMs)
          yield ev // also emit the failure
          return
        }
        continue
      }

      // Track assistant text
      if (ev.type === 'assistant_delta' && (ev as any).text) {
        childText += (ev as any).text
      }

      yield ev
    }
  } catch (err) {
    yield childCompleted(opts.runId, childRunId, agent.name, '', 1, ts() - startMs)
    yield failEvent(childRunId, 'child_run_error', err instanceof Error ? err.message : String(err))
    return
  }

  yield childCompleted(opts.runId, childRunId, agent.name, childText, 0, ts() - startMs)
}

// ---------------------------------------------------------------------------
// Chain execution
// ---------------------------------------------------------------------------

async function* runChain(
  steps: SubagentChainStep[],
  originalTask: string,
  agents: Map<string, SubagentDefinition>,
  opts: OrchestratorOptions,
): AsyncGenerator<RuntimeEvent> {
  let previousOutput = ''

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const stepId = `${opts.runId}-step-${i}`

    if (opts.signal?.aborted) {
      yield failEvent(opts.runId, 'chain_cancelled', 'Chain was cancelled')
      return
    }

    // Handle parallel fan-out within a chain step
    if (step.parallel?.length) {
      yield stepStarted(opts.runId, stepId, `parallel-fan-out-${i}`, 'aggregator')

      const parallelResults: SubagentChildResult[] = []
      for await (const ev of runParallel(
        step.parallel,
        applyTemplateVars(step.task ?? originalTask, originalTask, previousOutput),
        agents,
        opts,
      )) {
        yield ev
        // Collect results from child_run_completed
        if (ev.type === 'child_run_completed' && (ev as any).output) {
          const output = typeof (ev as any).output === 'string'
            ? (ev as any).output
            : JSON.stringify((ev as any).output)
          parallelResults.push({
            agent: (ev as any).label ?? 'unknown',
            childRunId: (ev as any).childRunId ?? '',
            text: output,
            exitCode: 0,
            durationMs: 0,
          })
        }
      }

      previousOutput = aggregateParallelOutputs(parallelResults)
      yield stepCompleted(opts.runId, stepId, previousOutput)
      continue
    }

    // Normal sequential step
    const agentDef = agents.get(step.agent)
    if (!agentDef) {
      yield failEvent(opts.runId, 'agent_not_found', `Chain step ${i}: agent "${step.agent}" not found`)
      return
    }

    yield stepStarted(opts.runId, stepId, `${step.agent} (step ${i + 1}/${steps.length})`, 'worker')

    const task = applyTemplateVars(step.task ?? '{previous}', originalTask, previousOutput)
    const childRunId = `${opts.runId}-chain-${i}-${step.agent}`
    const childSettings = applyAgentSettings(opts.settings, agentDef, step.model)
    const prompt = buildPromptForAgent(agentDef, task)
    const tools = createSubagentTools({
      runId: childRunId,
      sessionId: opts.sessionId,
      settings: childSettings,
      allowedTools: agentDef.tools,
    })

    yield childStarted(opts.runId, childRunId, step.agent)

    let childText = ''
    const startMs = ts()

    try {
      for await (const ev of streamPiAiRuntimeEvents({
        runId: childRunId,
        settings: childSettings,
        message: prompt,
        signal: opts.signal,
        tools,
      })) {
        if (ev.type === 'run_completed' || ev.type === 'run_failed') {
          if (ev.type === 'run_failed') {
            yield childCompleted(opts.runId, childRunId, step.agent, childText, 1, ts() - startMs)
            yield stepCompleted(opts.runId, stepId, childText)
            yield ev
            return
          }
          continue
        }
        if (ev.type === 'assistant_delta' && (ev as any).text) {
          childText += (ev as any).text
        }
        yield ev
      }
    } catch (err) {
      yield childCompleted(opts.runId, childRunId, step.agent, '', 1, ts() - startMs)
      yield failEvent(opts.runId, 'chain_step_error', `Step ${i} (${step.agent}): ${err instanceof Error ? err.message : String(err)}`)
      return
    }

    yield childCompleted(opts.runId, childRunId, step.agent, childText, 0, ts() - startMs)
    yield stepCompleted(opts.runId, stepId, childText)
    previousOutput = childText
  }
}

// ---------------------------------------------------------------------------
// Parallel execution
// ---------------------------------------------------------------------------

async function* runParallel(
  tasks: SubagentParallelTask[],
  fallbackTask: string,
  agents: Map<string, SubagentDefinition>,
  opts: OrchestratorOptions,
  concurrency: number = 4,
): AsyncGenerator<RuntimeEvent> {
  // Expand tasks with count > 1
  const expanded: Array<{ agent: string; label?: string; task: string; index: number; model?: string }> = []
  for (const t of tasks) {
    const count = t.count ?? 1
    for (let i = 0; i < count; i++) {
      expanded.push({
        agent: t.agent,
        label: t.label,
        task: t.task ?? fallbackTask,
        index: expanded.length,
        model: t.model,
      })
    }
  }

  // Run with concurrency control, collecting events
  // We use a simple semaphore approach to limit concurrency
  const results: RuntimeEvent[] = []
  let active = 0
  let nextIdx = 0

  // Since we can't truly parallelize yields from an async generator,
  // we collect events from all concurrent children and yield them in order.
  // This is a simplification — true concurrent streaming would need a different architecture.
  const allChildEvents: RuntimeEvent[][] = expanded.map(() => [])

  const runChild = async (idx: number): Promise<void> => {
    const t = expanded[idx]
    const agentDef = agents.get(t.agent)
    if (!agentDef) {
      allChildEvents[idx].push(failEvent(opts.runId, 'agent_not_found', `Parallel task ${idx}: agent "${t.agent}" not found`))
      return
    }

    const childRunId = `${opts.runId}-par-${idx}-${t.agent}`
    const childLabel = t.label ?? t.agent
    const childSettings = applyAgentSettings(opts.settings, agentDef, t.model)
    const prompt = buildPromptForAgent(agentDef, t.task)
    const tools = createSubagentTools({
      runId: childRunId,
      sessionId: opts.sessionId,
      settings: childSettings,
      allowedTools: agentDef.tools,
    })

    allChildEvents[idx].push(childStarted(opts.runId, childRunId, childLabel))

    let childText = ''
    const startMs = ts()

    try {
      for await (const ev of streamPiAiRuntimeEvents({
        runId: childRunId,
        settings: childSettings,
        message: prompt,
        signal: opts.signal,
        tools,
      })) {
        if (ev.type === 'run_completed' || ev.type === 'run_failed') {
          if (ev.type === 'run_failed') {
            allChildEvents[idx].push(childCompleted(opts.runId, childRunId, childLabel, childText, 1, ts() - startMs))
            allChildEvents[idx].push(ev)
            return
          }
          continue
        }
        if (ev.type === 'assistant_delta' && (ev as any).text) {
          childText += (ev as any).text
        }
        allChildEvents[idx].push(ev)
      }
    } catch (err) {
      allChildEvents[idx].push(childCompleted(opts.runId, childRunId, childLabel, '', 1, ts() - startMs))
      return
    }

    allChildEvents[idx].push(childCompleted(opts.runId, childRunId, childLabel, childText, 0, ts() - startMs))
  }

  // Execute with concurrency limit
  const promises: Promise<void>[] = []
  for (let i = 0; i < expanded.length; i++) {
    if (promises.length >= concurrency) {
      await Promise.race(promises)
    }
    const p = runChild(i).then(() => {
      const idx = promises.indexOf(p)
      if (idx >= 0) promises.splice(idx, 1)
    })
    promises.push(p)
  }
  await Promise.all(promises)

  // Yield all collected events in task order
  for (const events of allChildEvents) {
    for (const ev of events) {
      yield ev
    }
  }
}

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

function buildPromptForAgent(agent: SubagentDefinition, task: string): string {
  if (agent.systemPromptMode === 'append' || !agent.systemPrompt) {
    return task
  }
  // For replace mode, prepend the system prompt context
  return `${agent.systemPrompt}\n\n---\n\nTask: ${task}`
}

function applyTemplateVars(template: string, task: string, previous: string): string {
  return template
    .replace(/\{task\}/g, task)
    .replace(/\{previous\}/g, previous)
}

function aggregateParallelOutputs(results: SubagentChildResult[]): string {
  return results
    .map((r, i) => `=== Parallel Task ${i + 1} (${r.agent}) ===\n${r.text}`)
    .join('\n\n')
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------

function applyAgentSettings(
  base: AgentRuntimeSettings,
  agent: SubagentDefinition,
  modelOverride?: string,
): AgentRuntimeSettings {
  const settings = { ...base }

  // Apply model from agent definition or step override
  const model = modelOverride ?? agent.model
  if (model) {
    // Parse provider/model format
    const slashIdx = model.indexOf('/')
    if (slashIdx > 0) {
      settings.provider = model.slice(0, slashIdx)
      const rest = model.slice(slashIdx + 1)
      // Handle thinking suffix like "claude-sonnet-4:high"
      const colonIdx = rest.lastIndexOf(':')
      if (colonIdx > 0) {
        settings.modelId = rest.slice(0, colonIdx)
      } else {
        settings.modelId = rest
      }
    } else {
      settings.modelId = model
    }
  }

  // Override backend to pi-ai (subagents always run in-process)
  settings.backend = 'pi-ai'
  // Clear orchestration to prevent recursion
  settings.orchestration = 'none'

  return settings
}

// ---------------------------------------------------------------------------
// Event factories
// ---------------------------------------------------------------------------

function childStarted(parentRunId: string, childRunId: string, label: string): RuntimeEvent {
  return {
    type: 'child_run_started',
    schemaVersion: SV,
    producerVersion: PV,
    parentRunId,
    childRunId,
    label,
    ts: ts(),
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
    ts: ts(),
  } as RuntimeEvent
}

function stepStarted(runId: string, stepId: string, label: string, kind: string): RuntimeEvent {
  return {
    type: 'step_started',
    schemaVersion: SV,
    producerVersion: PV,
    runId,
    stepId,
    label,
    kind,
    ts: ts(),
  } as RuntimeEvent
}

function stepCompleted(runId: string, stepId: string, output: string): RuntimeEvent {
  return {
    type: 'step_completed',
    schemaVersion: SV,
    producerVersion: PV,
    runId,
    stepId,
    output,
    ts: ts(),
  } as RuntimeEvent
}

function failEvent(runId: string, code: string, message: string): RuntimeEvent {
  return {
    type: 'run_failed',
    schemaVersion: SV,
    producerVersion: PV,
    runId,
    error: { code, message },
    ts: ts(),
  } as RuntimeEvent
}
