import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RUNTIME_CONTRACT_SCHEMA_VERSION, type AgentEvent } from '@/packages/agent-protocol'
import { extractObservationArtifacts, projectConsoleLogGroups, RunConsolePanel } from '@/apps/main/application/browser/RunConsolePanel'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

const serviceMocks = vi.hoisted(() => ({
  listRuns: vi.fn((_options?: unknown) => Promise.resolve([] as unknown[])),
  listRunEvents: vi.fn((_runId?: string, _signal?: AbortSignal) => Promise.resolve([] as unknown[])),
  listAgentRuns: vi.fn((_signal?: AbortSignal) => Promise.resolve([] as unknown[])),
  listAgentRunEvents: vi.fn((_runId?: string, _signal?: AbortSignal) => Promise.resolve([] as unknown[])),
}))

vi.mock('@/apps/chat/application/browser/pagelet-agent-service', () => ({
  PageletAgentService: class {
    listRuns(options?: unknown) {
      return serviceMocks.listRuns(options)
    }

    listRunEvents(runId: string, signal?: AbortSignal) {
      return serviceMocks.listRunEvents(runId, signal)
    }
  },
}))

vi.mock('@/apps/design/application/browser/pagelet-design-agent-service', () => ({
  PageletDesignAgentService: class {
    listAgentRuns(signal?: AbortSignal) {
      return serviceMocks.listAgentRuns(signal)
    }

    listAgentRunEvents(runId: string, signal?: AbortSignal) {
      return serviceMocks.listAgentRunEvents(runId, signal)
    }
  },
}))

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

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

describe('RunConsolePanel log projection', () => {
  it('keeps model request message content in the original payload shape', () => {
    const event: AgentEvent = {
      type: 'model_request',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: 'run-context',
      requestId: 'req-context',
      payload: {
        systemPrompt: 'You are a helpful desktop assistant.',
        messages: [
          { role: 'user', content: 'Summarize the current run.' },
          { role: 'assistant', content: 'I will inspect the events.' },
        ],
        tools: [],
      },
      ts: 1,
    }

    expect(projectConsoleLogGroups({
      source: 'chat',
      runId: 'run-context',
      seq: 2,
      ts: 1,
      event,
    })).toMatchObject([
      {
        title: 'Model request',
        summary: '2 messages',
        messages: [
          {
            role: 'event',
            title: 'Request payload',
            content: JSON.stringify(event.payload, null, 2),
          },
        ],
      },
    ])
  })

  it('uses terminal output as an assistant message when available', () => {
    const event: AgentEvent = {
      type: 'run_completed',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: 'run-final',
      output: {
        role: 'assistant',
        content: 'Done: the run finished cleanly.',
      },
      ts: 1,
    }

    expect(projectConsoleLogGroups({
      source: 'chat',
      runId: 'run-final',
      seq: 4,
      ts: 1,
      event,
    })).toMatchObject([
      {
        title: 'Assistant message',
        summary: 'Done: the run finished cleanly.',
        messages: [
          { role: 'assistant', title: 'Assistant', content: 'Done: the run finished cleanly.' },
        ],
      },
    ])
  })

  it('filters thinking deltas out of the desktop run log', () => {
    const runtimeLog: AgentEvent = {
      type: 'runtime_log',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: 'run-thinking',
      level: 'debug',
      message: 'thinking_delta',
      raw: { type: 'thinking_delta', delta: 'private reasoning' },
      ts: 1,
    }
    const modelEvent: AgentEvent = {
      type: 'model_event',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: 'run-thinking',
      requestId: 'req-thinking',
      raw: { type: 'thinking_delta', delta: 'private reasoning' },
      ts: 2,
    }

    expect(projectConsoleLogGroups({
      source: 'chat',
      runId: 'run-thinking',
      seq: 1,
      ts: 1,
      event: runtimeLog,
    })).toEqual([])
    expect(projectConsoleLogGroups({
      source: 'chat',
      runId: 'run-thinking',
      seq: 2,
      ts: 2,
      event: modelEvent,
    })).toEqual([])
  })

  it('summarizes run_started without falling back to truncated raw JSON', () => {
    const event: AgentEvent = {
      type: 'run_started',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      producerVersion: 'telegraph-design-build@0.1.0',
      origin: { framework: 'telegraph', runtimeId: 'telegraph-design-build' },
      runId: 'run-started',
      pattern: 'prompt_chain',
      ts: 1,
    }

    expect(projectConsoleLogGroups({
      source: 'design',
      runId: 'run-started',
      seq: 1,
      ts: 1,
      event,
    })).toMatchObject([
      {
        title: 'Run started',
        summary: 'prompt_chain / telegraph-design-build',
        messages: [
          {
            title: 'Run started',
            content: [
              'Run: run-started',
              'Pattern: prompt_chain',
              'Runtime: telegraph-design-build',
              'Producer: telegraph-design-build@0.1.0',
            ].join('\n'),
          },
        ],
      },
    ])
  })
})

describe('RunConsolePanel interaction', () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount()
      })
    }
    container?.remove()
    container = undefined
    root = undefined
    serviceMocks.listRuns.mockReset()
    serviceMocks.listRunEvents.mockReset()
    serviceMocks.listAgentRuns.mockReset()
    serviceMocks.listAgentRunEvents.mockReset()
    serviceMocks.listRuns.mockResolvedValue([])
    serviceMocks.listRunEvents.mockResolvedValue([])
    serviceMocks.listAgentRuns.mockResolvedValue([])
    serviceMocks.listAgentRunEvents.mockResolvedValue([])
  })

  async function renderPanel(): Promise<HTMLDivElement> {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<RunConsolePanel />)
      await flushPromises()
    })

    return container
  }

  it('shows each model request once in the event sidebar and displays the raw request payload in the detail pane', async () => {
    const modelRequest: AgentEvent = {
      type: 'model_request',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: 'run-context',
      requestId: 'req-context',
      payload: {
        systemPrompt: 'Stay concise.',
        messages: [
          { role: 'user', content: 'What changed?' },
          { role: 'assistant', content: 'I grouped the request.' },
        ],
        tools: [],
      },
      ts: 10,
    }
    const toolCall: AgentEvent = {
      type: 'tool_call',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: 'run-context',
      callId: 'call-read',
      toolName: 'read_file',
      input: { path: 'README.md' },
      ts: 20,
    }

    serviceMocks.listRuns.mockResolvedValue([{
      runId: 'run-context',
      sessionId: 'session-context',
      status: 'completed',
      runtimeId: 'pi-ai',
      artifactRefs: [],
      settings: {},
      input: { message: 'What changed?' },
      inputPreview: 'What changed?',
      eventCount: 2,
      createdAt: 1,
      startedAt: 1,
      completedAt: 30,
      lastEventAt: 30,
    }])
    serviceMocks.listRunEvents.mockResolvedValue([
      { runId: 'run-context', sessionId: 'session-context', seq: 1, ts: 10, event: modelRequest },
      { runId: 'run-context', sessionId: 'session-context', seq: 2, ts: 20, event: toolCall },
    ])

    const panel = await renderPanel()
    await act(async () => {
      await flushPromises()
    })

    const modelRequestButtons = Array.from(panel.querySelectorAll('button'))
      .filter(button => button.textContent.includes('Model request'))
    expect(modelRequestButtons).toHaveLength(1)
    expect(panel.textContent).toContain('Request payload')
    expect(panel.textContent).toContain('"systemPrompt": "Stay concise."')
    expect(panel.textContent).toContain('"role": "user"')
    expect(panel.textContent).toContain('Stay concise.')
    expect(panel.textContent).toContain('What changed?')
    expect(panel.textContent).toContain('I grouped the request.')

    const toolButton = Array.from(panel.querySelectorAll('button'))
      .find(button => button.textContent.includes('Tool call: read_file'))
    expect(toolButton).toBeDefined()

    await act(async () => {
      toolButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
    })

    expect(panel.textContent).toContain('Tool call: read_file')
    expect(panel.textContent).toContain('read_file')
  })
})
