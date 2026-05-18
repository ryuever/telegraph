import type { AgentEvent, AgentRunRequest } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { describe, expect, it } from 'vitest'
import { createAgentHarness, selectRuntimeId } from '../AgentHarness'
import type { RuntimeExecutor, RuntimeInput } from '@/packages/agent/runtime/AgentRuntime'
import type { AgentCapability } from '../CapabilityHost'

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
    await Promise.resolve()
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

  it('dispatches lifecycle hooks without blocking the run stream', async () => {
    const calls: string[] = []
    const harness = createAgentHarness({
      runtimes: [{ id: 'fake', create: () => new FakeRuntime() }],
      hooks: {
        beforeRun: () => {
          calls.push('beforeRun')
        },
        onRuntimeEvent: [
          (payload) => {
            const event = (payload as { event: AgentEvent }).event
            calls.push(`event:${event.type}`)
          },
          () => {
            throw new Error('hook failure')
          },
        ],
        afterRun: (payload) => {
          const terminalEvent = (payload as { terminalEvent?: AgentEvent }).terminalEvent
          calls.push(`afterRun:${terminalEvent ? terminalEvent.type : 'none'}`)
        },
      },
    })

    const events = await collect(harness.run(baseRequest))

    expect(events.at(-1)?.type).toBe('run_completed')
    expect(calls).toEqual([
      'beforeRun',
      'event:run_started',
      'event:assistant_delta',
      'event:run_completed',
      'afterRun:run_completed',
    ])
  })

  it('runs input hooks before constructing runtime input', async () => {
    const harness = createAgentHarness({
      runtimes: [{ id: 'fake', create: () => new FakeRuntime() }],
      hooks: {
        input: (event) => ({
          action: 'transform',
          text: `${event.text} transformed`,
          metadata: { transformed: true },
        }),
      },
    })

    const events = await collect(harness.run(baseRequest))

    expect(events.find(event => event.type === 'assistant_delta')).toMatchObject({
      text: 'hello transformed',
    })
  })

  it('lets capabilities register input hooks and feedback adapters', async () => {
    const capability: AgentCapability = ({ host }) => {
      host.registerFeedback({
        notify: () => {},
      })
      host.on('input', () => ({ action: 'transform', text: 'from capability' }))
    }

    const harness = createAgentHarness({
      runtimes: [{ id: 'fake', create: () => new FakeRuntime() }],
      capabilities: [capability],
    })

    const events = await collect(harness.run(baseRequest))

    expect(harness.capabilities.has('feedback')).toBe(true)
    expect(events.find(event => event.type === 'assistant_delta')).toMatchObject({
      text: 'from capability',
    })
  })

  it('turns input hook blocks into terminal run_failed events', async () => {
    const harness = createAgentHarness({
      runtimes: [{ id: 'fake', create: () => new FakeRuntime() }],
      hooks: {
        input: () => ({ action: 'block', reason: 'policy denied' }),
      },
    })

    const events = await collect(harness.run(baseRequest))

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      type: 'run_failed',
      error: {
        code: 'agent_harness_runtime_error',
        message: 'Input blocked: policy denied',
      },
    })
  })
})
