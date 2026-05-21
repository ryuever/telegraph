import type {
  DesignAgentSendRequest,
  DesignAgentSendResult,
  DesignArtifactPatchApplyResult,
  DesignArtifactPatchPreviewResult,
  DesignArtifactPatchRequest,
  DesignAgentStreamEvent,
  IDesignPageletService,
} from '@/apps/design/application/common'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { AGENT_MODEL_SETTINGS_STORAGE_KEY } from '@/packages/agent/browser/runtime-settings-storage'
import { TELEGRAPH_DESIGN_BUILD_RUNTIME_ID } from '@/apps/design/application/common/design-build'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let agentEventCallback: ((event: DesignAgentStreamEvent) => void) | null = null
const sendAgentMock = vi.fn(
  (_: DesignAgentSendRequest): Promise<DesignAgentSendResult> => new Promise<DesignAgentSendResult>(() => {}),
)
const cancelAgentMock = vi.fn(() => Promise.resolve(true))
const listAgentRunsMock = vi.fn(() => Promise.resolve([]))
const getAgentRunMock = vi.fn(() => Promise.resolve(null))
const listSubagentsMock = vi.fn(() => Promise.resolve([]))
const getSubagentResultMock = vi.fn(() => Promise.resolve(null))
const cancelSubagentMock = vi.fn(() => Promise.resolve(false))
const previewArtifactPatchMock = vi.fn(
  (_: DesignArtifactPatchRequest): Promise<DesignArtifactPatchPreviewResult> => Promise.resolve({
  runId: 'patch-run',
  artifactId: 'artifact-1',
  status: 'previewed' as const,
  preview: {
    operations: [{ kind: 'update' as const, path: 'apps/design/src/App.tsx', content: 'next' }],
    summary: { adds: 0, updates: 1, deletes: 0 },
  },
}))
const applyArtifactPatchMock = vi.fn(
  (_: DesignArtifactPatchRequest): Promise<DesignArtifactPatchApplyResult> => Promise.resolve({
  runId: 'patch-run',
  artifactId: 'artifact-1',
  status: 'applied' as const,
  applied: true,
  preview: {
    operations: [{ kind: 'update' as const, path: 'apps/design/src/App.tsx', content: 'next' }],
    summary: { adds: 0, updates: 1, deletes: 0 },
  },
}))
const client: IDesignPageletService = {
  info: vi.fn(() => Promise.resolve('ready')),
  ping: vi.fn((now: number) => Promise.resolve({ pong: now, serverTime: now })),
  sendAgent: sendAgentMock,
  cancelAgent: cancelAgentMock,
  listAgentRuns: listAgentRunsMock,
  getAgentRun: getAgentRunMock,
  listSubagents: listSubagentsMock,
  getSubagentResult: getSubagentResultMock,
  cancelSubagent: cancelSubagentMock,
  previewArtifactPatch: previewArtifactPatchMock,
  applyArtifactPatch: applyArtifactPatchMock,
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

  it('passes the saved design task capability profile into pagelet runs', async () => {
    globalThis.localStorage.setItem(AGENT_MODEL_SETTINGS_STORAGE_KEY, JSON.stringify({
      provider: 'minimax-cn',
      modelId: 'MiniMax-M2.7',
      backend: 'pi-ai',
      taskCapabilityProfile: {
        kind: 'design-build',
        scopes: ['artifact:write', 'repo:read'],
        artifactPolicy: 'preview',
      },
    }))
    sendAgentMock.mockImplementationOnce((request) => {
      return Promise.resolve({ runId: request.runId, status: 'completed' })
    })

    const { PageletDesignAgentService } = await import('../pagelet-design-agent-service')
    const service = new PageletDesignAgentService()

    await service.send({
      prompt: 'make a design',
      sessionId: 'session-1',
    })

    expect(sendAgentMock.mock.calls[0]?.[0].settings).toEqual(expect.objectContaining({
      provider: 'minimax-cn',
      modelId: 'MiniMax-M2.7',
      backend: TELEGRAPH_DESIGN_BUILD_RUNTIME_ID,
      orchestration: 'none',
    }))
    expect(sendAgentMock.mock.calls[0]?.[0].settings.taskCapabilityProfile).toEqual({
      kind: 'design-build',
      scopes: ['artifact:write', 'repo:read'],
      artifactPolicy: 'preview',
    })
  })

  it('uses design-build runtime defaults when no model settings were saved', async () => {
    sendAgentMock.mockImplementationOnce((request) => {
      return Promise.resolve({ runId: request.runId, status: 'completed' })
    })

    const { PageletDesignAgentService } = await import('../pagelet-design-agent-service')
    const service = new PageletDesignAgentService()

    await service.send({
      prompt: 'make a design',
      sessionId: 'session-1',
    })

    expect(sendAgentMock.mock.calls[0]?.[0].settings).toEqual(expect.objectContaining({
      backend: TELEGRAPH_DESIGN_BUILD_RUNTIME_ID,
      taskCapabilityProfile: {
        kind: 'design-build',
        scopes: ['artifact:write', 'repo:read'],
        artifactPolicy: 'preview',
      },
    }))
  })

  it('passes saved design settings into artifact patch preview and apply requests', async () => {
    globalThis.localStorage.setItem(AGENT_MODEL_SETTINGS_STORAGE_KEY, JSON.stringify({
      provider: 'minimax-cn',
      modelId: 'MiniMax-M2.7',
      backend: 'pi-ai',
      taskCapabilityProfile: {
        kind: 'design-build',
        scopes: ['artifact:write', 'repo:read', 'repo:write'],
        artifactPolicy: 'apply-after-confirm',
      },
    }))

    const { PageletDesignAgentService } = await import('../pagelet-design-agent-service')
    const service = new PageletDesignAgentService()
    const operations = [{ kind: 'update' as const, path: 'apps/design/src/App.tsx', content: 'next' }]

    await service.previewArtifactPatch({
      artifactId: 'artifact-1',
      operations,
      sessionId: 'session-1',
    })
    await service.applyArtifactPatch({
      artifactId: 'artifact-1',
      operations,
      sessionId: 'session-1',
    })

    const previewCalls = previewArtifactPatchMock.mock.calls
    const applyCalls = applyArtifactPatchMock.mock.calls

    expect(previewCalls[0]?.[0]?.settings.taskCapabilityProfile).toEqual({
      kind: 'design-build',
      scopes: ['artifact:write', 'repo:read', 'repo:write'],
      artifactPolicy: 'apply-after-confirm',
    })
    expect(applyCalls[0]?.[0]?.settings.taskCapabilityProfile).toEqual({
      kind: 'design-build',
      scopes: ['artifact:write', 'repo:read', 'repo:write'],
      artifactPolicy: 'apply-after-confirm',
    })
  })

  it('forwards subagent control calls through the pagelet service', async () => {
    const { PageletDesignAgentService } = await import('../pagelet-design-agent-service')
    const service = new PageletDesignAgentService()

    await expect(service.listSubagents()).resolves.toEqual([])
    await expect(service.getSubagentResult('child-1', { consume: true })).resolves.toBeNull()
    await expect(service.cancelSubagent('child-1')).resolves.toBe(false)

    expect(listSubagentsMock).toHaveBeenCalled()
    expect(getSubagentResultMock).toHaveBeenCalledWith('child-1', true)
    expect(cancelSubagentMock).toHaveBeenCalledWith('child-1')
  })

  it('forwards design run history calls through the pagelet service', async () => {
    const { PageletDesignAgentService } = await import('../pagelet-design-agent-service')
    const service = new PageletDesignAgentService()

    await expect(service.listAgentRuns()).resolves.toEqual([])
    await expect(service.getAgentRun('run-1')).resolves.toBeNull()

    expect(listAgentRunsMock).toHaveBeenCalled()
    expect(getAgentRunMock).toHaveBeenCalledWith('run-1')
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
