import type { AgentEvent } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { describe, expect, it } from 'vitest'
import type { DesignProjectedArtifact } from '../design-agent-projector'
import {
  projectAgentEventToDesign,
  projectDesignAgentRunEventRecords,
} from '../design-agent-projector'

function collect(events: AgentEvent[]) {
  const statuses: string[] = []
  const assistantText: string[] = []
  const artifacts: DesignProjectedArtifact[] = []
  const traceTypes: string[] = []

  for (const event of events) {
    projectAgentEventToDesign(event, {
      onStatus: status => { statuses.push(status); },
      onAssistantText: text => { assistantText.push(text); },
      onArtifact: artifact => { artifacts.push(artifact); },
      onTraceEvent: traceEvent => { traceTypes.push(traceEvent.type); },
    })
  }

  return { statuses, assistantText, artifacts, traceTypes }
}

describe('projectAgentEventToDesign', () => {
  it('projects run status and assistant text without chat message state', () => {
    const events: AgentEvent[] = [
      {
        type: 'run_started',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'design-run',
        pattern: 'single_llm',
        ts: 1,
      },
      {
        type: 'assistant_message',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'design-run',
        requestId: 'request-1',
        message: {
          id: 'message-1',
          role: 'assistant',
          content: 'Generated a preview artifact.',
        },
        ts: 2,
      },
      {
        type: 'run_completed',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'design-run',
        output: 'done',
        ts: 3,
      },
    ]

    const result = collect(events)

    expect(result.statuses).toEqual(['running', 'completed'])
    expect(result.assistantText).toEqual(['Generated a preview artifact.'])
    expect(result.traceTypes).toEqual(['run_started', 'assistant_message', 'run_completed'])
  })

  it('projects design artifacts from tool results and run output', () => {
    const events: AgentEvent[] = [
      {
        type: 'tool_result',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'design-run',
        callId: 'call-1',
        toolName: 'create_component',
        output: {
          artifact: {
            id: 'artifact-1',
            kind: 'component',
            title: 'Hero',
            code: '<Hero />',
          },
        },
        ts: 1,
      },
      {
        type: 'run_completed',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'design-run',
        output: {
          artifactId: 'artifact-2',
          artifactKind: 'canvas_patch',
          name: 'Apply hero patch',
          operations: [],
        },
        ts: 2,
      },
    ]

    const result = collect(events)

    expect(result.artifacts.map(artifact => ({
      id: artifact.id,
      kind: artifact.kind,
      title: artifact.title,
      sourceEventType: artifact.sourceEventType,
    }))).toEqual([
      {
        id: 'artifact-1',
        kind: 'component',
        title: 'Hero',
        sourceEventType: 'tool_result',
      },
      {
        id: 'artifact-2',
        kind: 'canvas_patch',
        title: 'Apply hero patch',
        sourceEventType: 'run_completed',
      },
    ])
  })

  it('keeps cancelled runs distinct from failed runs', () => {
    const result = collect([
      {
        type: 'run_cancelled',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'design-run',
        reason: 'user stopped',
        ts: 1,
      },
    ])

    expect(result.statuses).toEqual(['cancelled'])
  })

  it('replays persisted ledger records into the same design projection', () => {
    const projection = projectDesignAgentRunEventRecords([
      {
        runId: 'design-run',
        sessionId: 'session-1',
        seq: 3,
        ts: 3,
        event: {
          type: 'run_completed',
          schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
          runId: 'design-run',
          output: {
            artifactId: 'artifact-1',
            artifactKind: 'component',
            title: 'Updated button',
          },
          ts: 3,
        },
      },
      {
        runId: 'design-run',
        sessionId: 'session-1',
        seq: 1,
        ts: 1,
        event: {
          type: 'run_started',
          schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
          runId: 'design-run',
          ts: 1,
        },
      },
      {
        runId: 'design-run',
        sessionId: 'session-1',
        seq: 2,
        ts: 2,
        event: {
          type: 'assistant_delta',
          schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
          runId: 'design-run',
          requestId: 'request-1',
          text: 'Done',
          ts: 2,
        },
      },
    ])

    expect(projection.status).toBe('completed')
    expect(projection.assistantText).toBe('Done')
    expect(projection.traceEvents.map(event => event.type)).toEqual([
      'run_started',
      'assistant_delta',
      'run_completed',
    ])
    expect(projection.artifacts.map(artifact => ({
      id: artifact.id,
      kind: artifact.kind,
      title: artifact.title,
    }))).toEqual([
      {
        id: 'artifact-1',
        kind: 'component',
        title: 'Updated button',
      },
    ])
  })

  it('replays persisted child run events into subagent projection', () => {
    const projection = projectDesignAgentRunEventRecords([
      {
        runId: 'design-run',
        sessionId: 'session-1',
        seq: 1,
        ts: 1,
        event: {
          type: 'child_run_started',
          schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
          parentRunId: 'design-run',
          childRunId: 'child-1',
          label: 'Critique',
          raw: {
            profileId: 'reviewer',
            profile: {
              title: 'Reviewer',
              description: 'Reviews generated UI',
            },
          },
          ts: 1,
        },
      },
      {
        runId: 'design-run',
        sessionId: 'session-1',
        seq: 2,
        ts: 2,
        event: {
          type: 'child_run_completed',
          schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
          parentRunId: 'design-run',
          childRunId: 'child-1',
          output: {
            summary: 'Looks good',
          },
          ts: 2,
        },
      },
    ])

    expect(projection.subagents).toEqual([
      expect.objectContaining({
        id: 'child-1',
        parentRunId: 'design-run',
        label: 'Critique',
        agent: 'Reviewer',
        profileId: 'reviewer',
        status: 'completed',
        result: 'Looks good',
        completedAt: 2,
      }),
    ])
  })
})
