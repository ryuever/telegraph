import { describe, expect, it } from 'vitest'
import { SubagentRunner } from '../SubagentRunner'
import type { ChildRuntimeFactory } from '../SubagentRunner'
import type { RuntimeExecutor, RuntimeInput } from '@/packages/agent/runtime/AgentRuntime'
import type { RuntimeEvent, SubagentProfile } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION as V } from '@/packages/agent-protocol'

const profile: SubagentProfile = {
  name: 'explore',
  description: 'test profile',
  systemPrompt: 'sys',
}

/** Build a fake runtime that yields a fixed event sequence. */
function fakeRuntime(events: (input: RuntimeInput) => Iterable<RuntimeEvent>): RuntimeExecutor {
  return {
    id: 'fake',
    label: 'fake',
    async *run(input) {
      for (const ev of events(input)) yield ev
    },
  }
}

async function collect(stream: AsyncIterable<RuntimeEvent>): Promise<RuntimeEvent[]> {
  const out: RuntimeEvent[] = []
  for await (const ev of stream) out.push(ev)
  return out
}

describe('SubagentRunner', () => {
  it('wraps a clean child run with child_run_started + child_run_completed', async () => {
    const factory: ChildRuntimeFactory = () =>
      fakeRuntime(input => [
        { type: 'run_started', schemaVersion: V, runId: input.runId, ts: 1 },
        { type: 'assistant_message', schemaVersion: V, runId: input.runId, requestId: 'r1', message: { role: 'assistant', content: 'hi' } as never, ts: 2 },
        { type: 'run_completed', schemaVersion: V, runId: input.runId, output: { text: 'done' }, ts: 3 },
      ])

    const runner = new SubagentRunner({
      parentSettings: {},
      childRuntimeFactory: factory,
      now: () => 100,
    })

    const exec = runner.execute(
      { profileName: 'explore', prompt: 'go', parentRunId: 'parent-1' },
      profile,
    )
    const events = await collect(exec.stream)

    expect(events[0]).toMatchObject({
      type: 'child_run_started',
      parentRunId: 'parent-1',
      childRunId: exec.childRunId,
      label: 'explore',
    })
    expect(events.at(-1)).toMatchObject({
      type: 'child_run_completed',
      parentRunId: 'parent-1',
      childRunId: exec.childRunId,
      output: { text: 'done' },
    })

    const inner = events.slice(1, -1).map(e => e.type)
    expect(inner).toEqual(['run_started', 'assistant_message', 'run_completed'])
  })

  it('preserves child event ts (no rewriting)', async () => {
    const factory: ChildRuntimeFactory = () =>
      fakeRuntime(input => [
        { type: 'run_started', schemaVersion: V, runId: input.runId, ts: 42 },
        { type: 'run_completed', schemaVersion: V, runId: input.runId, output: null, ts: 43 },
      ])
    const runner = new SubagentRunner({
      parentSettings: {},
      childRuntimeFactory: factory,
      now: () => 999,
    })
    const exec = runner.execute(
      { profileName: 'explore', prompt: 'go', parentRunId: 'p' },
      profile,
    )
    const events = await collect(exec.stream)
    // child_run_started uses runner clock (999); inner events keep child ts (42, 43)
    expect(events[0].ts).toBe(999)
    expect(events[1].ts).toBe(42)
    expect(events[2].ts).toBe(43)
    expect(events[3].ts).toBe(999)
  })

  it('emits run_failed envelope + child_run_completed when child runtime throws mid-stream', async () => {
    const factory: ChildRuntimeFactory = () => ({
      id: 'fake',
      label: 'fake',
      // eslint-disable-next-line require-yield
      async *run(input) {
        yield { type: 'run_started', schemaVersion: V, runId: input.runId, ts: 1 } as RuntimeEvent
        throw new Error('boom')
      },
    })
    const runner = new SubagentRunner({
      parentSettings: {},
      childRuntimeFactory: factory,
      now: () => 7,
    })
    const exec = runner.execute(
      { profileName: 'explore', prompt: 'go', parentRunId: 'p' },
      profile,
    )
    const events = await collect(exec.stream)
    const types = events.map(e => e.type)
    expect(types).toContain('run_failed')
    expect(types.at(-1)).toBe('child_run_completed')
    const completed = events.at(-1) as { type: 'child_run_completed'; output: unknown }
    expect(completed.output).toMatchObject({ aborted: false, kind: 'failed' })
  })

  it('honors AbortSignal via invocation.signal', async () => {
    const controller = new AbortController()
    let observed: AbortSignal | undefined
    const factory: ChildRuntimeFactory = () => ({
      id: 'fake',
      label: 'fake',
      async *run(input) {
        observed = input.signal
        yield { type: 'run_started', schemaVersion: V, runId: input.runId, ts: 1 } as RuntimeEvent
        yield { type: 'run_completed', schemaVersion: V, runId: input.runId, output: null, ts: 2 } as RuntimeEvent
      },
    })
    const runner = new SubagentRunner({
      parentSettings: {},
      childRuntimeFactory: factory,
      now: () => 1,
    })
    const exec = runner.execute(
      { profileName: 'explore', prompt: 'go', parentRunId: 'p', signal: controller.signal },
      profile,
    )
    controller.abort('caller-abort')
    await collect(exec.stream)
    expect(observed?.aborted).toBe(true)
  })

  it('hard-aborts on turnBudget + graceTurns exhaustion', async () => {
    const factory: ChildRuntimeFactory = () => ({
      id: 'fake',
      label: 'fake',
      async *run(input) {
        yield { type: 'run_started', schemaVersion: V, runId: input.runId, ts: 1 } as RuntimeEvent
        // Emit 4 assistant_message turns. turnBudget=2, graceTurns=1 → at turn 3 the runner aborts.
        for (let i = 1; i <= 4; i++) {
          if (input.signal?.aborted) break
          yield {
            type: 'assistant_message',
            schemaVersion: V,
            runId: input.runId,
            requestId: `r${i}`,
            message: { role: 'assistant', content: `t${i}` } as never,
            ts: 10 + i,
          } as RuntimeEvent
        }
        if (input.signal?.aborted) {
          yield { type: 'run_cancelled', schemaVersion: V, runId: input.runId, reason: 'budget-exceeded', ts: 99 } as RuntimeEvent
        } else {
          yield { type: 'run_completed', schemaVersion: V, runId: input.runId, output: null, ts: 99 } as RuntimeEvent
        }
      },
    })
    const runner = new SubagentRunner({
      parentSettings: {},
      childRuntimeFactory: factory,
      now: () => 1,
    })
    const exec = runner.execute(
      { profileName: 'explore', prompt: 'go', parentRunId: 'p' },
      { ...profile, turnBudget: 2, graceTurns: 1 },
    )
    const events = await collect(exec.stream)
    const types = events.map(e => e.type)
    expect(types).toContain('run_cancelled')
    expect(types.at(-1)).toBe('child_run_completed')
  })
})
