import type { AgentEvent, AgentRunRequest } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { describe, expect, it } from 'vitest'
import { createAgentHarness, selectRuntimeId } from '../AgentHarness'
import type { RuntimeExecutor, RuntimeInput } from '@/packages/agent/runtime/AgentRuntime'

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of iterable) result.push(item)
  return result
}

const baseRequest: AgentRunRequest = {
  runId: 'run-harness-test',
  sessionId: 'session-harness-test',
  messages: [{ id: 'm-user', role: 'user', content: 'hello' }],
  settings: { backend: 'fake' },
}

class FakeRuntime implements RuntimeExecutor {
  readonly id = 'fake'
  readonly label = 'Fake Runtime'

  async *run(input: RuntimeInput): AsyncIterable<AgentEvent> {
    yield {
      type: 'run_started',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: input.runId,
      ts: Date.now(),
    }
    yield {
      type: 'assistant_delta',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: input.runId,
      requestId: `req-${input.runId}`,
      text: input.message,
      ts: Date.now(),
    }
    yield {
      type: 'run_completed',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: input.runId,
      output: { ok: true },
      ts: Date.now(),
    }
  }
}

describe('AgentHarness', () => {
  it('streams valid runtime events and ignores trace sink failures', async () => {
    const harness = createAgentHarness({
      runtimes: [{ id: 'fake', create: () => new FakeRuntime() }],
      traceSink: {
        push() {
          throw new Error('trace sink failure')
        },
      },
    })

    const events = await collect(harness.run(baseRequest))
    expect(events).toHaveLength(3)
    expect(events.at(-1)?.type).toBe('run_completed')
  })

  it('selects pi-subagents when orchestration requests it', () => {
    expect(selectRuntimeId({ orchestration: 'pi-subagents' })).toBe('pi-subagents')
  })
})
