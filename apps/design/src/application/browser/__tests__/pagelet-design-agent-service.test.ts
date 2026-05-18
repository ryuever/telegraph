import type {
  DesignAgentSendRequest,
  DesignAgentSendResult,
  DesignAgentStreamEvent,
  IDesignPageletService,
} from '@/apps/design/application/common'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let agentEventCallback: ((event: DesignAgentStreamEvent) => void) | null = null
const sendAgentMock = vi.fn(
  (_: DesignAgentSendRequest): Promise<DesignAgentSendResult> => new Promise<DesignAgentSendResult>(() => {}),
)
const cancelAgentMock = vi.fn(() => Promise.resolve(true))
const client: IDesignPageletService = {
  info: vi.fn(() => Promise.resolve('ready')),
  ping: vi.fn((now: number) => Promise.resolve({ pong: now, serverTime: now })),
  sendAgent: sendAgentMock,
  cancelAgent: cancelAgentMock,
  onAgentEvent: vi.fn((callback: (event: DesignAgentStreamEvent) => void) => {
    agentEventCallback = callback
    return { unsubscribe }
  }),
}
const unsubscribe = vi.fn()

vi.mock('../getClient', () => ({
  getDesignPageletClient: () => client,
}))

describe('PageletDesignAgentService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    agentEventCallback = null
    installLocalStorage()
  })

  it('cancels the pagelet run and unsubscribes when aborted', async () => {
    const { PageletDesignAgentService } = await import('../pagelet-design-agent-service')
    const controller = new AbortController()
    const service = new PageletDesignAgentService()
    const statuses: string[] = []

    const pending = service.send({
      prompt: 'make a card',
      sessionId: 'session-1',
      signal: controller.signal,
      onStatus: status => { statuses.push(status); },
    })

    await vi.waitFor(() => {
      expect(sendAgentMock).toHaveBeenCalled()
    })

    const runId = sendAgentMock.mock.calls[0]?.[0].runId
    controller.abort()

    await expect(pending).rejects.toThrow('Cancelled')
    expect(cancelAgentMock).toHaveBeenCalledWith(runId)
    expect(unsubscribe).toHaveBeenCalled()
    expect(statuses).toContain('cancelled')
  })

  it('projects runtime events on a completed design pagelet run and unsubscribes', async () => {
    sendAgentMock.mockImplementationOnce((request) => {
      agentEventCallback?.({
        type: 'agent_event',
        runId: request.runId,
        sessionId: request.sessionId,
        event: {
          type: 'assistant_delta',
          schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
          runId: request.runId,
          requestId: 'request-1',
          text: 'preview',
          ts: 1,
        },
      })
      return Promise.resolve({ runId: request.runId, status: 'completed' })
    })

    const { PageletDesignAgentService } = await import('../pagelet-design-agent-service')
    const text: string[] = []
    const statuses: string[] = []
    const service = new PageletDesignAgentService()

    await service.send({
      prompt: 'make a card',
      sessionId: 'session-1',
      onAssistantText: value => { text.push(value); },
      onStatus: status => { statuses.push(status); },
    })

    expect(text).toEqual(['preview'])
    expect(statuses).toContain('completed')
    expect(unsubscribe).toHaveBeenCalled()
  })
})

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
