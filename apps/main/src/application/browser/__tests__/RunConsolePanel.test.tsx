import { describe, expect, it, vi } from 'vitest'
import { RUNTIME_CONTRACT_SCHEMA_VERSION, type AgentEvent } from '@/packages/agent-protocol'
import { extractObservationArtifacts } from '@/apps/main/application/browser/RunConsolePanel'

vi.mock('@/apps/chat/application/browser/pagelet-agent-service', () => ({
  PageletAgentService: class {
    listRuns() {
      return Promise.resolve([])
    }

    listRunEvents() {
      return Promise.resolve([])
    }
  },
}))

vi.mock('@/apps/design/application/browser/pagelet-design-agent-service', () => ({
  PageletDesignAgentService: class {
    listAgentRuns() {
      return Promise.resolve([])
    }

    listAgentRunEvents() {
      return Promise.resolve([])
    }
  },
}))

describe('RunConsolePanel observation artifacts', () => {
  it('extracts observation artifact refs from computer.observe tool results', () => {
    const event: AgentEvent = {
      type: 'tool_result',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: 'run-observe',
      callId: 'call-observe',
      toolName: 'computer.observe',
      output: {
        observations: [{
          kind: 'screenshot',
          artifactRef: {
            uri: 'telegraph://computer-use-artifacts/run-observe/shot.png',
            mediaType: 'image/png',
            title: 'Desktop screenshot',
          },
        }],
      },
      ts: 1,
    }

    expect(extractObservationArtifacts(event)).toEqual([{
      kind: 'screenshot',
      uri: 'telegraph://computer-use-artifacts/run-observe/shot.png',
      mediaType: 'image/png',
      title: 'Desktop screenshot',
    }])
  })

  it('ignores non-observation tool output', () => {
    const event: AgentEvent = {
      type: 'tool_result',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: 'run-other',
      callId: 'call-other',
      toolName: 'other.tool',
      output: {
        ok: true,
      },
      ts: 1,
    }

    expect(extractObservationArtifacts(event)).toEqual([])
  })
})
