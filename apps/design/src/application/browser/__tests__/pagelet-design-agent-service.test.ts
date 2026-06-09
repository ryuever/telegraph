import type {
  DesignAgentSendRequest,
  DesignAgentSendResult,
  DesignArtifactPatchApplyResult,
  DesignArtifactExportResult,
  DesignArtifactPatchPreviewResult,
  DesignArtifactPatchRequest,
  DesignArtifactExportRequest,
  DesignAgentRunEventRecordSnapshot,
  DesignAgentStreamEvent,
  DesignDeleteSessionRunsResult,
  IDesignPageletService,
} from '@/apps/design/application/common'
import { RUNTIME_CONTRACT_SCHEMA_VERSION, type RuntimeSettings } from '@/packages/agent-protocol'
import { TELEGRAPH_DESIGN_BUILD_RUNTIME_ID } from '@/apps/design/application/common/design-build'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let agentEventCallback: ((event: DesignAgentStreamEvent) => void) | null = null
let runtimeSettings: RuntimeSettings & { designSystem?: { themePackId?: string } }
const sendAgentMock = vi.fn(
  (_: DesignAgentSendRequest): Promise<DesignAgentSendResult> => new Promise<DesignAgentSendResult>(() => {}),
)
const cancelAgentMock = vi.fn(() => Promise.resolve(true))
const listConfiguredModelsMock = vi.fn(() => Promise.resolve([]))
const getRuntimeSettingsMock = vi.fn(() => Promise.resolve(runtimeSettings))
const updateRuntimeSettingsMock = vi.fn((settings: RuntimeSettings) => {
  runtimeSettings = settings
  return Promise.resolve(settings)
})
const listAgentRunsMock = vi.fn(() => Promise.resolve([]))
const deleteAgentSessionRunsMock = vi.fn((sessionId: string): Promise<DesignDeleteSessionRunsResult> =>
  Promise.resolve({ sessionId, deletedRunIds: [] }))
const getAgentRunMock = vi.fn(() => Promise.resolve(null))
const listAgentRunEventsMock = vi.fn((): Promise<DesignAgentRunEventRecordSnapshot[]> => Promise.resolve([]))
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
const exportArtifactMock = vi.fn(
  (_: DesignArtifactExportRequest): Promise<DesignArtifactExportResult> => Promise.resolve({
    runId: 'export-run',
    artifactId: 'artifact-1',
    status: 'exported' as const,
    artifact: {
      id: 'export-1',
      kind: 'design-export',
      title: 'Export',
      sourceArtifactId: 'artifact-1',
      formats: ['html-zip'],
      exports: [{ format: 'html-zip', status: 'generated', path: '/tmp/html-project.zip' }],
      manifestPath: '/tmp/export-manifest.json',
      createdAt: 1,
    },
  }),
)
const client: IDesignPageletService = {
  info: vi.fn(() => Promise.resolve('ready')),
  ping: vi.fn((now: number) => Promise.resolve({ pong: now, serverTime: now })),
  sendAgent: sendAgentMock,
  cancelAgent: cancelAgentMock,
  listConfiguredModels: listConfiguredModelsMock,
  getRuntimeSettings: getRuntimeSettingsMock,
  updateRuntimeSettings: updateRuntimeSettingsMock,
  listAgentRuns: listAgentRunsMock,
  deleteAgentSessionRuns: deleteAgentSessionRunsMock,
  getAgentRun: getAgentRunMock,
  listAgentRunEvents: listAgentRunEventsMock,
  listSubagents: listSubagentsMock,
  getSubagentResult: getSubagentResultMock,
  cancelSubagent: cancelSubagentMock,
  previewArtifactPatch: previewArtifactPatchMock,
  applyArtifactPatch: applyArtifactPatchMock,
  exportArtifact: exportArtifactMock,
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
    runtimeSettings = defaultRuntimeSettings()
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

  it('preserves cancelled pagelet results as cancelled status', async () => {
    sendAgentMock.mockImplementationOnce((request) =>
      Promise.resolve({ runId: request.runId, status: 'cancelled', error: 'Cancelled' }))

    const { PageletDesignAgentService } = await import('../pagelet-design-agent-service')
    const statuses: string[] = []
    const service = new PageletDesignAgentService()

    await service.send({
      prompt: 'make a card',
      sessionId: 'session-1',
      onStatus: status => { statuses.push(status); },
    })

    expect(statuses).toContain('cancelled')
  })

  it('forwards live subagent snapshots separately from trace events', async () => {
    sendAgentMock.mockImplementationOnce((request) => {
      agentEventCallback?.({
        type: 'subagent_updated',
        runId: request.runId,
        sessionId: request.sessionId,
        subagent: {
          id: 'child-1',
          parentRunId: request.runId,
          sessionId: request.sessionId,
          agent: 'worker',
          label: 'Worker',
          description: 'Does work',
          task: 'Build the patch',
          status: 'running',
          toolUses: 0,
          startedAt: 1,
        },
      })
      return Promise.resolve({ runId: request.runId, status: 'completed' })
    })

    const { PageletDesignAgentService } = await import('../pagelet-design-agent-service')
    const subagents: string[] = []
    const traceTypes: string[] = []
    const service = new PageletDesignAgentService()

    await service.send({
      prompt: 'make a card',
      sessionId: 'session-1',
      onSubagent: subagent => { subagents.push(`${subagent.id}:${subagent.status}`); },
      onTraceEvent: event => { traceTypes.push(event.type); },
    })

    expect(subagents).toEqual(['child-1:running'])
    expect(traceTypes).toEqual(['subagent_updated'])
  })

  it('passes the saved design task capability profile into pagelet runs', async () => {
    runtimeSettings = {
      provider: 'minimax-cn',
      modelId: 'MiniMax-M2.7',
      apiKey: '',
      authMode: 'api-key',
      backend: 'pi-ai',
      taskCapabilityProfile: {
        kind: 'design-build',
        scopes: ['artifact:write', 'repo:read'],
        artifactPolicy: 'preview',
      },
    }
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

  it('forwards configured model reads through the pagelet service', async () => {
    const { PageletDesignAgentService } = await import('../pagelet-design-agent-service')
    const service = new PageletDesignAgentService()

    await expect(service.listConfiguredModels()).resolves.toEqual([])

    expect(listConfiguredModelsMock).toHaveBeenCalled()
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
    expect(sendAgentMock.mock.calls[0]?.[0].context).toMatchObject({
      designSystem: {
        themePackId: 'shadcn-new-york-neutral',
      },
    })
  })

  it('passes saved theme pack context into design runs', async () => {
    runtimeSettings = {
      ...defaultRuntimeSettings(),
      designSystem: { themePackId: 'studio-dark' },
    }
    sendAgentMock.mockImplementationOnce((request) => {
      return Promise.resolve({ runId: request.runId, status: 'completed' })
    })

    const { PageletDesignAgentService } = await import('../pagelet-design-agent-service')
    const service = new PageletDesignAgentService()

    await service.send({
      prompt: 'make a design',
      sessionId: 'session-1',
      context: {
        surface: 'test',
      },
    })

    expect(sendAgentMock.mock.calls[0]?.[0].context).toMatchObject({
      surface: 'test',
      designSystem: {
        themePackId: 'studio-dark',
        themePack: {
          id: 'studio-dark',
          label: 'Studio Dark',
          source: 'built-in',
        },
      },
    })
  })

  it('passes saved design settings into artifact patch preview and apply requests', async () => {
    runtimeSettings = {
      provider: 'minimax-cn',
      modelId: 'MiniMax-M2.7',
      apiKey: '',
      authMode: 'api-key',
      backend: 'pi-ai',
      taskCapabilityProfile: {
        kind: 'design-build',
        scopes: ['artifact:write', 'repo:read', 'repo:write'],
        artifactPolicy: 'apply-after-confirm',
      },
    }

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

  it('exports artifacts through the pagelet service with source lineage', async () => {
    const { PageletDesignAgentService } = await import('../pagelet-design-agent-service')
    const service = new PageletDesignAgentService()
    const artifact = {
      id: 'artifact-1',
      kind: 'design-patch',
      operations: [{ kind: 'add', path: 'apps/design/src/generated/page/src/App.tsx', content: 'export default function App() { return <main /> }' }],
    }

    const result = await service.exportArtifact({
      artifactId: 'artifact-1',
      artifact,
      formats: ['html-zip', 'pdf'],
      sessionId: 'session-1',
    })

    expect(result.status).toBe('exported')
    expect(exportArtifactMock).toHaveBeenCalledWith(expect.objectContaining({
      artifactId: 'artifact-1',
      artifact,
      formats: ['html-zip', 'pdf'],
      sessionId: 'session-1',
    }))
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
    listAgentRunEventsMock.mockResolvedValueOnce([
      {
        runId: 'run-1',
        sessionId: 'session-1',
        seq: 1,
        ts: 1,
        event: {
          type: 'assistant_delta',
          schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
          runId: 'run-1',
          requestId: 'request-1',
          text: 'Hi',
          ts: 1,
        },
      },
    ])

    await expect(service.listAgentRuns()).resolves.toEqual([])
    await expect(service.deleteAgentSessionRuns('session-1')).resolves.toEqual({ sessionId: 'session-1', deletedRunIds: [] })
    await expect(service.getAgentRun('run-1')).resolves.toBeNull()
    await expect(service.getAgentRunProjection('run-1')).resolves.toMatchObject({
      assistantText: 'Hi',
      traceEvents: [
        expect.objectContaining({ type: 'assistant_delta' }),
      ],
    })

    expect(listAgentRunsMock).toHaveBeenCalled()
    expect(deleteAgentSessionRunsMock).toHaveBeenCalledWith('session-1')
    expect(getAgentRunMock).toHaveBeenCalledWith('run-1')
    expect(listAgentRunEventsMock).toHaveBeenCalledWith('run-1')
  })
})

function defaultRuntimeSettings(): RuntimeSettings & { designSystem?: { themePackId?: string } } {
  return {
    provider: 'zai',
    modelId: 'glm-5.1',
    apiKey: '',
    authMode: 'api-key',
    backend: 'pi-ai',
    orchestration: 'none',
    orchestrationPattern: 'chain',
    worktreeIsolation: false,
    extensionBlocklist: [],
    taskCapabilityProfile: { kind: 'default' },
    designSystem: { themePackId: 'shadcn-new-york-neutral' },
  }
}
