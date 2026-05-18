import { describe, expect, it } from 'vitest'
import { validateRuntimeEventConformance } from '@/packages/agent/runtime/conformance'
import {
  createCheckpointEvent,
  createEdgeTakenEvent,
  createInterruptEvent,
  createNodeCompletedEvent,
  createNodeStartedEvent,
} from '../orchestratorObservability'

describe('orchestrator observability hooks', () => {
  it('maps node lifecycle hooks to step events without adding schema v1 event kinds', () => {
    const started = createNodeStartedEvent({
      runId: 'run-1',
      nodeId: 'planner',
      label: 'Planner',
      kind: 'worker',
      ts: 1,
    })
    const completed = createNodeCompletedEvent({
      runId: 'run-1',
      nodeId: 'planner',
      output: { plan: true },
      ts: 2,
    })

    expect(started).toMatchObject({
      type: 'step_started',
      runId: 'run-1',
      stepId: 'planner',
      label: 'Planner',
      kind: 'worker',
    })
    expect(completed).toMatchObject({
      type: 'step_completed',
      runId: 'run-1',
      stepId: 'planner',
      output: { plan: true },
    })
    expect(validateRuntimeEventConformance(started)).toEqual([])
    expect(validateRuntimeEventConformance(completed)).toEqual([])
  })

  it('uses existing edge_taken and structured runtime_log events for edges, checkpoints, and interrupts', () => {
    const edge = createEdgeTakenEvent({
      runId: 'run-1',
      from: 'planner',
      to: 'executor',
      condition: 'approved',
      ts: 3,
    })
    const checkpoint = createCheckpointEvent({
      runId: 'run-1',
      checkpointId: 'cp-1',
      nodeId: 'executor',
      state: { step: 2 },
      ts: 4,
    })
    const interrupt = createInterruptEvent({
      runId: 'run-1',
      interruptId: 'interrupt-1',
      nodeId: 'executor',
      reason: 'permission_required',
      resumable: true,
      ts: 5,
    })

    expect(edge).toMatchObject({
      type: 'edge_taken',
      runId: 'run-1',
      from: 'planner',
      to: 'executor',
      condition: 'approved',
    })
    expect(checkpoint).toMatchObject({
      type: 'runtime_log',
      level: 'debug',
      message: 'checkpoint:cp-1',
      raw: { hook: 'checkpoint', checkpointId: 'cp-1', nodeId: 'executor', state: { step: 2 } },
    })
    expect(interrupt).toMatchObject({
      type: 'runtime_log',
      level: 'warn',
      message: 'interrupt:interrupt-1:permission_required',
      raw: {
        hook: 'interrupt',
        interruptId: 'interrupt-1',
        nodeId: 'executor',
        reason: 'permission_required',
        resumable: true,
      },
    })
    expect([
      ...validateRuntimeEventConformance(edge),
      ...validateRuntimeEventConformance(checkpoint),
      ...validateRuntimeEventConformance(interrupt),
    ]).toEqual([])
  })
})
