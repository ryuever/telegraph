import type {
  ChatSendRequest,
  ChatSendResult,
  ChatRunTraceBundle,
  ChatStreamEvent,
  IChatPageletService,
} from '@/apps/chat/application/common'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import type { ChatConversation } from '../types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let streamCallback: ((event: ChatStreamEvent) => void) | null = null
const unsubscribe = vi.fn()
const sendMock = vi.fn((_: ChatSendRequest): Promise<ChatSendResult> => new Promise<ChatSendResult>(() => {}))
const cancelMock = vi.fn(() => Promise.resolve(true))
const listRunsMock = vi.fn(() => Promise.resolve([]))
const getRunMock = vi.fn(() => Promise.resolve(null))
const listRunEventsMock = vi.fn(() => Promise.resolve([]))
const listRuntimeCapabilitiesMock = vi.fn(() => Promise.resolve([]))
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
const client: IChatPageletService = {
  info: vi.fn(() => Promise.resolve('ready')),
  send: sendMock,
  cancel: cancelMock,
  listRuns: listRunsMock,
  getRun: getRunMock,
  listRunEvents: listRunEventsMock,
  listRuntimeCapabilities: listRuntimeCapabilitiesMock,
  exportRunTraceBundle: exportRunTraceBundleMock,
  importRunTraceBundle: importRunTraceBundleMock,
  listPendingPermissions: listPendingPermissionsMock,
  resolvePermissionRequest: resolvePermissionRequestMock,
  listSubagents: listSubagentsMock,
  getSubagentResult: getSubagentResultMock,
  cancelSubagent: cancelSubagentMock,
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
    installLocalStorage()
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
        type: 'runtime_event',
        runId: request.runId,
        sessionId: request.sessionId,
        event: {
          type: 'assistant_delta',
          schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
          runId: request.runId,
          requestId: 'request-1',
          text: 'hello',
          ts: 1,
        },
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

  it('forwards persisted run console calls through the pagelet service', async () => {
    const { PageletAgentService } = await import('../pagelet-agent-service')
    const service = new PageletAgentService()

    await expect(service.listRuns({ sessionId: 'session-1', limit: 10 })).resolves.toEqual([])
    await expect(service.getRun('run-1')).resolves.toBeNull()
    await expect(service.listRunEvents('run-1')).resolves.toEqual([])

    expect(listRunsMock).toHaveBeenCalledWith({
      sessionId: 'session-1',
      status: undefined,
      limit: 10,
      offset: undefined,
    })
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

function installLocalStorage(): void {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
      clear: () => { values.clear(); },
    },
  })
}
