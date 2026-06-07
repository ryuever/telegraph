import type { AgentEvent, AgentRunRequest } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { describe, expect, it } from 'vitest'
import { createAgentHarness, selectRuntimeId } from '../AgentHarness'
import type { RuntimeExecutor, RuntimeInput } from '@/packages/agent/runtime/AgentRuntime'
import type { AgentCapability } from '@/packages/agent-capabilities'
import { InMemoryAgentSessionStore } from '../AgentSessionStore'

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
  lastInput?: RuntimeInput

  async *run(input: RuntimeInput): AsyncIterable<AgentEvent> {
    this.lastInput = input
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

  it('selects Telegraph native subagents when orchestration requests it', () => {
    expect(selectRuntimeId({ orchestration: 'telegraph-subagents' })).toBe('telegraph-subagents')
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

  it('continues same-session runs with transcript messages', async () => {
    const runtime = new FakeRuntime()
    const sessionStore = new InMemoryAgentSessionStore()
    const harness = createAgentHarness({
      runtimes: [{ id: 'fake', create: () => runtime }],
      sessionStore,
    })

    await collect(harness.run({
      ...baseRequest,
      runId: 'run-session-first',
      messages: [{ id: 'm-first', role: 'user', content: 'first prompt' }],
    }))
    await collect(harness.run({
      ...baseRequest,
      runId: 'run-session-second',
      messages: [{ id: 'm-second', role: 'user', content: 'second prompt' }],
    }))

    expect(runtime.lastInput?.message).toBe('second prompt')
    expect(runtime.lastInput?.messages?.map(message => [message.role, message.content])).toEqual([
      ['user', 'first prompt'],
      ['assistant', 'first prompt'],
      ['user', 'second prompt'],
    ])
    expect(sessionStore.getMessages(baseRequest.sessionId).map(message => [message.role, message.content])).toEqual([
      ['user', 'first prompt'],
      ['assistant', 'first prompt'],
      ['user', 'second prompt'],
      ['assistant', 'second prompt'],
    ])
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

  it('passes registered tool capabilities into runtime input', async () => {
    const runtime = new FakeRuntime()
    const capability: AgentCapability = ({ host }) => {
      host.registerTool({
        definition: {
          name: 'test.echo',
          description: 'Echo test input',
          inputSchema: {
            type: 'object',
          },
        },
        execute: input => Promise.resolve({ input }),
      })
    }
    const harness = createAgentHarness({
      runtimes: [{ id: 'fake', create: () => runtime }],
      capabilities: [capability],
    })

    await collect(harness.run(baseRequest))

    expect(runtime.lastInput?.tools).toHaveLength(1)
    expect(runtime.lastInput?.tools?.[0]?.definition.name).toBe('test.echo')
    await expect(runtime.lastInput?.tools?.[0]?.execute({ ok: true }, {
      runId: baseRequest.runId,
      sessionId: baseRequest.sessionId,
      callId: 'call-test',
      toolName: 'test.echo',
    })).resolves.toEqual({ input: { ok: true } })
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
