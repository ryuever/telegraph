import type {
  ChatSendRequest,
  ChatSendResult,
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
const client: IChatPageletService = {
  info: vi.fn(() => Promise.resolve('ready')),
  send: sendMock,
  cancel: cancelMock,
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
