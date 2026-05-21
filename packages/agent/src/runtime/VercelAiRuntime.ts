import type { RuntimeEvent } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { BaseAgentRuntime, type RuntimeInput } from './AgentRuntime'

export const TELEGRAPH_VERCEL_AI_PRODUCER_VERSION = '0.1.0'

export interface VercelAiConfig {
  model?: unknown
  modelName?: string
  temperature?: number
  maxTokens?: number
  topP?: number
  timeout?: number
  systemPrompt?: string
}

export class VercelAiRuntime extends BaseAgentRuntime {
  readonly id = 'vercel-ai'
  readonly label = 'Vercel AI SDK'

  async *run(input: RuntimeInput): AsyncIterable<RuntimeEvent> {
    yield {
      type: 'run_started',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      producerVersion: TELEGRAPH_VERCEL_AI_PRODUCER_VERSION,
      origin: {
        framework: 'ai-sdk',
        runtimeId: this.id,
      },
      runId: input.runId,
      ts: this.now(),
    }

    if (input.signal?.aborted) {
      yield {
        type: 'run_cancelled',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        producerVersion: TELEGRAPH_VERCEL_AI_PRODUCER_VERSION,
        origin: {
          framework: 'ai-sdk',
          runtimeId: this.id,
        },
        runId: input.runId,
        reason: 'Cancelled',
        ts: this.now(),
      }
      return
    }

    yield {
      type: 'run_failed',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      producerVersion: TELEGRAPH_VERCEL_AI_PRODUCER_VERSION,
      origin: {
        framework: 'ai-sdk',
        runtimeId: this.id,
      },
      runId: input.runId,
      error: {
        code: 'runtime_not_implemented',
        message: 'Vercel AI runtime is not wired to a real AI SDK model. Use pi-ai or implement the adapter before enabling vercel-ai.',
      },
      ts: this.now(),
    }
  }
}

export function createVercelAiRuntime(): VercelAiRuntime {
  return new VercelAiRuntime()
}
