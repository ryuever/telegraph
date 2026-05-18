import type { AgentEvent } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { describe, expect, it } from 'vitest'
import type { LlmTraceRow } from '../llm-trace-store'
import { buildTraceTimeline } from '../trace-timeline'

function row(event: AgentEvent, index: number): LlmTraceRow {
  return {
    sessionId: 'session-1',
    runId: 'root-run',
    ts: index,
    trace: { kind: 'runtime_event', event },
  }
}

describe('buildTraceTimeline', () => {
  it('keeps child-run events under the parent root run', () => {
    const events: AgentEvent[] = [
      {
        type: 'run_started',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'root-run',
        pattern: 'parallelization',
        ts: 1,
      },
      {
        type: 'child_run_started',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        parentRunId: 'root-run',
        childRunId: 'child-run-a',
        label: 'research',
        ts: 2,
      },
      {
        type: 'assistant_delta',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'child-run-a',
        requestId: 'request-1',
        text: 'child text',
        ts: 3,
      },
      {
        type: 'tool_call',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'child-run-a',
        callId: 'call-1',
        toolName: 'read_file',
        input: { path: 'README.md' },
        ts: 4,
      },
      {
        type: 'child_run_completed',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        parentRunId: 'root-run',
        childRunId: 'child-run-a',
        output: 'done',
        ts: 5,
      },
      {
        type: 'run_completed',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'root-run',
        output: 'ok',
        ts: 6,
      },
    ]

    const timeline = buildTraceTimeline(events.map(row))

    expect(timeline).toHaveLength(1)
    expect(timeline[0]?.id).toBe('root-run')
    expect(timeline[0]?.pattern).toBe('parallelization')
    expect(timeline[0]?.status).toBe('completed')
    expect(timeline[0]?.childRuns).toHaveLength(1)
    expect(timeline[0]?.childRuns[0]?.rows.map(r => r.trace.kind === 'runtime_event' ? r.trace.event.type : r.trace.kind))
      .toEqual(['child_run_started', 'assistant_delta', 'tool_call', 'child_run_completed'])
    expect(timeline[0]?.directRows.map(r => r.trace.kind === 'runtime_event' ? r.trace.event.type : r.trace.kind))
      .toEqual(['run_started', 'run_completed'])
  })

  it('groups workflow step lifecycle events inside the owning run', () => {
    const events: AgentEvent[] = [
      {
        type: 'step_started',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'root-run',
        stepId: 'aggregate',
        label: 'Aggregate',
        kind: 'tool',
        ts: 1,
      },
      {
        type: 'step_completed',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'root-run',
        stepId: 'aggregate',
        output: { count: 2 },
        ts: 2,
      },
    ]

    const timeline = buildTraceTimeline(events.map(row))

    expect(timeline).toHaveLength(1)
    expect(timeline[0]?.steps).toHaveLength(1)
    expect(timeline[0]?.steps[0]).toMatchObject({
      id: 'aggregate',
      label: 'Aggregate',
      kind: 'tool',
      status: 'completed',
    })
  })
})
