import { streamPiAiRuntimeEvents, TELEGRAPH_PI_AI_PRODUCER_VERSION } from '@telegraph/agent/runtime/streamPiAiRuntime'
import type { RuntimeEvent } from '@telegraph/runtime-contracts'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@telegraph/runtime-contracts'
import { BaseAgentRuntime, type RuntimeInput } from '@telegraph/agent/runtime/AgentRuntime'

/**
 * Pi-AI runtime executor.
 * Uses pi-ai's in-process streaming to execute agent runs.
 * Implements the RuntimeExecutor interface for unified adapter pattern.
 * 
 * Advantages:
 * - Fast in-process execution
 * - Direct access to Context and Messages
 * - Can implement embedded tool loop
 * 
 * Limitations:
 * - No built-in extension loading (unlike pi-cli)
 * - Limited orchestration support (pi-subagents requires cli)
 */
export class PiAiRuntime extends BaseAgentRuntime {
  readonly id = 'pi-ai'
  readonly label = 'Pi AI (In-Process)'

  async *run(input: RuntimeInput): AsyncIterable<RuntimeEvent> {
    const { runId, sessionId, message, settings, signal } = input

    // Emit run_started event
    yield {
      type: 'run_started',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      producerVersion: TELEGRAPH_PI_AI_PRODUCER_VERSION,
      runId,
      ts: this.now(),
      pattern: 'single_llm',
      origin: {
        framework: 'pi',
        runtimeId: 'pi-ai',
      },
    } as RuntimeEvent

    try {
      // Stream all pi-ai events through the adapter
      for await (const ev of streamPiAiRuntimeEvents({
        runId,
        settings: settings as any, // TODO: type alignment between RuntimeSettings and AgentRuntimeSettings
        message,
        signal,
      })) {
        yield ev

        // If stream ended with error, stop iteration
        if (ev.type === 'run_failed' || ev.type === 'run_completed') {
          break
        }
      }
    } catch (error) {
      // Emit run_failed instead of throwing
      yield {
        type: 'run_failed',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        producerVersion: TELEGRAPH_PI_AI_PRODUCER_VERSION,
        runId,
        error: {
          code: 'pi_ai_runtime_error',
          message: error instanceof Error ? error.message : String(error),
          details: error,
        },
        ts: this.now(),
      } as RuntimeEvent
    }
  }
}
