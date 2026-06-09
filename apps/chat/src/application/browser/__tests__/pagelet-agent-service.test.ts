import type {
  ChatSendRequest,
  ChatSendResult,
  ChatRunTraceBundle,
  ChatStreamEvent,
  IChatPageletService,
  AgentRuntimeSettings,
} from '@/apps/chat/application/common'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import type { ChatConversation } from '../types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let streamCallback: ((event: ChatStreamEvent) => void) | null = null
let runtimeSettings: AgentRuntimeSettings
const unsubscribe = vi.fn()
const sendMock = vi.fn((_: ChatSendRequest): Promise<ChatSendResult> => new Promise<ChatSendResult>(() => {}))
const cancelMock = vi.fn(() => Promise.resolve(true))
const listRunsMock = vi.fn(() => Promise.resolve([]))
const deleteSessionRunsMock = vi.fn((sessionId: string) => Promise.resolve({ sessionId, deletedRunIds: [] }))
const getRunMock = vi.fn(() => Promise.resolve(null))
const listRunEventsMock = vi.fn(() => Promise.resolve([]))
const listRuntimeCapabilitiesMock = vi.fn(() => Promise.resolve([]))
const listConfiguredModelsMock = vi.fn(() => Promise.resolve([]))
const getRuntimeSettingsMock = vi.fn(() => Promise.resolve(runtimeSettings))
const updateRuntimeSettingsMock = vi.fn((settings: AgentRuntimeSettings) => {
  runtimeSettings = settings
  return Promise.resolve(settings)
})
const exportRunTraceBundleMock = vi.fn(() => Promise.resolve(null))
const importRunTraceBundleMock = vi.fn((bundle: ChatRunTraceBundle) => Promise.resolve({
  status: 'imported' as const,
  record: bundle.run,
}))
const listPendingPermissionsMock = vi.fn(() => Promise.resolve([]))
const resolvePermissionRequestMock = vi.fn(() => Promise.resolve(true))
const listSubagentsMock = vi.fn(() => Promise.resolve([]))
const getSubagentResultMock = vi.fn(() => Promise.resolve(null))
const cancelSubagentMock = vi.fn(() => Promise.resolve(false))
const invokeCommandMock = vi.fn<IChatPageletService['invokeCommand']>(() =>
  Promise.resolve({ ok: true, result: undefined })
)
const client: IChatPageletService = {
  info: vi.fn(() => Promise.resolve('ready')),
  send: sendMock,
  cancel: cancelMock,
  listRuns: listRunsMock,
  deleteSessionRuns: deleteSessionRunsMock,
  getRun: getRunMock,
  listRunEvents: listRunEventsMock,
  listRuntimeCapabilities: listRuntimeCapabilitiesMock,
  listConfiguredModels: listConfiguredModelsMock,
  getRuntimeSettings: getRuntimeSettingsMock,
  updateRuntimeSettings: updateRuntimeSettingsMock,
  exportRunTraceBundle: exportRunTraceBundleMock,
  importRunTraceBundle: importRunTraceBundleMock,
  listPendingPermissions: listPendingPermissionsMock,
  resolvePermissionRequest: resolvePermissionRequestMock,
  listSubagents: listSubagentsMock,
  getSubagentResult: getSubagentResultMock,
  cancelSubagent: cancelSubagentMock,
  invokeCommand: invokeCommandMock,
  onStreamEvent: vi.fn((callback: (event: ChatStreamEvent) => void) => {
    streamCallback = callback
    return { unsubscribe }
  }),
}

vi.mock('../getClient', () => ({
  getChatPageletClient: () => client,
}))

describe('PageletAgentService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    streamCallback = null
    runtimeSettings = defaultRuntimeSettings()
  })

  it('cancels the pagelet run and unsubscribes when aborted', async () => {
    const { PageletAgentService } = await import('../pagelet-agent-service')
    const controller = new AbortController()
    const service = new PageletAgentService()
    const pending = service.send({
      conversation: conversationFixture(),
      signal: controller.signal,
      onChunk: vi.fn(),
    })

    await vi.waitFor(() => {
      expect(sendMock).toHaveBeenCalled()
    })

    const runId = sendMock.mock.calls[0]?.[0].runId
    controller.abort()

    await expect(pending).rejects.toThrow('Cancelled')
    expect(cancelMock).toHaveBeenCalledWith(runId)
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('projects runtime events on a completed pagelet run and unsubscribes', async () => {
    sendMock.mockImplementationOnce((request) => {
      streamCallback?.({
        type: 'assistant_delta',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: request.runId,
        requestId: 'request-1',
        text: 'hello',
        ts: 1,
      })
      return Promise.resolve({ runId: request.runId, status: 'completed' })
    })

    const { PageletAgentService } = await import('../pagelet-agent-service')
    const chunks: string[] = []
    const statuses: string[] = []
    const service = new PageletAgentService()

    await service.send({
      conversation: conversationFixture(),
      onChunk: chunk => { chunks.push(chunk); },
      onStatus: status => { statuses.push(status); },
    })

    expect(chunks).toEqual(['hello'])
    expect(statuses).toContain('completed')
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('rejects when the pagelet run fails', async () => {
    sendMock.mockResolvedValueOnce({
      runId: 'run-failed',
      status: 'failed',
      error: 'missing model credentials',
    })

    const { PageletAgentService } = await import('../pagelet-agent-service')
    const statuses: string[] = []
    const service = new PageletAgentService()

    await expect(service.send({
      conversation: conversationFixture(),
      onChunk: vi.fn(),
      onStatus: status => { statuses.push(status); },
    })).rejects.toThrow('missing model credentials')

    expect(statuses).toContain('failed')
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('forwards the restored conversation transcript to the pagelet', async () => {
    sendMock.mockResolvedValueOnce({ runId: 'run-history', status: 'completed' })
    const { PageletAgentService } = await import('../pagelet-agent-service')
    const service = new PageletAgentService()

    await service.send({
      conversation: conversationWithHistoryFixture(),
      onChunk: vi.fn(),
    })

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      message: 'second question',
      currentMessageId: 'msg-user-2',
      sessionId: 'session-history',
      messages: [
        {
          id: 'msg-user-1',
          role: 'user',
          content: 'first question',
          status: 'done',
          metadata: { createdAt: 1, source: 'chat-renderer' },
        },
        {
          id: 'msg-assistant-1',
          role: 'assistant',
          content: 'first answer',
          status: 'done',
          metadata: { createdAt: 2, source: 'chat-renderer' },
        },
        {
          id: 'msg-user-2',
          role: 'user',
          content: 'second question',
          status: 'done',
          metadata: { createdAt: 4, source: 'chat-renderer' },
        },
      ],
    }))
  })

  it('normalizes design-only runtime settings before sending chat runs', async () => {
    runtimeSettings = {
      provider: 'minimax-cn',
      modelId: 'MiniMax-M2.7',
      apiKey: '',
      authMode: 'api-key',
      backend: 'telegraph-design-build',
      orchestration: 'none',
      taskCapabilityProfile: {
        kind: 'design-build',
        scopes: [],
        artifactPolicy: 'preview',
      },
    }
    sendMock.mockResolvedValueOnce({ runId: 'run-normalized', status: 'completed' })

    const { PageletAgentService } = await import('../pagelet-agent-service')
    const service = new PageletAgentService()

    await service.send({
      conversation: conversationFixture(),
      onChunk: vi.fn(),
    })

    const request = sendMock.mock.calls[0][0]
    expect(request.settings.backend).toBe('pi-ai')
    expect(request.settings.taskCapabilityProfile).toEqual({
      kind: 'design-build',
      scopes: [],
      artifactPolicy: 'preview',
    })
  })

  it('forwards pending permission requests from the pagelet stream', async () => {
    sendMock.mockImplementationOnce((request) => {
      streamCallback?.({
        type: 'permission_pending',
        runId: request.runId,
        sessionId: request.sessionId,
        permissionRequest: {
          id: 'perm-1',
          runId: request.runId,
          sessionId: request.sessionId,
          permission: { type: 'filesystem', scope: 'workspace', access: 'write' },
          context: {
            runId: request.runId,
            sessionId: request.sessionId,
            pageletId: 'chat',
            pageletKind: 'chat',
          },
          proposedDecision: {
            granted: false,
            source: 'profile',
            reason: 'Filesystem workspace write requires user approval',
            requiresUserDecision: true,
          },
          createdAt: 1,
        },
      })
      return Promise.resolve({ runId: request.runId, status: 'completed' })
    })

    const { PageletAgentService } = await import('../pagelet-agent-service')
    const permissions: string[] = []
    const service = new PageletAgentService()

    await service.send({
      conversation: conversationFixture(),
      onChunk: vi.fn(),
      onPermissionRequest: request => { permissions.push(request.id); },
    })

    expect(permissions).toEqual(['perm-1'])
  })

  it('forwards subagent control calls through the pagelet service', async () => {
    const { PageletAgentService } = await import('../pagelet-agent-service')
    const service = new PageletAgentService()

    await expect(service.listSubagents()).resolves.toEqual([])
    await expect(service.getSubagentResult('child-1', { consume: true })).resolves.toBeNull()
    await expect(service.cancelSubagent('child-1')).resolves.toBe(false)

    expect(listSubagentsMock).toHaveBeenCalled()
    expect(getSubagentResultMock).toHaveBeenCalledWith('child-1', true)
    expect(cancelSubagentMock).toHaveBeenCalledWith('child-1')
  })

  it('forwards slash-command invocations to the pagelet client and returns the envelope verbatim', async () => {
    const { PageletAgentService } = await import('../pagelet-agent-service')
    const service = new PageletAgentService()

    invokeCommandMock.mockResolvedValueOnce({ ok: true, result: { bookmarked: 'm_42' } })
    await expect(service.invokeCommand('bookmark', { messageId: 'm_42' })).resolves.toEqual({
      ok: true,
      result: { bookmarked: 'm_42' },
    })
    expect(invokeCommandMock).toHaveBeenCalledWith('bookmark', { messageId: 'm_42' })
  })

  it('forwards persisted run console calls through the pagelet service', async () => {
    const { PageletAgentService } = await import('../pagelet-agent-service')
    const service = new PageletAgentService()

    await expect(service.listRuns({ sessionId: 'session-1', limit: 10 })).resolves.toEqual([])
    await expect(service.deleteSessionRuns('session-1')).resolves.toEqual({ sessionId: 'session-1', deletedRunIds: [] })
    await expect(service.getRun('run-1')).resolves.toBeNull()
    await expect(service.listRunEvents('run-1')).resolves.toEqual([])

    expect(listRunsMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      status: undefined,
      limit: 10,
      offset: undefined,
    })
    expect(deleteSessionRunsMock).toHaveBeenCalledWith('session-1')
    expect(getRunMock).toHaveBeenCalledWith('run-1')
    expect(listRunEventsMock).toHaveBeenCalledWith('run-1')
  })

  it('forwards replay metadata and trace bundle export through the pagelet service', async () => {
    sendMock.mockResolvedValueOnce({ runId: 'run-replay', status: 'completed' })
    const { PageletAgentService } = await import('../pagelet-agent-service')
    const service = new PageletAgentService()

    await service.send({
      conversation: conversationFixture(),
      parentRunId: 'run-source',
      replay: {
        mode: 'fork',
        sourceRunId: 'run-source',
        sourceEventSeq: 3,
      },
      onChunk: vi.fn(),
    })
    const bundle = {
      schemaVersion: 1 as const,
      exportedAt: 1,
      run: {
        runId: 'run-source',
        sessionId: 'session-1',
        status: 'completed' as const,
        runtimeId: 'pi-ai',
        artifactRefs: [],
        settings: {},
        eventCount: 0,
        createdAt: 1,
      },
      events: [],
    }
    await expect(service.exportRunTraceBundle('run-source')).resolves.toBeNull()
    await expect(service.importRunTraceBundle(bundle)).resolves.toEqual({
      status: 'imported',
      record: bundle.run,
    })

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      parentRunId: 'run-source',
      replay: {
        mode: 'fork',
        sourceRunId: 'run-source',
        sourceEventSeq: 3,
      },
    }))
    expect(exportRunTraceBundleMock).toHaveBeenCalledWith('run-source')
    expect(importRunTraceBundleMock).toHaveBeenCalledWith(bundle)
  })

  it('forwards runtime capability matrix calls through the pagelet service', async () => {
    const { PageletAgentService } = await import('../pagelet-agent-service')
    const service = new PageletAgentService()

    await expect(service.listRuntimeCapabilities()).resolves.toEqual([])

    expect(listRuntimeCapabilitiesMock).toHaveBeenCalled()
  })

  it('forwards configured model list calls through the pagelet service', async () => {
    const { PageletAgentService } = await import('../pagelet-agent-service')
    const service = new PageletAgentService()

    await expect(service.listConfiguredModels()).resolves.toEqual([])

    expect(listConfiguredModelsMock).toHaveBeenCalled()
  })

  it('forwards permission approval calls through the pagelet service', async () => {
    const { PageletAgentService } = await import('../pagelet-agent-service')
    const service = new PageletAgentService()

    await expect(service.listPendingPermissions('run-1')).resolves.toEqual([])
    await expect(service.resolvePermissionRequest('perm-1', { granted: true })).resolves.toBe(true)

    expect(listPendingPermissionsMock).toHaveBeenCalledWith('run-1')
    expect(resolvePermissionRequestMock).toHaveBeenCalledWith('perm-1', { granted: true })
  })
})

function conversationFixture(): ChatConversation {
  return {
    id: 'session-1',
    title: 'Test',
    createdAt: 1,
    updatedAt: 1,
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        content: 'hello',
        createdAt: 1,
        status: 'done',
      },
    ],
  }
}

function conversationWithHistoryFixture(): ChatConversation {
  return {
    id: 'session-history',
    title: 'History',
    createdAt: 1,
    updatedAt: 4,
    messages: [
      {
        id: 'msg-user-1',
        role: 'user',
        content: 'first question',
        createdAt: 1,
        status: 'done',
      },
      {
        id: 'msg-assistant-1',
        role: 'assistant',
        content: 'first answer',
        createdAt: 2,
        status: 'done',
      },
      {
        id: 'msg-assistant-streaming',
        role: 'assistant',
        content: 'draft answer',
        createdAt: 3,
        status: 'streaming',
      },
      {
        id: 'msg-user-2',
        role: 'user',
        content: 'second question',
        createdAt: 4,
        status: 'done',
      },
    ],
  }
}

function defaultRuntimeSettings(): AgentRuntimeSettings {
  return {
    provider: 'minimax-cn',
    modelId: 'MiniMax-M2.7',
    apiKey: '',
    authMode: 'api-key',
    backend: 'pi-ai',
    orchestration: 'none',
    orchestrationPattern: 'chain',
    worktreeIsolation: false,
    extensionBlocklist: [],
    taskCapabilityProfile: { kind: 'default' },
  }
}
