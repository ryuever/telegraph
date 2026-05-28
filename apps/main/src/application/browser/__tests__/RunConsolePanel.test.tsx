import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RUNTIME_CONTRACT_SCHEMA_VERSION, type AgentEvent } from '@/packages/agent-protocol'
import { extractObservationArtifacts, projectConsoleLogGroups, RunConsolePanel } from '@/apps/main/application/browser/RunConsolePanel'
import { PageletActivityProvider, type PageletId } from '@/apps/main/application/browser/pagelet-activity'
import { CHAT_PAGE, RUN_CONSOLE_PAGE } from '@/apps/main/application/common/cp-config'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

const serviceMocks = vi.hoisted(() => ({
  listRuns: vi.fn((_options?: unknown) => Promise.resolve([] as unknown[])),
  listRunEvents: vi.fn((_runId?: string, _signal?: AbortSignal) => Promise.resolve([] as unknown[])),
  listAgentRuns: vi.fn((_signal?: AbortSignal) => Promise.resolve([] as unknown[])),
  listAgentRunEvents: vi.fn((_runId?: string, _signal?: AbortSignal) => Promise.resolve([] as unknown[])),
  deleteSessionRuns: vi.fn((sessionId: string): Promise<{ sessionId: string; deletedRunIds: string[] }> =>
    Promise.resolve({ sessionId, deletedRunIds: [] })),
  deleteAgentSessionRuns: vi.fn((sessionId: string): Promise<{ sessionId: string; deletedRunIds: string[] }> =>
    Promise.resolve({ sessionId, deletedRunIds: [] })),
}))

vi.mock('@/apps/chat/application/browser/pagelet-agent-service', () => ({
  PageletAgentService: class {
    listRuns(options?: unknown) {
      return serviceMocks.listRuns(options)
    }

    listRunEvents(runId: string, signal?: AbortSignal) {
      return serviceMocks.listRunEvents(runId, signal)
    }

    deleteSessionRuns(sessionId: string) {
      return serviceMocks.deleteSessionRuns(sessionId)
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

    deleteAgentSessionRuns(sessionId: string) {
      return serviceMocks.deleteAgentSessionRuns(sessionId)
    }
  },
}))

vi.mock('@monaco-editor/react', () => ({
  default: (props: { value?: string; language?: string; options?: Record<string, unknown> }) => {
    const readOnly = props.options?.readOnly
    return (
      <div
        data-testid="run-log-editor"
        data-language={props.language}
        data-readonly={typeof readOnly === 'boolean' ? String(readOnly) : 'false'}
      >
        {props.value}
      </div>
    )
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
    serviceMocks.deleteSessionRuns.mockReset()
    serviceMocks.deleteAgentSessionRuns.mockReset()
    serviceMocks.listRuns.mockResolvedValue([])
    serviceMocks.listRunEvents.mockResolvedValue([])
    serviceMocks.listAgentRuns.mockResolvedValue([])
    serviceMocks.listAgentRunEvents.mockResolvedValue([])
    serviceMocks.deleteSessionRuns.mockResolvedValue({ sessionId: 'session', deletedRunIds: [] })
    serviceMocks.deleteAgentSessionRuns.mockResolvedValue({ sessionId: 'session', deletedRunIds: [] })
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

  async function renderPanelWithActivePage(activePageId: PageletId): Promise<HTMLDivElement> {
    container ??= document.createElement('div')
    if (!container.isConnected) document.body.append(container)
    root ??= createRoot(container)

    await act(async () => {
      root?.render(
        <PageletActivityProvider activePageId={activePageId} pageId={RUN_CONSOLE_PAGE.id}>
          <RunConsolePanel />
        </PageletActivityProvider>,
      )
      await flushPromises()
    })

    return container
  }

  it('refreshes runs when the keep-alive run console becomes active again', async () => {
    serviceMocks.listRuns
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        runId: 'run-new-session',
        sessionId: 'session-new',
        status: 'completed',
        runtimeId: 'pi-ai',
        artifactRefs: [],
        settings: {},
        input: { message: 'New session from chat' },
        inputPreview: 'New session from chat',
        eventCount: 1,
        createdAt: 10,
        startedAt: 10,
        completedAt: 12,
        lastEventAt: 12,
      }])

    const panel = await renderPanelWithActivePage(RUN_CONSOLE_PAGE.id)
    await act(async () => {
      await flushPromises()
    })

    expect(serviceMocks.listRuns).toHaveBeenCalledTimes(1)
    expect(panel.textContent).not.toContain('New session from chat')

    await renderPanelWithActivePage(CHAT_PAGE.id)
    await act(async () => {
      await flushPromises()
    })

    expect(serviceMocks.listRuns).toHaveBeenCalledTimes(1)

    await renderPanelWithActivePage(RUN_CONSOLE_PAGE.id)
    await act(async () => {
      await flushPromises()
    })

    expect(serviceMocks.listRuns).toHaveBeenCalledTimes(2)
    expect(panel.textContent).toContain('New session from chat')
  })

  it('defaults to chat runs without rendering an all filter or source column', async () => {
    serviceMocks.listAgentRuns.mockResolvedValue([{
      runId: 'design-run',
      sessionId: 'design-session',
      status: 'completed',
      prompt: 'Design-only run',
      events: [],
      startedAt: 1,
      completedAt: 2,
      updatedAt: 2,
    }])
    serviceMocks.listRuns.mockResolvedValue([{
      runId: 'chat-run',
      sessionId: 'chat-session',
      status: 'completed',
      runtimeId: 'pi-ai',
      artifactRefs: [],
      settings: {},
      input: { message: 'Chat default run' },
      inputPreview: 'Chat default run',
      eventCount: 1,
      createdAt: 3,
      startedAt: 3,
      completedAt: 4,
      lastEventAt: 4,
    }])

    const panel = await renderPanel()
    await act(async () => {
      await flushPromises()
    })

    const filterLabels = Array.from(panel.querySelectorAll('header button'))
      .map(button => button.textContent?.trim())
      .filter(Boolean)

    expect(filterLabels).not.toContain('All')
    expect(panel.textContent).not.toContain('Source')
    expect(panel.textContent).toContain('Chat default run')
    expect(panel.textContent).not.toContain('Design-only run')
  })

  it('groups runs from the same session under a collapsible tree parent', async () => {
    serviceMocks.listRuns.mockResolvedValue([
      {
        runId: 'run-shared-1',
        sessionId: 'session-shared',
        status: 'completed',
        runtimeId: 'pi-ai',
        artifactRefs: [],
        settings: {},
        input: { message: 'First turn' },
        inputPreview: 'First turn',
        eventCount: 1,
        createdAt: 1,
        startedAt: 1,
        completedAt: 2,
        lastEventAt: 2,
      },
      {
        runId: 'run-shared-2',
        sessionId: 'session-shared',
        status: 'completed',
        runtimeId: 'pi-ai',
        artifactRefs: [],
        settings: {},
        input: { message: 'Follow up' },
        inputPreview: 'Follow up',
        eventCount: 3,
        createdAt: 3,
        startedAt: 3,
        completedAt: 4,
        lastEventAt: 4,
      },
      {
        runId: 'run-alone',
        sessionId: 'session-alone',
        status: 'running',
        runtimeId: 'pi-ai',
        artifactRefs: [],
        settings: {},
        input: { message: 'Separate thread' },
        inputPreview: 'Separate thread',
        eventCount: 2,
        createdAt: 5,
        startedAt: 5,
        lastEventAt: 6,
      },
    ])

    const panel = await renderPanel()
    await act(async () => {
      await flushPromises()
    })

    const parentButtons = Array.from(panel.querySelectorAll<HTMLButtonElement>('button[aria-expanded]'))
    expect(parentButtons).toHaveLength(2)
    expect(parentButtons.every(button => button.getAttribute('aria-expanded') === 'false')).toBe(true)
    expect(panel.textContent).toContain('session-shared')
    expect(panel.textContent).toContain('2 runs')
    expect(panel.textContent).not.toContain('run-shared-1')
    expect(panel.textContent).not.toContain('run-shared-2')

    const sharedParent = parentButtons.find(button => button.getAttribute('aria-label')?.includes('session-shared'))
    expect(sharedParent).toBeDefined()

    await act(async () => {
      sharedParent?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
    })

    expect(sharedParent?.getAttribute('aria-expanded')).toBe('true')
    expect(panel.textContent).toContain('run-shared-1')
    expect(panel.textContent).toContain('run-shared-2')

    await act(async () => {
      sharedParent?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
    })

    expect(sharedParent?.getAttribute('aria-expanded')).toBe('false')
    expect(panel.textContent).toContain('session-shared')
    expect(panel.textContent).toContain('2 runs')
    expect(panel.textContent).not.toContain('run-shared-1')
    expect(panel.textContent).not.toContain('run-shared-2')
  })

  it('deletes a session item from the run tree', async () => {
    serviceMocks.listRuns.mockResolvedValue([
      {
        runId: 'run-delete',
        sessionId: 'session-delete',
        status: 'completed',
        runtimeId: 'pi-ai',
        artifactRefs: [],
        settings: {},
        input: { message: 'Delete me' },
        inputPreview: 'Delete me',
        eventCount: 1,
        createdAt: 1,
        startedAt: 1,
        completedAt: 2,
        lastEventAt: 2,
      },
      {
        runId: 'run-keep',
        sessionId: 'session-keep',
        status: 'completed',
        runtimeId: 'pi-ai',
        artifactRefs: [],
        settings: {},
        input: { message: 'Keep me' },
        inputPreview: 'Keep me',
        eventCount: 1,
        createdAt: 3,
        startedAt: 3,
        completedAt: 4,
        lastEventAt: 4,
      },
    ])
    serviceMocks.deleteSessionRuns.mockResolvedValue({
      sessionId: 'session-delete',
      deletedRunIds: ['run-delete'],
    })

    const panel = await renderPanel()
    await act(async () => {
      await flushPromises()
    })

    expect(panel.textContent).toContain('Delete me')
    expect(panel.textContent).toContain('Keep me')

    const deleteButton = Array.from(panel.querySelectorAll<HTMLButtonElement>('button'))
      .find(button => button.getAttribute('aria-label') === 'Delete Chat session session-delete')
    expect(deleteButton).toBeDefined()

    await act(async () => {
      deleteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await flushPromises()
    })

    expect(serviceMocks.deleteSessionRuns).toHaveBeenCalledWith('session-delete')
    expect(panel.textContent).not.toContain('Delete me')
    expect(panel.textContent).not.toContain('session-delete')
    expect(panel.textContent).toContain('Keep me')
  })

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
    const jsonEditor = panel.querySelector('[data-testid="run-log-editor"]')
    expect(jsonEditor?.getAttribute('data-language')).toBe('json')
    expect(jsonEditor?.getAttribute('data-readonly')).toBe('true')

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

  it('renders trailing JSON details in the log editor when the message has a text prefix', async () => {
    const runtimeLog: AgentEvent = {
      type: 'runtime_log',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: 'run-runtime-log',
      level: 'info',
      message: 'Router selected child agents',
      raw: {
        selected: ['scout', 'reviewer'],
        mode: 'parallel',
      },
      ts: 10,
    }

    serviceMocks.listRuns.mockResolvedValue([{
      runId: 'run-runtime-log',
      sessionId: 'session-runtime-log',
      status: 'completed',
      runtimeId: 'telegraph-subagents',
      artifactRefs: [],
      settings: {},
      input: { message: 'inspect routing' },
      inputPreview: 'inspect routing',
      eventCount: 1,
      createdAt: 1,
      startedAt: 1,
      completedAt: 30,
      lastEventAt: 30,
    }])
    serviceMocks.listRunEvents.mockResolvedValue([
      { runId: 'run-runtime-log', sessionId: 'session-runtime-log', seq: 1, ts: 10, event: runtimeLog },
    ])

    const panel = await renderPanel()
    await act(async () => {
      await flushPromises()
    })

    expect(panel.textContent).toContain('Router selected child agents')
    const jsonEditor = panel.querySelector('[data-testid="run-log-editor"]')
    expect(jsonEditor?.getAttribute('data-language')).toBe('json')
    expect(jsonEditor?.textContent).toContain('"selected"')
    expect(jsonEditor?.textContent).toContain('"parallel"')
  })
})
