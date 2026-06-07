import {
  streamPiAiRuntimeEvents,
  TELEGRAPH_PI_AI_PRODUCER_VERSION,
  type PiAiToolExecutionContext,
} from '@/packages/agent/runtime/streamPiAiRuntime'
import type { RuntimeEvent } from '@/packages/agent-protocol'
import type { TSchema } from '@mariozechner/pi-ai'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { BaseAgentRuntime, type RuntimeInput } from '@/packages/agent/runtime/AgentRuntime'
import type { RuntimeExecutableTool } from '@/packages/agent/runtime/AgentRuntime'
import type { AgentRuntimeSettings } from '@/packages/agent/types'

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
 * - Multi-agent delegation is owned by TelegraphSubagentHarness, not the base pi-ai runtime
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
        settings: toAgentRuntimeSettings(settings),
        message,
        messages: input.messages,
        signal,
        tools: input.tools?.map(toPiAiExecutableTool),
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

function toPiAiExecutableTool(tool: RuntimeExecutableTool) {
  return {
    name: tool.definition.name,
    description: tool.definition.description,
    parameters: tool.definition.inputSchema as TSchema,
    execute: (toolInput: Record<string, unknown>, context: PiAiToolExecutionContext) =>
      tool.execute(toolInput, context),
  }
}

function toAgentRuntimeSettings(settings: RuntimeInput['settings']): AgentRuntimeSettings {
  return {
    provider: settings.provider ?? '',
    modelId: settings.modelId ?? '',
    apiKey: settings.apiKey ?? '',
    authMode: settings.authMode,
    subscriptionProvider: settings.subscriptionProvider,
    subscriptionCredentials: settings.subscriptionCredentials,
    baseUrl: settings.baseUrl,
    backend: settings.backend as AgentRuntimeSettings['backend'],
    orchestration: settings.orchestration as AgentRuntimeSettings['orchestration'],
    orchestrationPattern: settings.orchestrationPattern as AgentRuntimeSettings['orchestrationPattern'],
    worktreeIsolation: settings.worktreeIsolation,
    extensionBlocklist: settings.extensionBlocklist,
    taskCapabilityProfile: settings.taskCapabilityProfile,
  }
}
