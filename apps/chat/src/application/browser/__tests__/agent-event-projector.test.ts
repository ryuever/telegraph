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
})
