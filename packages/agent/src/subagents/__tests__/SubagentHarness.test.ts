import { describe, expect, it } from 'vitest'
import { SubagentHarness } from '../SubagentHarness'
import { SubagentRegistry } from '../SubagentRegistry'
import type { ChildRuntimeFactory } from '../SubagentRunner'
import type { RuntimeExecutor } from '@/packages/agent/runtime/AgentRuntime'
import type { RuntimeEvent, SubagentProfile } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION as V } from '@/packages/agent-protocol'

const profile: SubagentProfile = {
  name: 'explore',
  description: 'test',
  systemPrompt: 'sys',
}

function quickRuntime(output: unknown = { ok: true }): RuntimeExecutor {
  return {
    id: 'quick',
    label: 'quick',
    async *run(input) {
      yield { type: 'run_started', schemaVersion: V, runId: input.runId, ts: 1 } as RuntimeEvent
      yield { type: 'run_completed', schemaVersion: V, runId: input.runId, output, ts: 2 } as RuntimeEvent
    },
  }
}

function slowRuntime(delayMs: number): RuntimeExecutor {
  return {
    id: 'slow',
    label: 'slow',
    async *run(input) {
      yield { type: 'run_started', schemaVersion: V, runId: input.runId, ts: 1 } as RuntimeEvent
      await new Promise(r => setTimeout(r, delayMs))
      if (input.signal?.aborted) {
        yield { type: 'run_cancelled', schemaVersion: V, runId: input.runId, reason: 'aborted', ts: 2 } as RuntimeEvent
      } else {
        yield { type: 'run_completed', schemaVersion: V, runId: input.runId, output: 'done', ts: 2 } as RuntimeEvent
      }
    },
  }
}

describe('SubagentHarness', () => {
  it('spawnAndWait resolves with completed record', async () => {
    const registry = new SubagentRegistry()
    registry.register(profile)
    const factory: ChildRuntimeFactory = () => quickRuntime({ text: 'hello' })
    const harness = new SubagentHarness({ registry, childRuntimeFactory: factory })

    const record = await harness.spawnAndWait({
      profileName: 'explore',
      prompt: 'go',
      parentRunId: 'parent-1',
    })
    expect(record.status).toBe('completed')
    expect(record.output).toEqual({ text: 'hello' })
    expect(record.childRunId).toMatch(/^parent-1\.sub-/)
    expect(record.startedAt).toBeDefined()
    expect(record.finishedAt).toBeDefined()
  })

  it('throws on unknown profile name (sync via spawn)', () => {
    const registry = new SubagentRegistry()
    const harness = new SubagentHarness({ registry, childRuntimeFactory: () => quickRuntime() })
    expect(() => harness.spawn({ profileName: 'ghost', prompt: '', parentRunId: 'p' })).toThrow(/Unknown subagent/)
  })

  it('rejects on unknown profile name (async via spawnAndWait)', async () => {
    const registry = new SubagentRegistry()
    const harness = new SubagentHarness({ registry, childRuntimeFactory: () => quickRuntime() })
    await expect(
      harness.spawnAndWait({ profileName: 'ghost', prompt: '', parentRunId: 'p' }),
    ).rejects.toThrow(/Unknown subagent/)
  })

  it('forwards events via onEvent callback', async () => {
    const registry = new SubagentRegistry()
    registry.register(profile)
    const seen: string[] = []
    const harness = new SubagentHarness({
      registry,
      childRuntimeFactory: () => quickRuntime(),
      onEvent: (ev) => seen.push(ev.type),
    })
    await harness.spawnAndWait({ profileName: 'explore', prompt: 'go', parentRunId: 'p' })
    expect(seen[0]).toBe('child_run_started')
    expect(seen).toContain('run_started')
    expect(seen).toContain('run_completed')
    expect(seen.at(-1)).toBe('child_run_completed')
  })

  it('enforces maxConcurrency', async () => {
    const registry = new SubagentRegistry()
    registry.register(profile)
    let activeCount = 0
    let peak = 0
    const factory: ChildRuntimeFactory = () => ({
      id: 'q',
      label: 'q',
      async *run(input) {
        activeCount++
        peak = Math.max(peak, activeCount)
        yield { type: 'run_started', schemaVersion: V, runId: input.runId, ts: 1 } as RuntimeEvent
        await new Promise(r => setTimeout(r, 20))
        yield { type: 'run_completed', schemaVersion: V, runId: input.runId, output: null, ts: 2 } as RuntimeEvent
        activeCount--
      },
    })
    const harness = new SubagentHarness(
      { registry, childRuntimeFactory: factory },
      { maxConcurrency: 2 },
    )
    const promises = Array.from({ length: 5 }, (_, i) =>
      harness.spawnAndWait({ profileName: 'explore', prompt: `q${i}`, parentRunId: 'p' }),
    )
    await Promise.all(promises)
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('abort cancels a running subagent', async () => {
    const registry = new SubagentRegistry()
    registry.register(profile)
    const harness = new SubagentHarness({ registry, childRuntimeFactory: () => slowRuntime(50) })
    const record = harness.spawn({ profileName: 'explore', prompt: 'q', parentRunId: 'p' })
    // Give pump a tick to dequeue and mark running.
    await new Promise(r => setTimeout(r, 5))
    expect(harness.abort(record.invocationId, 'caller-abort')).toBe(true)
    // Wait for drain to finalize.
    await new Promise(r => setTimeout(r, 80))
    const finalRecord = harness.getRecord(record.invocationId)
    expect(finalRecord?.status).toBe('cancelled')
  })

  it('abort returns false for unknown invocation id', () => {
    const registry = new SubagentRegistry()
    const harness = new SubagentHarness({ registry, childRuntimeFactory: () => quickRuntime() })
    expect(harness.abort('nope')).toBe(false)
  })

  it('abortAll cancels both queued and active subagents', async () => {
    const registry = new SubagentRegistry()
    registry.register(profile)
    const harness = new SubagentHarness(
      { registry, childRuntimeFactory: () => slowRuntime(50) },
      { maxConcurrency: 1 },
    )
    const r1 = harness.spawn({ profileName: 'explore', prompt: '1', parentRunId: 'p' })
    const r2 = harness.spawn({ profileName: 'explore', prompt: '2', parentRunId: 'p' })
    await new Promise(r => setTimeout(r, 5))
    harness.abortAll('parent-abort')
    await new Promise(r => setTimeout(r, 80))
    expect(harness.getRecord(r1.invocationId)?.status).toBe('cancelled')
    expect(harness.getRecord(r2.invocationId)?.status).toBe('cancelled')
  })

  it('detach joinMode resolves immediately without awaiting completion', async () => {
    const registry = new SubagentRegistry()
    registry.register(profile)
    const harness = new SubagentHarness({ registry, childRuntimeFactory: () => slowRuntime(100) })
    const t0 = Date.now()
    const record = await harness.spawnAndWait({
      profileName: 'explore',
      prompt: 'q',
      parentRunId: 'p',
      joinMode: 'detach',
    })
    const elapsed = Date.now() - t0
    // Resolved well before the 100ms slow runtime would finish — that's the
    // detach contract. The record may be 'queued' or already 'running'
    // depending on microtask timing, but it must NOT be terminal yet.
    expect(elapsed).toBeLessThan(50)
    expect(['queued', 'running']).toContain(record.status)
    expect(record.finishedAt).toBeUndefined()
  })
})
