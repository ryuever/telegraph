import type { AgentEvent } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import type { RuntimeExecutor, RuntimeInput } from '@/packages/agent/runtime/AgentRuntime'
import { describe, expect, it } from 'vitest'
import { runRuntimeConformance } from '@/packages/agent/runtime/conformance'

class StaticRuntime implements RuntimeExecutor {
  readonly id = 'static'
  readonly label = 'Static Runtime'

  constructor(private readonly events: AgentEvent[]) {}

  async *run(_input: RuntimeInput): AsyncIterable<AgentEvent> {
    yield* this.events
  }
}

const input: RuntimeInput = {
  runId: 'run-1',
  sessionId: 'session-1',
  message: 'hello',
  settings: { backend: 'static' },
}

describe('runtime conformance', () => {
  it('accepts a valid adapter event stream', async () => {
    const report = await runRuntimeConformance(new StaticRuntime([
      {
        type: 'run_started',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'run-1',
        pattern: 'single_llm',
        ts: 1,
        raw: { ok: true },
      },
      {
        type: 'assistant_delta',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'run-1',
        requestId: 'request-1',
        text: 'hello',
        ts: 2,
        origin: { framework: 'custom', runtimeId: 'static', raw: { chunk: 1 } },
      },
      {
        type: 'run_completed',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'run-1',
        output: 'hello',
        ts: 3,
      },
    ]), input)

    expect(report.events.map(event => event.type)).toEqual(['run_started', 'assistant_delta', 'run_completed'])
    expect(report.issues).toEqual([])
  })

  it('reports missing terminal event and non-serializable raw payloads', async () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular

    const report = await runRuntimeConformance(new StaticRuntime([
      {
        type: 'run_started',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'run-1',
        ts: 1,
      },
      {
        type: 'runtime_log',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        level: 'info',
        message: 'still running',
        raw: circular,
        ts: 2,
      },
    ]), input)

    expect(report.issues.map(issue => issue.code)).toEqual([
      'non_serializable_payload',
      'missing_terminal_event',
      'last_event_not_terminal',
    ])
  })

  it('reports malformed failure normalization', async () => {
    const report = await runRuntimeConformance(new StaticRuntime([
      {
        type: 'run_failed',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'run-1',
        error: { code: '', message: undefined as unknown as string },
        ts: 1,
      },
    ]), input)

    expect(report.issues.map(issue => issue.code)).toEqual(['invalid_failure_error'])
  })
})
