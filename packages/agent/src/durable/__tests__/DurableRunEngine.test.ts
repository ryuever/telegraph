import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import {
  DesignBuildDurableSpike,
  FileDurableStepLedger,
  InMemoryDurableStepLedger,
  LedgerBackedDurableRunEngine,
  RestateDurableRunEngine,
  createDurableStepContext,
  durableIdempotencyKey,
  type RestateDurableContext,
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

    const result = await engine.executeStep(context, () => Promise.resolve({ ok: true }))

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
    expect(result.events).toHaveLength(2)
    expect(result.events[0]).toMatchObject({
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
    })
    expect(result.events[1]).toMatchObject({
      type: 'step_completed',
      runId: 'run-1',
      stepId: 'step-tool',
      output: { ok: true },
      ts: 200,
      raw: {
        durable: {
          kind: 'tool_call',
          idempotencyKey: 'run:run-1:step:step-tool:call:call-1',
          callId: 'call-1',
          input: { path: 'README.md' },
        },
        reused: false,
      },
    })
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

    await engine.executeStep(context, () => {
      calls += 1
      return Promise.resolve('first')
    })
    const second = await engine.executeStep(context, () => {
      calls += 1
      return Promise.resolve('second')
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
      raw: {
        durable: {
          kind: 'llm_call',
          idempotencyKey: 'run:run-2:step:step-llm',
          callId: undefined,
          input: undefined,
        },
        completedAt: 200,
        reused: true,
      },
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

    const result = await engine.executeStep(context, () => Promise.reject(new Error('patch failed')))

    expect(result.record).toMatchObject({
      status: 'failed',
      error: {
        message: 'patch failed',
      },
    })
    expect(result.events).toHaveLength(2)
    expect(result.events[0]).toMatchObject({ type: 'step_started' })
    expect(result.events[1]).toMatchObject({
      type: 'runtime_log',
      level: 'error',
      message: 'Durable step failed: Patch artifact',
      raw: {
        durable: {
          kind: 'artifact_patch',
          idempotencyKey: 'run:run-3:step:step-fail',
          callId: undefined,
          input: undefined,
        },
        error: {
          message: 'patch failed',
          code: 'Error',
        },
      },
    })
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
    }).executeStep(context, () => {
      calls += 1
      return Promise.resolve({ sent: true })
    })

    const afterRestart = await new LedgerBackedDurableRunEngine({
      ledger: new FileDurableStepLedger(dir),
      now: sequentialNow([300]),
    }).executeStep(context, () => {
      calls += 1
      return Promise.resolve({ sent: false })
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

  it('runs design-build as the selected durable spike scenario and resumes without repeated side effects', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'telegraph-design-build-durable-'))
    cleanupDirs.push(dir)
    const input = {
      runId: 'run-design-build',
      prompt: 'Build a run console',
      artifactId: 'artifact-run-console',
    }
    const calls: string[] = []

    const first = await new DesignBuildDurableSpike(
      new LedgerBackedDurableRunEngine({
        ledger: new FileDurableStepLedger(dir),
        now: sequentialNow([100, 200, 300, 400, 500, 600]),
      }),
      {
        plan: () => {
          calls.push('plan')
          return Promise.resolve({
            summary: 'Create run console',
            files: ['RunConsole.tsx'],
          })
        },
        generateArtifact: (_input, plan) => {
          calls.push(`generate:${plan.files.join(',')}`)
          return Promise.resolve({
            artifactId: 'artifact-run-console',
            contentRef: 'artifact://run-console/v1',
          })
        },
        applyPatch: (_input, artifact) => {
          calls.push(`patch:${artifact.contentRef}`)
          return Promise.resolve({
            artifactId: artifact.artifactId,
            patchRef: 'patch://run-console/v1',
            applied: true,
          })
        },
      },
    ).run(input)

    expect(first).toMatchObject({
      reusedStepIds: [],
      plan: {
        files: ['RunConsole.tsx'],
      },
      artifact: {
        contentRef: 'artifact://run-console/v1',
      },
      patch: {
        applied: true,
      },
    })
    expect(first.events.map(event => event.type)).toEqual([
      'step_started',
      'step_completed',
      'step_started',
      'step_completed',
      'step_started',
      'step_completed',
    ])

    const afterRestart = await new DesignBuildDurableSpike(
      new LedgerBackedDurableRunEngine({
        ledger: new FileDurableStepLedger(dir),
        now: sequentialNow([700, 800, 900]),
      }),
      {
        plan: () => {
          calls.push('plan-again')
          return Promise.resolve({
            summary: 'Wrong repeat',
            files: [],
          })
        },
        generateArtifact: () => {
          calls.push('generate-again')
          return Promise.resolve({
            artifactId: 'artifact-run-console',
            contentRef: 'artifact://repeat',
          })
        },
        applyPatch: () => {
          calls.push('patch-again')
          return Promise.resolve({
            artifactId: 'artifact-run-console',
            patchRef: 'patch://repeat',
            applied: false,
          })
        },
      },
    ).run(input)

    expect(calls).toEqual([
      'plan',
      'generate:RunConsole.tsx',
      'patch:artifact://run-console/v1',
    ])
    expect(afterRestart).toMatchObject({
      reusedStepIds: [
        'design-build:plan',
        'design-build:generate-artifact',
        'design-build:apply-patch',
      ],
      artifact: {
        contentRef: 'artifact://run-console/v1',
      },
      patch: {
        patchRef: 'patch://run-console/v1',
        applied: true,
      },
    })
    expect(afterRestart.events.map(event => event.type)).toEqual([
      'runtime_log',
      'step_completed',
      'runtime_log',
      'step_completed',
      'runtime_log',
      'step_completed',
    ])
  })

  it('wraps durable side effects in Restate ctx.run without adding a package dependency', async () => {
    const restate = new FakeRestateContext()
    const engine = new RestateDurableRunEngine({
      context: restate,
      now: sequentialNow([100, 200, 300, 400]),
    })
    const context = createDurableStepContext({
      runId: 'run-restate',
      step: {
        stepId: 'step-restate-tool',
        label: 'Send durable request',
        kind: 'tool_call',
        callId: 'send-request',
        input: { endpoint: '/v1/run' },
      },
    })
    let calls = 0

    const first = await engine.executeStep(context, () => {
      calls += 1
      return Promise.resolve({ accepted: true })
    })
    const replay = await engine.executeStep(context, () => {
      calls += 1
      return Promise.resolve({ accepted: false })
    })

    expect(calls).toBe(1)
    expect(restate.runNames).toEqual([
      'run:run-restate:step:step-restate-tool:call:send-request',
      'run:run-restate:step:step-restate-tool:call:send-request',
    ])
    expect(first).toMatchObject({
      record: {
        idempotencyKey: 'run:run-restate:step:step-restate-tool:call:send-request',
        output: { accepted: true },
        status: 'completed',
      },
      reused: false,
    })
    expect(replay).toMatchObject({
      record: {
        output: { accepted: true },
        status: 'completed',
      },
      reused: false,
    })
    expect(first.events[0]).toMatchObject({
      type: 'step_started',
      origin: { framework: 'telegraph', runtimeId: 'durable-run-engine:restate' },
      raw: {
        durable: {
          adapter: 'restate',
          actionName: 'run:run-restate:step:step-restate-tool:call:send-request',
        },
      },
    })
    expect(first.events[1]).toMatchObject({
      type: 'step_completed',
      output: { accepted: true },
      raw: {
        durable: {
          kind: 'tool_call',
          idempotencyKey: 'run:run-restate:step:step-restate-tool:call:send-request',
          callId: 'send-request',
          input: { endpoint: '/v1/run' },
          adapter: 'restate',
        },
      },
    })
  })
})

function sequentialNow(values: number[]): () => number {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)] ?? 0
}

class FakeRestateContext implements RestateDurableContext {
  readonly runNames: string[] = []
  private readonly journal = new Map<string, unknown>()

  async run<Output>(name: string, action: () => Promise<Output>): Promise<Output> {
    this.runNames.push(name)
    if (this.journal.has(name)) {
      return structuredClone(this.journal.get(name)) as Output
    }
    const output = await action()
    this.journal.set(name, structuredClone(output))
    return output
  }
}
