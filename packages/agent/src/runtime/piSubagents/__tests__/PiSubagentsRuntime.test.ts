import type { RuntimeEvent, RuntimeSettings } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { streamPiAiRuntimeEvents } from '../../streamPiAiRuntime'
import { discoverAgents } from '../agentDiscovery'
import { PiSubagentsRuntime } from '../PiSubagentsRuntime'

vi.mock('../../streamPiAiRuntime', () => ({
  streamPiAiRuntimeEvents: vi.fn(),
}))

const streamMock = vi.mocked(streamPiAiRuntimeEvents)
const SV = RUNTIME_CONTRACT_SCHEMA_VERSION

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of iterable) result.push(item)
  return result
}

function settings(overrides: Partial<RuntimeSettings> = {}): RuntimeSettings {
  return {
    provider: 'minimax-cn',
    modelId: 'MiniMax-M2.7',
    apiKey: 'test-key',
    orchestration: 'pi-subagents',
    orchestrationPattern: 'chain',
    ...overrides,
  }
}

function runtimeInput(overrides: Partial<Parameters<PiSubagentsRuntime['run']>[0]> = {}) {
  return {
    runId: 'run-subagents-test',
    sessionId: 'session-subagents-test',
    message: 'Build the smallest useful pi-subagents MVP',
    settings: settings(),
    ...overrides,
  }
}

function mockChildSuccess(): void {
  streamMock.mockImplementation(async function* ({ runId }) {
    yield {
      type: 'assistant_delta',
      schemaVersion: SV,
      producerVersion: 'test-pi-ai@0.0.0',
      runId,
      requestId: `req-${runId}`,
      text: `output from ${runId}`,
      ts: Date.now(),
    } satisfies RuntimeEvent
    yield {
      type: 'run_completed',
      schemaVersion: SV,
      producerVersion: 'test-pi-ai@0.0.0',
      runId,
      output: { text: `output from ${runId}` },
      ts: Date.now(),
    } satisfies RuntimeEvent
    return undefined
  })
}

function mockChildFailure(): void {
  streamMock.mockImplementation(async function* ({ runId }) {
    yield {
      type: 'assistant_delta',
      schemaVersion: SV,
      producerVersion: 'test-pi-ai@0.0.0',
      runId,
      requestId: `req-${runId}`,
      text: 'partial child output',
      ts: Date.now(),
    } satisfies RuntimeEvent
    yield {
      type: 'run_failed',
      schemaVersion: SV,
      producerVersion: 'test-pi-ai@0.0.0',
      runId,
      error: {
        code: 'child_failed',
        message: `child failed: ${runId}`,
      },
      ts: Date.now(),
    } satisfies RuntimeEvent
    return undefined
  })
}

describe('PiSubagentsRuntime', () => {
  beforeEach(() => {
    streamMock.mockReset()
  })

  it('discovers Telegraph fallback agents without a pi-subagents package install', () => {
    const agents = discoverAgents({
      scopes: ['builtin'],
      piSubagentsRoot: `/tmp/telegraph-missing-pi-subagents-${String(process.pid)}`,
    })

    expect([...agents.keys()]).toEqual(
      expect.arrayContaining(['scout', 'planner', 'worker', 'reviewer']),
    )
    expect(agents.get('scout')?.sourcePath).toContain('telegraph://pi-subagents/builtin')
  })

  it('runs the default chain through fallback subagents and completes the parent run', async () => {
    mockChildSuccess()

    const runtime = new PiSubagentsRuntime()
    const events = await collect(runtime.run(runtimeInput()))

    expect(events[0]).toMatchObject({
      type: 'run_started',
      runId: 'run-subagents-test',
      pattern: 'prompt_chain',
    })
    expect(events.at(-1)).toMatchObject({
      type: 'run_completed',
      runId: 'run-subagents-test',
      output: { mode: 'chain' },
    })
    expect(events.filter(event => event.type === 'assistant_delta' && event.runId === 'run-subagents-test'))
      .toEqual([
        expect.objectContaining({
          text: 'output from run-subagents-test-chain-3-reviewer',
        }),
      ])
    expect(events.filter(event => event.type === 'child_run_started').map(event => event.label))
      .toEqual(['scout', 'planner', 'worker', 'reviewer'])
    expect(streamMock).toHaveBeenCalledTimes(4)
  })

  it('converts child run failure into a parent terminal run_failed event', async () => {
    mockChildFailure()

    const runtime = new PiSubagentsRuntime()
    const events = await collect(runtime.run(runtimeInput()))

    expect(events.some(event => event.type === 'run_failed' && event.runId !== 'run-subagents-test'))
      .toBe(true)
    expect(events.at(-1)).toMatchObject({
      type: 'run_failed',
      runId: 'run-subagents-test',
      error: {
        code: 'pi_subagents_child_failed',
      },
    })
    expect(events.some(event => event.type === 'run_completed' && event.runId === 'run-subagents-test'))
      .toBe(false)
    expect(streamMock).toHaveBeenCalledTimes(1)
  })

  it('fails before spawning child runs when pi-subagents is blocklisted', async () => {
    mockChildSuccess()

    const runtime = new PiSubagentsRuntime()
    const events = await collect(runtime.run(runtimeInput({
      settings: settings({ extensionBlocklist: ['pi-subagents'] }),
    })))

    expect(events).toHaveLength(2)
    expect(events.at(-1)).toMatchObject({
      type: 'run_failed',
      runId: 'run-subagents-test',
      error: {
        code: 'pi_subagents_blocked',
      },
    })
    expect(streamMock).not.toHaveBeenCalled()
  })
})
