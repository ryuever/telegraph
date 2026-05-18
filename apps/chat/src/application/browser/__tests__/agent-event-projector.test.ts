import type { AgentEvent } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import type { ChatToolCall, LlmTracePayload } from '@/apps/chat/application/common'
import { describe, expect, it } from 'vitest'
import { projectAgentEventToChat } from '../agent-event-projector'

function project(event: AgentEvent) {
  const chunks: string[] = []
  const statuses: string[] = []
  const tools: ChatToolCall[] = []
  const traces: LlmTracePayload[] = []

  projectAgentEventToChat(event, {
    sessionId: 'session-1',
    runId: 'run-1',
    onChunk: text => { chunks.push(text); },
    onStatus: status => { statuses.push(status); },
    onToolCall: call => { tools.push(call); },
    onLlmTrace: info => { traces.push(info.trace); },
  })

  return { chunks, statuses, tools, traces }
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
})
