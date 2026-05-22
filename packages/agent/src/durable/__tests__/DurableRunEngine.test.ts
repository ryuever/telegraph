import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import {
  FileDurableStepLedger,
  InMemoryDurableStepLedger,
  LedgerBackedDurableRunEngine,
  createDurableStepContext,
  durableIdempotencyKey,
} from '@/packages/agent/durable'

const cleanupDirs: string[] = []

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('DurableRunEngine', () => {
  it('creates stable run/step/call idempotency keys', () => {
    expect(durableIdempotencyKey({
      runId: 'run 1',
      stepId: 'tool:write',
      callId: 'call/1',
    })).toBe('run:run%201:step:tool%3Awrite:call:call%2F1')
  })

  it('executes a durable step once and maps it to runtime events', async () => {
    const engine = new LedgerBackedDurableRunEngine({
      ledger: new InMemoryDurableStepLedger(),
      now: sequentialNow([100, 200]),
    })
    const context = createDurableStepContext({
      runId: 'run-1',
      step: {
        stepId: 'step-tool',
        label: 'Write file',
        kind: 'tool_call',
        callId: 'call-1',
        input: { path: 'README.md' },
      },
    })

    const result = await engine.executeStep(context, async () => ({ ok: true }))

    expect(result).toMatchObject({
      reused: false,
      record: {
        idempotencyKey: 'run:run-1:step:step-tool:call:call-1',
        status: 'completed',
        output: { ok: true },
        startedAt: 100,
        completedAt: 200,
      },
    })
    expect(result.events).toEqual([
      expect.objectContaining({
        type: 'step_started',
        runId: 'run-1',
        stepId: 'step-tool',
        kind: 'tool',
        ts: 100,
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        raw: {
          durable: {
            kind: 'tool_call',
            idempotencyKey: 'run:run-1:step:step-tool:call:call-1',
            callId: 'call-1',
            input: { path: 'README.md' },
          },
        },
      }),
      expect.objectContaining({
        type: 'step_completed',
        runId: 'run-1',
        stepId: 'step-tool',
        output: { ok: true },
        ts: 200,
        raw: expect.objectContaining({
          reused: false,
        }),
      }),
    ])
  })

  it('reuses completed step records without repeating side effects', async () => {
    const ledger = new InMemoryDurableStepLedger()
    const engine = new LedgerBackedDurableRunEngine({
      ledger,
      now: sequentialNow([100, 200, 300]),
    })
    const context = createDurableStepContext({
      runId: 'run-2',
      step: {
        stepId: 'step-llm',
        label: 'Call model',
        kind: 'llm_call',
      },
    })
    let calls = 0

    await engine.executeStep(context, async () => {
      calls += 1
      return 'first'
    })
    const second = await engine.executeStep(context, async () => {
      calls += 1
      return 'second'
    })

    expect(calls).toBe(1)
    expect(second).toMatchObject({
      reused: true,
      record: {
        output: 'first',
        status: 'completed',
      },
    })
    expect(second.events.map(event => event.type)).toEqual(['runtime_log', 'step_completed'])
    expect(second.events[0]).toMatchObject({
      type: 'runtime_log',
      level: 'info',
      message: 'Reused durable step result: Call model',
      raw: expect.objectContaining({
        reused: true,
      }),
    })
  })

  it('records failed steps as runtime_log events without marking them reusable', async () => {
    const ledger = new InMemoryDurableStepLedger()
    const engine = new LedgerBackedDurableRunEngine({
      ledger,
      now: sequentialNow([100, 200]),
    })
    const context = createDurableStepContext({
      runId: 'run-3',
      step: {
        stepId: 'step-fail',
        label: 'Patch artifact',
        kind: 'artifact_patch',
      },
    })

    const result = await engine.executeStep(context, async () => {
      throw new Error('patch failed')
    })

    expect(result.record).toMatchObject({
      status: 'failed',
      error: {
        message: 'patch failed',
      },
    })
    expect(result.events).toEqual([
      expect.objectContaining({ type: 'step_started' }),
      expect.objectContaining({
        type: 'runtime_log',
        level: 'error',
        message: 'Durable step failed: Patch artifact',
        raw: expect.objectContaining({
          error: expect.objectContaining({ message: 'patch failed' }),
        }),
      }),
    ])
  })

  it('reuses completed file-backed step records after engine restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'telegraph-durable-ledger-'))
    cleanupDirs.push(dir)
    const context = createDurableStepContext({
      runId: 'run-restart',
      step: {
        stepId: 'step-side-effect',
        label: 'Send notification',
        kind: 'tool_call',
      },
    })
    let calls = 0

    await new LedgerBackedDurableRunEngine({
      ledger: new FileDurableStepLedger(dir),
      now: sequentialNow([100, 200]),
    }).executeStep(context, async () => {
      calls += 1
      return { sent: true }
    })

    const afterRestart = await new LedgerBackedDurableRunEngine({
      ledger: new FileDurableStepLedger(dir),
      now: sequentialNow([300]),
    }).executeStep(context, async () => {
      calls += 1
      return { sent: false }
    })

    expect(calls).toBe(1)
    expect(afterRestart).toMatchObject({
      reused: true,
      record: {
        output: { sent: true },
        status: 'completed',
      },
    })
  })
})

function sequentialNow(values: number[]): () => number {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)] ?? 0
}
