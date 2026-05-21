import { RUNTIME_CONTRACT_SCHEMA_VERSION, type RuntimeEvent } from '@/packages/agent-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DESIGN_BUILD_CHILD_PROFILES } from '../DesignBuildChildContracts'

type MockStreamPiAiRuntimeEvents = (opts: {
  runId: string
  settings: unknown
  message: string
  systemPrompt?: string
  signal?: AbortSignal
  maxToolIterations?: number
}) => AsyncGenerator<RuntimeEvent, unknown, void>

const streamPiAiRuntimeEvents = vi.hoisted(() => vi.fn<MockStreamPiAiRuntimeEvents>())

vi.mock('@/packages/agent/runtime/streamPiAiRuntime', () => ({
  streamPiAiRuntimeEvents,
}))

describe('ModelBackedDesignBuildChildRunner model path', () => {
  afterEach(() => {
    streamPiAiRuntimeEvents.mockReset()
  })

  it('calls the pi-ai runtime stream and parses JSON model output', async () => {
    streamPiAiRuntimeEvents.mockImplementation(async function* () {
      await Promise.resolve()
      yield {
        type: 'assistant_delta',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        producerVersion: 'test',
        runId: 'run-1:worker',
        requestId: 'req-1',
        text: '{"artifactId":"model-artifact"}',
        ts: 1,
      }
      yield {
        type: 'run_completed',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        producerVersion: 'test',
        runId: 'run-1:worker',
        output: {
          role: 'assistant',
          content: '{"artifactId":"model-artifact"}',
        },
        ts: 2,
      }
    })

    const { ModelBackedDesignBuildChildRunner } = await import('../DesignBuildChildRunner')
    const runner = new ModelBackedDesignBuildChildRunner()

    await expect(runner.runChild({
      parentRunId: 'run-1',
      childRunId: 'run-1:worker',
      profileId: DESIGN_BUILD_CHILD_PROFILES.worker,
      stage: 'code-artifact',
      label: 'Design Worker',
      input: { artifactId: 'artifact-1' },
      modelInput: { artifactId: 'model-input-artifact' },
      settings: {
        provider: 'openai',
        modelId: 'gpt-test',
        apiKey: 'test-key',
      },
    })).resolves.toEqual({
      output: { artifactId: 'model-artifact' },
      source: 'model-backed',
    })

    const request = streamPiAiRuntimeEvents.mock.calls[0][0]
    expect(request.runId).toBe('run-1:worker')
    expect(request.settings).toEqual(expect.objectContaining({
      provider: 'openai',
      modelId: 'gpt-test',
      apiKey: 'test-key',
    }))
    expect(request.maxToolIterations).toBe(0)
    expect(JSON.parse(request.message) as { input: unknown }).toEqual(expect.objectContaining({
      input: { artifactId: 'model-input-artifact' },
    }))
  })
})
