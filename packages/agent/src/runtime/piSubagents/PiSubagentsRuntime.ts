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
    const origin = {
      framework: 'pi' as const,
      runtimeId: 'pi-subagents-embedded',
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
      if (agentSettings.extensionBlocklist?.includes('pi-subagents')) {
        yield {
          type: 'run_failed',
          schemaVersion: SV,
          producerVersion: PV,
          origin,
          runId,
          error: {
            code: 'pi_subagents_blocked',
            message: 'pi-subagents orchestration is blocked for this run',
          },
          ts: Date.now(),
        } as RuntimeEvent
        return
      }

      // Parse the orchestration input from the user message + settings
      const orchInput = parseOrchestratorInput(message, pattern)
      let childFailure: Extract<RuntimeEvent, { type: 'run_failed' }> | undefined
      const childOutputs: string[] = []

      // Run the orchestrator
      for await (const ev of orchestrate(orchInput, {
        runId,
        sessionId,
        settings: agentSettings,
        signal,
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
            code: 'pi_subagents_child_failed',
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

      const finalText = formatFinalOutput(orchInput.mode, childOutputs)
      if (finalText) {
        yield {
          type: 'assistant_delta',
          schemaVersion: SV,
          producerVersion: PV,
          origin,
          runId,
          requestId: this.generateRequestId(runId),
          text: finalText,
          ts: Date.now(),
          raw: { source: 'pi-subagents-final-output', mode: orchInput.mode },
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
          code: 'pi_subagents_runtime_error',
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
