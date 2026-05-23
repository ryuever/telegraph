import type { AgentEvent } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import type { ChatSubagentUpdate, ChatToolCall, LlmTracePayload } from '@/apps/chat/application/common'
import { describe, expect, it } from 'vitest'
import { createChatAgentEventProjectionState, projectAgentEventToChat } from '../agent-event-projector'

function project(event: AgentEvent) {
  const chunks: string[] = []
  const statuses: string[] = []
  const tools: ChatToolCall[] = []
  const subagents: ChatSubagentUpdate[] = []
  const traces: LlmTracePayload[] = []

  projectAgentEventToChat(event, {
    sessionId: 'session-1',
    runId: 'run-1',
    onChunk: text => { chunks.push(text); },
    onStatus: status => { statuses.push(status); },
    onToolCall: call => { tools.push(call); },
    onSubagentUpdate: update => { subagents.push(update); },
    onLlmTrace: info => { traces.push(info.trace); },
  })

  return { chunks, statuses, tools, subagents, traces }
}

describe('projectAgentEventToChat', () => {
  it('projects assistant deltas and records the protocol trace row', () => {
    const event: AgentEvent = {
      type: 'assistant_delta',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: 'run-1',
      requestId: 'request-1',
      text: 'hello',
      ts: 1,
    }

    const result = project(event)

    expect(result.chunks).toEqual(['hello'])
    expect(result.statuses).toEqual(['running'])
    expect(result.traces).toEqual([{ kind: 'runtime_event', event }])
  })

  it('projects tool calls into chat tool cards', () => {
    const event: AgentEvent = {
      type: 'tool_call',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: 'run-1',
      callId: 'call-1',
      toolName: 'search',
      input: { query: 'telegraph' },
      ts: 1,
    }

    const result = project(event)

    expect(result.tools).toEqual([
      {
        id: 'call-1',
        name: 'search',
        input: { query: 'telegraph' },
        status: 'running',
      },
    ])
  })

  it('projects tool results and errors into tool card updates', () => {
    const resultEvent: AgentEvent = {
      type: 'tool_result',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: 'run-1',
      callId: 'call-1',
      toolName: 'search',
      output: { answer: 42 },
      ts: 1,
    }
    const errorEvent: AgentEvent = {
      type: 'tool_error',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: 'run-1',
      callId: 'call-2',
      toolName: 'read_file',
      error: { code: 'enoent', message: 'Missing file' },
      ts: 2,
    }

    expect(project(resultEvent).tools).toEqual([
      {
        id: 'call-1',
        name: 'search',
        output: { answer: 42 },
        status: 'done',
      },
    ])
    expect(project(errorEvent).tools).toEqual([
      {
        id: 'call-2',
        name: 'read_file',
        status: 'error',
        errorMessage: 'Missing file',
      },
    ])
  })

  it('normalizes failed and cancelled terminal events to failed chat status', () => {
    const failed: AgentEvent = {
      type: 'run_failed',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: 'run-1',
      error: { code: 'boom', message: 'Boom' },
      ts: 1,
    }
    const cancelled: AgentEvent = {
      type: 'run_cancelled',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: 'run-1',
      reason: 'user',
      ts: 2,
    }

    expect(project(failed).statuses).toEqual(['failed'])
    expect(project(cancelled).statuses).toEqual(['failed'])
  })

  it('uses terminal output as assistant text when a runtime has no deltas', () => {
    const state = createChatAgentEventProjectionState()
    const chunks: string[] = []
    const statuses: string[] = []

    projectAgentEventToChat({
      type: 'run_completed',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: 'run-1',
      output: { reply: 'orchestrator-core received: hello' },
      ts: 1,
    }, {
      sessionId: 'session-1',
      runId: 'run-1',
      onChunk: text => { chunks.push(text); },
      onStatus: status => { statuses.push(status); },
      projectionState: state,
    })

    expect(chunks).toEqual(['orchestrator-core received: hello'])
    expect(statuses).toEqual(['completed'])
  })

  it('does not duplicate terminal output after assistant deltas', () => {
    const state = createChatAgentEventProjectionState()
    const chunks: string[] = []

    for (const event of [
      {
        type: 'assistant_delta',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'run-1',
        requestId: 'request-1',
        text: 'hello',
        ts: 1,
      },
      {
        type: 'run_completed',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'run-1',
        output: { reply: 'hello' },
        ts: 2,
      },
    ] satisfies AgentEvent[]) {
      projectAgentEventToChat(event, {
        sessionId: 'session-1',
        runId: 'run-1',
        onChunk: text => { chunks.push(text); },
        projectionState: state,
      })
    }

    expect(chunks).toEqual(['hello'])
  })

  it('keeps child-run text and status out of the main chat projection', () => {
    const childDelta: AgentEvent = {
      type: 'assistant_delta',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: 'run-1-child',
      requestId: 'request-child',
      text: 'intermediate child output',
      ts: 1,
    }
    const childFailed: AgentEvent = {
      type: 'run_failed',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: 'run-1-child',
      error: { code: 'child_failed', message: 'Child failed' },
      ts: 2,
    }

    expect(project(childDelta)).toMatchObject({
      chunks: [],
      statuses: [],
      traces: [{ kind: 'runtime_event', event: childDelta }],
    })
    expect(project(childFailed)).toMatchObject({
      chunks: [],
      statuses: [],
      traces: [{ kind: 'runtime_event', event: childFailed }],
    })
  })

  it('keeps orchestrator step and edge events visible in the trace stream', () => {
    const step: AgentEvent = {
      type: 'step_started',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: 'run-1',
      stepId: 'planner',
      label: 'Planner',
      kind: 'worker',
      ts: 1,
    }
    const edge: AgentEvent = {
      type: 'edge_taken',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: 'run-1',
      from: 'planner',
      to: 'executor',
      ts: 2,
    }

    expect(project(step).traces).toEqual([{ kind: 'runtime_event', event: step }])
    expect(project(edge).traces).toEqual([{ kind: 'runtime_event', event: edge }])
  })

  it('projects child-run lifecycle into subagent updates without adding main chat text', () => {
    const state = createChatAgentEventProjectionState()
    const chunks: string[] = []
    const subagents: ChatSubagentUpdate[] = []
    const events: AgentEvent[] = [
      {
        type: 'child_run_started',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        parentRunId: 'run-1',
        childRunId: 'run-1-scout',
        label: 'Scout',
        ts: 1,
      },
      {
        type: 'assistant_delta',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'run-1-scout',
        requestId: 'request-child',
        text: 'reading runtime events',
        ts: 2,
      },
      {
        type: 'child_run_completed',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        parentRunId: 'run-1',
        childRunId: 'run-1-scout',
        output: { text: 'runtime event mapping looks correct', exitCode: 0, durationMs: 1200 },
        ts: 3,
      },
    ]

    for (const event of events) {
      projectAgentEventToChat(event, {
        sessionId: 'session-1',
        runId: 'run-1',
        onChunk: text => { chunks.push(text); },
        onSubagentUpdate: update => { subagents.push(update); },
        projectionState: state,
      })
    }

    expect(chunks).toEqual([])
    expect(subagents).toEqual([
      {
        parentRunId: 'run-1',
        childRunId: 'run-1-scout',
        name: 'Scout',
        status: 'running',
        lastUpdate: 'Starting',
        startedAt: 1,
      },
      {
        parentRunId: 'run-1',
        childRunId: 'run-1-scout',
        name: 'Scout',
        status: 'running',
        lastUpdate: 'reading runtime events',
      },
      {
        parentRunId: 'run-1',
        childRunId: 'run-1-scout',
        name: 'Scout',
        status: 'completed',
        summary: 'runtime event mapping looks correct',
        elapsedMs: 1200,
        completedAt: 3,
      },
    ])
  })
})
