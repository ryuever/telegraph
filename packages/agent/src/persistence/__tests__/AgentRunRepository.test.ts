import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { RUNTIME_CONTRACT_SCHEMA_VERSION, type AgentEvent } from '@/packages/agent-protocol'
import { FileAgentRunRepository } from '../AgentRunRepository'

describe('FileAgentRunRepository', () => {
  it('creates a run, appends events, and derives terminal status', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'telegraph-runs-'))
    try {
      const repo = new FileAgentRunRepository(dir)
      const created = await repo.createRun({
        runId: 'run-1',
        sessionId: 'session-1',
        runtimeId: 'pi-ai',
        input: { message: 'Please inspect the codebase' },
        replay: {
          mode: 'manual_rerun',
          sourceRunId: 'run-source',
        },
        settings: {
          provider: 'minimax',
          modelId: 'MiniMax-M2.7',
          backend: 'pi-ai',
          taskCapabilityProfile: { kind: 'default' },
        },
        now: 100,
      })

      expect(created.status).toBe('queued')
      expect(created.input?.message).toBe('Please inspect the codebase')
      expect(created.inputPreview).toBe('Please inspect the codebase')
      expect(created.replay?.sourceRunId).toBe('run-source')
      expect(created.settings.taskCapabilityProfile).toBe('default')

      await repo.appendEvent('run-1', runStarted('run-1', 110))
      await repo.appendEvent('run-1', assistantDelta('run-1', 'hello', 120))
      await repo.appendEvent('run-1', runCompleted('run-1', 130))

      const record = await repo.getRun('run-1')
      expect(record?.status).toBe('completed')
      expect(record?.startedAt).toBe(110)
      expect(record?.completedAt).toBe(130)
      expect(record?.eventCount).toBe(3)

      const events = await repo.listRunEvents('run-1')
      expect(events.map(event => event.seq)).toEqual([1, 2, 3])
      expect(events[1].event.type).toBe('assistant_delta')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('marks active runs as runtime recovery failures', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'telegraph-runs-'))
    try {
      const repo = new FileAgentRunRepository(dir)
      await repo.createRun({
        runId: 'run-2',
        sessionId: 'session-1',
        runtimeId: 'telegraph-subagents',
        now: 100,
      })
      await repo.appendEvent('run-2', runStarted('run-2', 110))

      const recovered = await repo.markRunningRunsRecovered(200)
      expect(recovered).toHaveLength(1)
      expect(recovered[0].status).toBe('failed')
      expect(recovered[0].failureReason).toBe('runtime_recovery')

      const listed = await repo.listRuns({ sessionId: 'session-1' })
      expect(listed[0].runId).toBe('run-2')
      expect(listed[0].completedAt).toBe(200)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('serializes concurrent event appends for one run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'telegraph-runs-'))
    try {
      const repo = new FileAgentRunRepository(dir)
      await repo.createRun({
        runId: 'run-3',
        sessionId: 'session-1',
        runtimeId: 'pi-ai',
        now: 100,
      })

      await Promise.all([
        repo.appendEvent('run-3', assistantDelta('run-3', 'a', 110)),
        repo.appendEvent('run-3', assistantDelta('run-3', 'b', 111)),
        repo.appendEvent('run-3', assistantDelta('run-3', 'c', 112)),
        repo.appendEvent('run-3', runCompleted('run-3', 130)),
      ])

      const events = await repo.listRunEvents('run-3')
      expect(events.map(event => event.seq)).toEqual([1, 2, 3, 4])
      expect(new Set(events.map(event => event.seq)).size).toBe(4)
      expect((await repo.getRun('run-3'))?.eventCount).toBe(4)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('imports an exported run bundle without overwriting existing runs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'telegraph-runs-'))
    try {
      const repo = new FileAgentRunRepository(dir)
      const result = await repo.importRunBundle({
        run: {
          runId: 'run-imported',
          sessionId: 'session-imported',
          status: 'completed',
          runtimeId: 'pi-ai',
          artifactRefs: [],
          settings: { provider: 'minimax', modelId: 'MiniMax-M2.7' },
          input: { message: 'Imported prompt' },
          eventCount: 1,
          createdAt: 100,
          completedAt: 120,
        },
        events: [
          {
            runId: 'run-imported',
            sessionId: 'session-imported',
            seq: 10,
            event: runCompleted('run-imported', 120),
            ts: 120,
          },
        ],
      })

      expect(result.status).toBe('imported')
      expect((await repo.getRun('run-imported'))?.input?.message).toBe('Imported prompt')
      expect((await repo.listRunEvents('run-imported')).map(event => event.seq)).toEqual([1])

      const duplicate = await repo.importRunBundle({
        run: {
          ...result.record,
          input: { message: 'Should not overwrite' },
        },
        events: [],
      })

      expect(duplicate.status).toBe('existing')
      expect((await repo.getRun('run-imported'))?.input?.message).toBe('Imported prompt')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

function runStarted(runId: string, ts: number): AgentEvent {
  return {
    type: 'run_started',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    origin: { framework: 'telegraph', runtimeId: 'test-runtime' },
    runId,
    ts,
  }
}

function assistantDelta(runId: string, text: string, ts: number): AgentEvent {
  return {
    type: 'assistant_delta',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    origin: { framework: 'telegraph', runtimeId: 'test-runtime' },
    runId,
    requestId: `${runId}-request`,
    text,
    ts,
  }
}

function runCompleted(runId: string, ts: number): AgentEvent {
  return {
    type: 'run_completed',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    origin: { framework: 'telegraph', runtimeId: 'test-runtime' },
    runId,
    output: null,
    ts,
  }
}
