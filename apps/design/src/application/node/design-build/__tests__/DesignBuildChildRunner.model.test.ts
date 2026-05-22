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
  tools?: unknown[]
}) => AsyncGenerator<RuntimeEvent, unknown, void>

const streamPiAiRuntimeEvents = vi.hoisted(() => vi.fn<MockStreamPiAiRuntimeEvents>())

vi.mock('@/packages/agent/runtime/streamPiAiRuntime', () => ({
  streamPiAiRuntimeEvents,
}))

describe('ModelBackedDesignBuildChildRunner model path', () => {
  afterEach(() => {
    streamPiAiRuntimeEvents.mockReset()
  })

  it('calls the pi-ai runtime stream and accepts structured tool output', async () => {
    streamPiAiRuntimeEvents.mockImplementation(async function* () {
      await Promise.resolve()
      yield submitToolCall({
        artifactId: 'model-artifact',
        kind: 'design-patch',
        title: 'Model artifact',
      })
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
      output: {
        artifactId: 'model-artifact',
        kind: 'design-patch',
        title: 'Model artifact',
      },
      source: 'model-backed',
    })

    const request = streamPiAiRuntimeEvents.mock.calls[0][0]
    expect(request.runId).toBe('run-1:worker')
    expect(request.settings).toEqual(expect.objectContaining({
      provider: 'openai',
      modelId: 'gpt-test',
      apiKey: 'test-key',
    }))
    expect(request.maxToolIterations).toBe(1)
    expect(request.tools).toEqual([
      expect.objectContaining({
        name: 'submit_design_child_output',
      }),
    ])
    expect(request.systemPrompt).toContain('submit_design_child_output')
    expect(JSON.parse(request.message) as { input: unknown }).toEqual(expect.objectContaining({
      input: { artifactId: 'model-input-artifact' },
    }))
  })

  it('fails when the model answers with text instead of the submit tool', async () => {
    streamPiAiRuntimeEvents.mockImplementation(async function* () {
      await Promise.resolve()
      yield {
        type: 'assistant_delta',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        producerVersion: 'test',
        runId: 'run-1:worker',
        requestId: 'req-1',
        text: 'I can help with that, but I need more details.',
        ts: 1,
      }
      yield {
        type: 'run_completed',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        producerVersion: 'test',
        runId: 'run-1:worker',
        output: {
          role: 'assistant',
          content: 'I can help with that, but I need more details.',
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
      input: { artifactId: 'deterministic-artifact' },
      settings: {
        provider: 'openai',
        modelId: 'gpt-test',
        apiKey: 'test-key',
      },
    })).rejects.toThrow('did not call submit_design_child_output')
  })

  it('validates review stage output shape', async () => {
    streamPiAiRuntimeEvents.mockImplementation(async function* () {
      await Promise.resolve()
      yield submitToolCall({
        review: {
          verdict: 'pass',
          checks: [{ id: 'artifact', passed: true, summary: 'ok' }],
        },
      })
    })

    const { ModelBackedDesignBuildChildRunner } = await import('../DesignBuildChildRunner')
    const runner = new ModelBackedDesignBuildChildRunner()

    await expect(runner.runChild({
      parentRunId: 'run-1',
      childRunId: 'run-1:reviewer',
      profileId: DESIGN_BUILD_CHILD_PROFILES.reviewer,
      stage: 'review',
      label: 'Design Reviewer',
      input: { review: { verdict: 'pass', checks: [] } },
      settings: {
        provider: 'openai',
        modelId: 'gpt-test',
        apiKey: 'test-key',
      },
    })).resolves.toEqual({
      output: {
        review: {
          verdict: 'pass',
          checks: [{ id: 'artifact', passed: true, summary: 'ok' }],
        },
      },
      source: 'model-backed',
    })
  })

  it('includes the resolved subagent profile prompt in the child system prompt', async () => {
    streamPiAiRuntimeEvents.mockImplementation(async function* () {
      await Promise.resolve()
      yield submitToolCall({
        review: {
          verdict: 'pass',
          checks: [{ id: 'profile-review', passed: true, summary: 'profile prompt used' }],
        },
      })
    })

    const { ModelBackedDesignBuildChildRunner } = await import('../DesignBuildChildRunner')
    const runner = new ModelBackedDesignBuildChildRunner()

    await runner.runChild({
      parentRunId: 'run-1',
      childRunId: 'run-1:reviewer',
      profileId: DESIGN_BUILD_CHILD_PROFILES.reviewer,
      stage: 'review',
      label: 'Design Reviewer',
      input: { review: { verdict: 'pass', checks: [] } },
      profile: {
        id: DESIGN_BUILD_CHILD_PROFILES.reviewer,
        title: 'Design Reviewer',
        description: 'Review design artifacts.',
        systemPrompt: 'Review the artifact for visual quality and patch safety.',
      },
      settings: {
        provider: 'openai',
        modelId: 'gpt-test',
        apiKey: 'test-key',
      },
    })

    const request = streamPiAiRuntimeEvents.mock.calls[0][0]
    expect(request.systemPrompt).toContain('Subagent profile: Design Reviewer')
    expect(request.systemPrompt).toContain('Review the artifact for visual quality and patch safety.')
    expect(request.systemPrompt).toContain('submit_design_child_output')
  })

  it('fails invalid stage output instead of accepting a malformed contract', async () => {
    streamPiAiRuntimeEvents.mockImplementation(async function* () {
      await Promise.resolve()
      yield submitToolCall({
        review: {
          verdict: 'maybe',
          checks: [],
        },
      })
    })

    const { ModelBackedDesignBuildChildRunner } = await import('../DesignBuildChildRunner')
    const runner = new ModelBackedDesignBuildChildRunner()

    await expect(runner.runChild({
      parentRunId: 'run-1',
      childRunId: 'run-1:reviewer',
      profileId: DESIGN_BUILD_CHILD_PROFILES.reviewer,
      stage: 'review',
      label: 'Design Reviewer',
      input: { review: { verdict: 'pass', checks: [] } },
      settings: {
        provider: 'openai',
        modelId: 'gpt-test',
        apiKey: 'test-key',
      },
    })).rejects.toThrow('review output requires a valid review object')
  })

  it('retries once with contract feedback when the submitted artifact is invalid', async () => {
    streamPiAiRuntimeEvents
      .mockImplementationOnce(async function* () {
        await Promise.resolve()
        yield submitToolCall({
          artifact: {
            kind: 'design-patch',
            title: 'Missing id and operations',
          },
        })
      })
      .mockImplementationOnce(async function* () {
        await Promise.resolve()
        yield submitToolCall({
          artifactId: 'model-artifact',
          kind: 'design-patch',
          title: 'Model artifact',
        })
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
      settings: {
        provider: 'openai',
        modelId: 'gpt-test',
        apiKey: 'test-key',
      },
    })).resolves.toEqual({
      output: {
        artifactId: 'model-artifact',
        kind: 'design-patch',
        title: 'Model artifact',
      },
      source: 'model-backed',
    })

    expect(streamPiAiRuntimeEvents).toHaveBeenCalledTimes(2)
    const retryRequest = streamPiAiRuntimeEvents.mock.calls[1][0]
    const retryPayload = JSON.parse(retryRequest.message) as { previousContractError?: { message?: unknown } }
    expect(retryPayload.previousContractError?.message)
      .toBe('code-artifact output contains an invalid artifact.')
  })
})

function submitToolCall(output: unknown): RuntimeEvent {
  return {
    type: 'tool_call',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: 'test',
    runId: 'run-1:worker',
    callId: 'call-submit',
    toolName: 'submit_design_child_output',
    input: { output },
    ts: 1,
  }
}
