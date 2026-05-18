import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { OrchestratorCoreRunner } from '@/packages/agent/runtime/OrchestratorCoreRunner'
import { TelegraphOrchestratorRuntime } from '@/packages/agent/runtime/TelegraphOrchestratorRuntime'
import { runRuntimeConformance } from '@/packages/agent/runtime/conformance'
import type { RuntimeInput } from '@/packages/agent/runtime/AgentRuntime'
import {
  Annotation,
  MemorySaver,
  END,
  interrupt,
  START,
  StateGraph,
} from '@/packages/orchestrator-core'
import { describe, expect, it } from 'vitest'

const input: RuntimeInput = {
  runId: 'run-core-runner',
  sessionId: 'session-core-runner',
  message: 'hello',
  settings: { backend: 'telegraph-orchestrator' },
}

describe('OrchestratorCoreRunner', () => {
  it('executes a linear StateGraph through TelegraphOrchestratorRuntime', async () => {
    const State = Annotation.Root({
      message: Annotation<string>(),
      reply: Annotation<string>(),
    })

    const graph = new StateGraph(State)
      .addNode('respond', async (state) => ({
        reply: `Echo: ${state.message}`,
      }), { metadata: { label: 'Respond' } })
      .addEdge(START, 'respond')
      .addEdge('respond', END)
      .compile()

    const runtime = new TelegraphOrchestratorRuntime({
      runner: new OrchestratorCoreRunner({
        graph,
        input: (runtimeInput) => ({ message: runtimeInput.message }),
        now: () => 123,
      }),
    })

    const report = await runRuntimeConformance(runtime, input)

    expect(report.issues).toEqual([])
    expect(report.events.map(event => event.type)).toEqual([
      'run_started',
      'step_started',
      'step_completed',
      'run_completed',
    ])
    expect(report.events[1]).toMatchObject({
      type: 'step_started',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      stepId: 'respond',
      label: 'Respond',
    })
    expect(report.events.at(-1)).toMatchObject({
      type: 'run_completed',
      output: {
        message: 'hello',
        reply: 'Echo: hello',
      },
    })
  })

  it('emits inferred edge signals for graph branches', async () => {
    const State = Annotation.Root({
      message: Annotation<string>(),
      route: Annotation<string>(),
      reply: Annotation<string>(),
    })

    const graph = new StateGraph(State)
      .addNode('router', async () => ({ route: 'right' }))
      .addNode('right', async () => ({ reply: 'right path' }))
      .addConditionalEdges('router', state => state.route, ['right'])
      .addEdge(START, 'router')
      .addEdge('right', END)
      .compile()

    const signals = []
    const runner = new OrchestratorCoreRunner({
      graph,
      input: (runtimeInput) => ({ message: runtimeInput.message }),
      now: () => 123,
    })

    for await (const signal of runner.run(input)) {
      signals.push(signal)
    }

    expect(signals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'edge_taken',
        from: 'router',
        to: 'right',
      }),
      expect.objectContaining({
        type: 'completed',
      }),
    ]))
  })

  it('runs parallel fan-out/fan-in graphs with inferred edge signals', async () => {
    const State = Annotation.Root({
      message: Annotation<string>(),
      leftValue: Annotation<string>(),
      rightValue: Annotation<string>(),
      reply: Annotation<string>(),
    })

    const graph = new StateGraph(State)
      .addNode('left-node', async () => ({ leftValue: 'L' }))
      .addNode('right-node', async () => ({ rightValue: 'R' }))
      .addNode('join', async state => ({ reply: `${state.leftValue}${state.rightValue}` }))
      .addEdge(START, 'left-node')
      .addEdge(START, 'right-node')
      .addEdge(['left-node', 'right-node'], 'join')
      .addEdge('join', END)
      .compile()

    const runner = new OrchestratorCoreRunner({
      graph,
      input: runtimeInput => ({ message: runtimeInput.message }),
      now: () => 123,
    })
    const signals = []

    for await (const signal of runner.run(input)) {
      signals.push(signal)
    }

    expect(signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'edge_taken', from: 'left-node', to: 'join' }),
      expect.objectContaining({ type: 'edge_taken', from: 'right-node', to: 'join' }),
      expect.objectContaining({ type: 'completed', output: expect.objectContaining({ reply: 'LR' }) }),
    ]))
  })

  it('emits checkpoint and interrupt signals', async () => {
    const State = Annotation.Root({
      message: Annotation<string>(),
      reply: Annotation<string>(),
    })

    const checkpointGraph = new StateGraph(State)
      .addNode('checkpointed', async state => ({ reply: state.message }))
      .addEdge(START, 'checkpointed')
      .addEdge('checkpointed', END)
      .compile({ checkpointer: new MemorySaver() })

    const checkpointRunner = new OrchestratorCoreRunner({
      graph: checkpointGraph,
      input: runtimeInput => ({ message: runtimeInput.message }),
      invokeOptions: () => ({ configurable: { thread_id: 'thread-1' } }),
      now: () => 123,
    })
    const checkpointSignals = []

    for await (const signal of checkpointRunner.run(input)) {
      checkpointSignals.push(signal)
    }

    expect(checkpointSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'checkpoint' }),
    ]))

    const interruptGraph = new StateGraph(State)
      .addNode('needs-human', async () => {
        interrupt({ type: 'approval' })
        return { reply: 'approved' }
      })
      .addEdge(START, 'needs-human')
      .addEdge('needs-human', END)
      .compile({ checkpointer: new MemorySaver() })

    const interruptRunner = new OrchestratorCoreRunner({
      graph: interruptGraph,
      input: runtimeInput => ({ message: runtimeInput.message }),
      invokeOptions: () => ({ configurable: { thread_id: 'thread-2' } }),
      now: () => 123,
    })
    const interruptSignals = []

    for await (const signal of interruptRunner.run(input)) {
      interruptSignals.push(signal)
    }

    expect(interruptSignals).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'interrupt', nodeId: 'needs-human', resumable: true }),
      expect.objectContaining({ type: 'completed', output: { interrupted: true } }),
    ]))
  })

  it('maps aborted orchestrator runs to run_cancelled through the runtime adapter', async () => {
    const State = Annotation.Root({
      message: Annotation<string>(),
      reply: Annotation<string>(),
    })
    const controller = new AbortController()
    controller.abort()

    const graph = new StateGraph(State)
      .addNode('never-runs', async state => ({ reply: state.message }))
      .addEdge(START, 'never-runs')
      .addEdge('never-runs', END)
      .compile()

    const runtime = new TelegraphOrchestratorRuntime({
      runner: new OrchestratorCoreRunner({
        graph,
        input: runtimeInput => ({ message: runtimeInput.message }),
      }),
    })

    const report = await runRuntimeConformance(runtime, {
      ...input,
      signal: controller.signal,
    })

    expect(report.issues).toEqual([])
    expect(report.events.at(-1)).toMatchObject({
      type: 'run_cancelled',
    })
  })
})
