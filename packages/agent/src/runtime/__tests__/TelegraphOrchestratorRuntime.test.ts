import type { RuntimeInput } from '@/packages/agent/runtime/AgentRuntime'
import {
  TelegraphOrchestratorRuntime,
  type TelegraphOrchestratorRunner,
  type TelegraphOrchestratorSignal,
} from '@/packages/agent/runtime/TelegraphOrchestratorRuntime'
import { runRuntimeConformance } from '@/packages/agent/runtime/conformance'
import { describe, expect, it } from 'vitest'

class StaticOrchestratorRunner implements TelegraphOrchestratorRunner {
  constructor(private readonly signals: TelegraphOrchestratorSignal[]) {}

  async *run(_input: RuntimeInput): AsyncIterable<TelegraphOrchestratorSignal> {
    yield* this.signals
  }
}

const input: RuntimeInput = {
  runId: 'run-orchestrator',
  sessionId: 'session-1',
  message: 'build',
  settings: { backend: 'telegraph-orchestrator' },
}

describe('TelegraphOrchestratorRuntime', () => {
  it('maps injected orchestrator hooks into conforming AgentEvents', async () => {
    const runtime = new TelegraphOrchestratorRuntime({
      runner: new StaticOrchestratorRunner([
        { type: 'node_started', nodeId: 'planner', label: 'Planner', kind: 'worker', ts: 2 },
        { type: 'edge_taken', from: 'planner', to: 'executor', condition: 'approved', ts: 3 },
        { type: 'checkpoint', checkpointId: 'cp-1', nodeId: 'executor', state: { phase: 'execute' }, ts: 4 },
        { type: 'interrupt', interruptId: 'permission-1', nodeId: 'executor', reason: 'permission', resumable: true, ts: 5 },
        { type: 'node_completed', nodeId: 'planner', output: { ok: true }, ts: 6 },
        { type: 'completed', output: { done: true }, ts: 7 },
      ]),
    })

    const report = await runRuntimeConformance(runtime, input)

    expect(report.issues).toEqual([])
    expect(report.events.map(event => event.type)).toEqual([
      'run_started',
      'step_started',
      'edge_taken',
      'runtime_log',
      'runtime_log',
      'step_completed',
      'run_completed',
    ])
  })

  it('normalizes runner failures into run_failed', async () => {
    const runtime = new TelegraphOrchestratorRuntime({
      runner: new StaticOrchestratorRunner([
        { type: 'failed', error: new Error('planner exploded'), ts: 2 },
      ]),
    })

    const report = await runRuntimeConformance(runtime, input)

    expect(report.issues).toEqual([])
    expect(report.events.at(-1)).toMatchObject({
      type: 'run_failed',
      error: {
        code: 'telegraph_orchestrator_error',
        message: 'planner exploded',
      },
    })
  })
})
