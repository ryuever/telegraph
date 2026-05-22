import type { RuntimeEvent } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import type { AgentRuntimeSettings } from '@/packages/agent/types'
import { describe, expect, it } from 'vitest'
import { SubagentManager } from '../SubagentManager'
import type { SubagentRunRequest, SubagentRunner } from '../SubagentRunner'
import type { SubagentDefinition, SubagentRecord } from '../types'

const SV = RUNTIME_CONTRACT_SCHEMA_VERSION

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of iterable) result.push(item)
  return result
}

function settings(): AgentRuntimeSettings {
  return {
    provider: 'faux',
    modelId: 'faux',
    apiKey: '',
  }
}

const agent: SubagentDefinition = {
  name: 'scout',
  description: 'Inspect context',
  tools: ['read'],
  systemPrompt: 'You are Scout.',
  scope: 'builtin',
}

class FakeRunner implements SubagentRunner {
  async *run(request: SubagentRunRequest, record: SubagentRecord): AsyncGenerator<RuntimeEvent, SubagentRecord, void> {
    yield {
      type: 'child_run_started',
      schemaVersion: SV,
      parentRunId: request.parentRunId,
      childRunId: request.childRunId,
      label: request.label,
      ts: Date.now(),
    } satisfies RuntimeEvent
    yield {
      type: 'tool_call',
      schemaVersion: SV,
      runId: request.childRunId,
      callId: 'call-read',
      toolName: 'read',
      input: { path: 'README.md' },
      ts: Date.now(),
    } satisfies RuntimeEvent
    record.toolUses += 1
    yield {
      type: 'assistant_delta',
      schemaVersion: SV,
      runId: request.childRunId,
      requestId: `req-${request.childRunId}`,
      text: 'scout output',
      ts: Date.now(),
    } satisfies RuntimeEvent
    record.status = 'completed'
    record.result = 'scout output'
    record.completedAt = Date.now()
    yield {
      type: 'child_run_completed',
      schemaVersion: SV,
      parentRunId: request.parentRunId,
      childRunId: request.childRunId,
      output: { text: 'scout output', exitCode: 0, durationMs: 1 },
      ts: Date.now(),
    } satisfies RuntimeEvent
    return record
  }
}

describe('SubagentManager', () => {
  it('records child lifecycle state while streaming runner events', async () => {
    const manager = new SubagentManager({ runner: new FakeRunner() })

    const events = await collect(manager.spawnAndWait({
      parentRunId: 'parent-run',
      childRunId: 'parent-run-scout',
      agent,
      task: 'Find auth files',
      sessionId: 'session-1',
      settings: settings(),
    }))

    expect(events.map(event => event.type)).toEqual([
      'child_run_started',
      'tool_call',
      'assistant_delta',
      'child_run_completed',
    ])

    expect(manager.getRecord('parent-run-scout')).toMatchObject({
      id: 'parent-run-scout',
      parentRunId: 'parent-run',
      sessionId: 'session-1',
      agent: 'scout',
      status: 'completed',
      result: 'scout output',
      toolUses: 1,
    })
  })

  it('marks consumed results without deleting the child record', async () => {
    const manager = new SubagentManager({ runner: new FakeRunner() })
    await collect(manager.spawnAndWait({
      parentRunId: 'parent-run',
      childRunId: 'parent-run-scout',
      agent,
      task: 'Find auth files',
      settings: settings(),
    }))

    const record = manager.getResult('parent-run-scout', { consume: true })

    expect(record?.result).toBe('scout output')
    expect(manager.getRecord('parent-run-scout')?.resultConsumed).toBe(true)
  })

  it('queues child runs behind the configured concurrency limit', async () => {
    const runner = new BlockingRunner()
    const manager = new SubagentManager({ runner, maxConcurrent: 1 })

    const first = collect(manager.spawnAndWait({
      parentRunId: 'parent-run',
      childRunId: 'child-one',
      agent,
      task: 'first',
      settings: settings(),
    }))
    await runner.waitForStarts(1)

    const second = collect(manager.spawnAndWait({
      parentRunId: 'parent-run',
      childRunId: 'child-two',
      agent,
      task: 'second',
      settings: settings(),
    }))
    await tick()

    expect(manager.getRecord('child-one')?.status).toBe('running')
    expect(manager.getRecord('child-two')?.status).toBe('queued')
    expect(runner.starts).toEqual(['child-one'])

    runner.releaseNext()
    await first
    await runner.waitForStarts(2)

    expect(manager.getRecord('child-two')?.status).toBe('running')
    expect(runner.starts).toEqual(['child-one', 'child-two'])

    runner.releaseNext()
    await second
    expect(manager.getRecord('child-two')?.status).toBe('completed')
  })

  it('notifies lifecycle observers when child records are created, started, and completed', async () => {
    const transitions: string[] = []
    const manager = new SubagentManager({
      runner: new FakeRunner(),
      onCreate: record => { transitions.push(`${record.id}:${record.status}:create`); },
      onStart: record => { transitions.push(`${record.id}:${record.status}:start`); },
      onComplete: record => { transitions.push(`${record.id}:${record.status}:complete`); },
    })

    await collect(manager.spawnAndWait({
      parentRunId: 'parent-run',
      childRunId: 'parent-run-scout',
      agent,
      task: 'Find auth files',
      settings: settings(),
    }))

    expect(transitions).toEqual([
      'parent-run-scout:queued:create',
      'parent-run-scout:running:start',
      'parent-run-scout:completed:complete',
    ])
  })
})

class BlockingRunner implements SubagentRunner {
  readonly starts: string[] = []
  private readonly releases: Array<() => void> = []

  async *run(request: SubagentRunRequest, record: SubagentRecord): AsyncGenerator<RuntimeEvent, SubagentRecord, void> {
    this.starts.push(request.childRunId)
    await new Promise<void>(resolve => {
      this.releases.push(resolve)
    })
    record.status = 'completed'
    record.result = request.task
    record.completedAt = Date.now()
    yield {
      type: 'child_run_completed',
      schemaVersion: SV,
      parentRunId: request.parentRunId,
      childRunId: request.childRunId,
      output: { text: request.task },
      ts: Date.now(),
    } satisfies RuntimeEvent
    return record
  }

  releaseNext(): void {
    this.releases.shift()?.()
  }

  async waitForStarts(count: number): Promise<void> {
    for (let i = 0; i < 20; i++) {
      if (this.starts.length >= count) return
      await tick()
    }
    throw new Error(`Timed out waiting for ${count} starts`)
  }
}

function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}
