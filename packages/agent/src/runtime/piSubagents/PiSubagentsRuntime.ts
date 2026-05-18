/**
 * Pi-Subagents Runtime Executor.
 *
 * Implements the `RuntimeExecutor` interface for the pi-subagents
 * orchestration mode. Uses the embedded orchestrator to run
 * subagent workflows (single/chain/parallel) in-process via pi-ai,
 * without spawning external CLI processes.
 *
 * This runtime is selected when `settings.orchestration === 'pi-subagents'`
 * or `settings.backend === 'pi-subagents'`.
 */

import type { RuntimeEvent } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { BaseAgentRuntime, type RuntimeInput } from '../AgentRuntime'
import type { AgentRuntimeSettings } from '../../types'
import { orchestrate, TELEGRAPH_PI_SUBAGENTS_PRODUCER_VERSION } from './orchestrator'
import type { SubagentOrchestratorInput } from './types'

const SV = RUNTIME_CONTRACT_SCHEMA_VERSION
const PV = TELEGRAPH_PI_SUBAGENTS_PRODUCER_VERSION

export class PiSubagentsRuntime extends BaseAgentRuntime {
  readonly id = 'pi-subagents'
  readonly label = 'Pi Subagents (Embedded Orchestrator)'

  async *run(input: RuntimeInput): AsyncIterable<RuntimeEvent> {
    const { runId, sessionId, message, settings, signal } = input

    // Determine orchestration pattern from settings
    const agentSettings = settings as AgentRuntimeSettings
    const pattern = agentSettings.orchestrationPattern ?? 'chain'

    // Emit run_started
    yield {
      type: 'run_started',
      schemaVersion: SV,
      producerVersion: PV,
      runId,
      ts: Date.now(),
      pattern: pattern === 'parallel' ? 'parallelization' : 'prompt_chain',
      origin: {
        framework: 'pi',
        runtimeId: 'pi-subagents-embedded',
      },
    } as RuntimeEvent

    try {
      // Parse the orchestration input from the user message + settings
      const orchInput = parseOrchestratorInput(message, pattern)

      // Run the orchestrator
      for await (const ev of orchestrate(orchInput, {
        runId,
        sessionId,
        settings: agentSettings,
        signal,
      })) {
        yield ev

        // If we got a terminal event from the orchestrator, stop
        if (ev.type === 'run_failed' || ev.type === 'run_cancelled') {
          return
        }
      }

      // Emit run_completed
      yield {
        type: 'run_completed',
        schemaVersion: SV,
        producerVersion: PV,
        runId,
        output: { mode: orchInput.mode },
        ts: Date.now(),
      } as RuntimeEvent
    } catch (error) {
      yield {
        type: 'run_failed',
        schemaVersion: SV,
        producerVersion: PV,
        runId,
        error: {
          code: 'pi_subagents_runtime_error',
          message: error instanceof Error ? error.message : String(error),
          details: error,
        },
        ts: Date.now(),
      } as RuntimeEvent
    }
  }
}

// ---------------------------------------------------------------------------
// Input parsing
// ---------------------------------------------------------------------------

/**
 * Parse a user message into an orchestration input.
 *
 * Supports several formats:
 * 1. Default chain pattern: scout -> planner -> worker -> reviewer
 * 2. Default parallel pattern: parallel reviewers
 * 3. Plain task: dispatched to a default chain
 */
function parseOrchestratorInput(
  message: string,
  pattern: 'chain' | 'parallel',
): SubagentOrchestratorInput {
  if (pattern === 'parallel') {
    return {
      mode: 'parallel',
      task: message,
      tasks: [
        { agent: 'scout', task: message },
        { agent: 'planner', task: message },
        { agent: 'worker', task: message },
        { agent: 'reviewer', task: message },
      ],
      concurrency: 4,
    }
  }

  // Default chain: scout -> planner -> worker -> reviewer
  return {
    mode: 'chain',
    task: message,
    chain: [
      { agent: 'scout', task: '{task}' },
      { agent: 'planner', task: '{previous}' },
      { agent: 'worker', task: '{previous}' },
      { agent: 'reviewer', task: '{previous}' },
    ],
  }
}
