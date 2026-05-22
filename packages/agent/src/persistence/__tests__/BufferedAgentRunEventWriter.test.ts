import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { RUNTIME_CONTRACT_SCHEMA_VERSION, type AgentEvent } from '@/packages/agent-protocol'
import { BufferedAgentRunEventWriter, compactBufferedEvents } from '../BufferedAgentRunEventWriter'
import { FileAgentRunRepository } from '../AgentRunRepository'

describe('BufferedAgentRunEventWriter', () => {
  it('buffers high-frequency deltas until a critical event flushes them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'telegraph-buffered-runs-'))
    try {
      const repo = new FileAgentRunRepository(dir)
      await repo.createRun({
        runId: 'run-buffered',
        sessionId: 'session-buffered',
        runtimeId: 'pi-ai',
        now: 100,
      })
      const flushed: string[] = []
      const writer = new BufferedAgentRunEventWriter(repo, {
        flushIntervalMs: 60_000,
        onFlush: (_runId, records) => {
          flushed.push(records.map(record => record.event.type).join(','))
        },
      })

      expect(await writer.append('run-buffered', assistantDelta('run-buffered', 'hello ', 110))).toEqual([])
      expect(await repo.listRunEvents('run-buffered')).toEqual([])

      const terminalRecords = await writer.append('run-buffered', runCompleted('run-buffered', 120))

      expect(terminalRecords.map(record => record.seq)).toEqual([1, 2])
      expect(terminalRecords.map(record => record.event.type)).toEqual(['assistant_delta', 'run_completed'])
      expect(flushed).toEqual(['assistant_delta,run_completed'])
      expect((await repo.getRun('run-buffered'))?.status).toBe('completed')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('compacts consecutive assistant deltas for the same request', () => {
    const compacted = compactBufferedEvents([
      assistantDelta('run-compact', 'a', 100, 'request-1'),
      assistantDelta('run-compact', 'b', 101, 'request-1'),
      assistantDelta('run-compact', 'c', 102, 'request-2'),
    ])

    expect(compacted).toHaveLength(2)
    expect(compacted[0]).toMatchObject({
      type: 'assistant_delta',
      requestId: 'request-1',
      text: 'ab',
      ts: 101,
    })
    expect(compacted[1]).toMatchObject({
      type: 'assistant_delta',
      requestId: 'request-2',
      text: 'c',
    })
  })
})

function assistantDelta(
  runId: string,
  text: string,
  ts: number,
  requestId = `${runId}-request`,
): AgentEvent {
  return {
    type: 'assistant_delta',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    origin: { framework: 'telegraph', runtimeId: 'test-runtime' },
    runId,
    requestId,
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
