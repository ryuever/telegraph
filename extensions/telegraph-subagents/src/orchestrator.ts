/**
 * Telegraph native subagent orchestrator.
 *
 * The orchestrator chooses the child-run shape (single / chain / parallel), but
 * child execution is delegated to SubagentManager. This keeps lifecycle state
 * out of the workflow helpers and makes room for foreground/background/result
 * controls without turning the runtime into a natural-language parser.
 */

import type { RuntimeEvent } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import type { AgentRuntimeSettings } from '@/packages/agent/types'
import type {
  SubagentChainStep,
  SubagentChildResult,
  SubagentDefinition,
  SubagentOrchestratorInput,
  SubagentParallelTask,
} from './types'
import { discoverAgents } from './agentDiscovery'
import { SubagentManager } from './SubagentManager'

import { TELEGRAPH_SUBAGENTS_PRODUCER_VERSION } from './constants'
export { TELEGRAPH_SUBAGENTS_PRODUCER_VERSION }

const SV = RUNTIME_CONTRACT_SCHEMA_VERSION
const PV = TELEGRAPH_SUBAGENTS_PRODUCER_VERSION

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
  /** Stateful child-run manager. Defaults to a fresh manager for this orchestration. */
  manager?: SubagentManager
}

type ManagedOptions = OrchestratorOptions & { manager: SubagentManager }

/**
 * Execute a subagent orchestration plan and yield all RuntimeEvents.
 */
export async function* orchestrate(
  input: SubagentOrchestratorInput,
  opts: OrchestratorOptions,
): AsyncGenerator<RuntimeEvent> {
  const agents = opts.agents ?? discoverAgents({ cwd: process.cwd() })
  const manager = opts.manager ?? new SubagentManager({ maxConcurrent: input.concurrency })
  const managedOpts: ManagedOptions = { ...opts, manager }

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
      yield* runSingleAgent(def, input.task, managedOpts)
      return
    }

    case 'chain': {
      if (!input.chain?.length) {
        yield failEvent(opts.runId, 'empty_chain', 'Chain mode requires at least one step')
        return
      }
      yield* runChain(input.chain, input.task, agents, managedOpts)
      return
    }

    case 'parallel': {
      if (!input.tasks?.length) {
        yield failEvent(opts.runId, 'empty_parallel', 'Parallel mode requires at least one task')
        return
      }
      yield* runParallel(input.tasks, input.task, agents, managedOpts, input.concurrency)
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
  opts: ManagedOptions,
): AsyncGenerator<RuntimeEvent> {
  yield* opts.manager.spawnAndWait({
    parentRunId: opts.runId,
    childRunId: `${opts.runId}-${agent.name}`,
    label: agent.name,
    agent,
    task,
    settings: opts.settings,
    sessionId: opts.sessionId,
    signal: opts.signal,
  })
}

// ---------------------------------------------------------------------------
// Chain execution
// ---------------------------------------------------------------------------

async function* runChain(
  steps: SubagentChainStep[],
  originalTask: string,
  agents: Map<string, SubagentDefinition>,
  opts: ManagedOptions,
): AsyncGenerator<RuntimeEvent> {
  let previousOutput = ''

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    const stepId = `${opts.runId}-step-${i}`

    if (opts.signal?.aborted) {
      yield failEvent(opts.runId, 'chain_cancelled', 'Chain was cancelled')
      return
    }

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
        const result = childResultFromEvent(ev)
        if (result) parallelResults.push(result)
      }

      previousOutput = aggregateParallelOutputs(parallelResults)
      yield stepCompleted(opts.runId, stepId, previousOutput)
      continue
    }

    const agentDef = agents.get(step.agent)
    if (!agentDef) {
      yield failEvent(opts.runId, 'agent_not_found', `Chain step ${i}: agent "${step.agent}" not found`)
      return
    }

    yield stepStarted(opts.runId, stepId, `${step.agent} (step ${i + 1}/${steps.length})`, 'worker')

    const task = applyTemplateVars(step.task ?? '{previous}', originalTask, previousOutput)
    const childRunId = `${opts.runId}-chain-${i}-${step.agent}`
    let childText = ''

    for await (const ev of opts.manager.spawnAndWait({
      parentRunId: opts.runId,
      childRunId,
      label: step.agent,
      agent: agentDef,
      task,
      settings: opts.settings,
      sessionId: opts.sessionId,
      signal: opts.signal,
      skills: step.skills,
      modelOverride: step.model,
    })) {
      if (ev.type === 'assistant_delta' && ev.runId === childRunId) {
        childText += ev.text
      }
      yield ev
      if (ev.type === 'run_failed' && ev.runId === childRunId) {
        yield stepCompleted(opts.runId, stepId, childText)
        return
      }
    }

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
  opts: ManagedOptions,
  concurrency: number = 4,
): AsyncGenerator<RuntimeEvent> {
  const expanded: Array<{ agent: string; label?: string; task: string; model?: string; skills?: string[] }> = []
  for (const t of tasks) {
    const count = t.count ?? 1
    for (let i = 0; i < count; i++) {
      expanded.push({
        agent: t.agent,
        label: t.label,
        task: t.task ?? fallbackTask,
        model: t.model,
        skills: t.skills,
      })
    }
  }

  opts.manager.setMaxConcurrent(concurrency)
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
    for await (const ev of opts.manager.spawnAndWait({
      parentRunId: opts.runId,
      childRunId,
      label: childLabel,
      agent: agentDef,
      task: t.task,
      settings: opts.settings,
      sessionId: opts.sessionId,
      signal: opts.signal,
      modelOverride: t.model,
      skills: t.skills,
    })) {
      allChildEvents[idx].push(ev)
    }
  }

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

  for (const events of allChildEvents) {
    for (const ev of events) {
      yield ev
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function childResultFromEvent(event: RuntimeEvent): SubagentChildResult | undefined {
  if (event.type !== 'child_run_completed') return undefined
  const output = event.output
  const text = typeof output === 'object' && output !== null && typeof (output as { text?: unknown }).text === 'string'
    ? (output as { text: string }).text
    : typeof output === 'string'
      ? output
      : JSON.stringify(output)
  return {
    agent: (event as { label?: string }).label ?? 'unknown',
    childRunId: event.childRunId,
    text,
    exitCode: typeof output === 'object' && output !== null && typeof (output as { exitCode?: unknown }).exitCode === 'number'
      ? (output as { exitCode: number }).exitCode
      : 0,
    durationMs: typeof output === 'object' && output !== null && typeof (output as { durationMs?: unknown }).durationMs === 'number'
      ? (output as { durationMs: number }).durationMs
      : 0,
  }
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
    ts: now(),
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
