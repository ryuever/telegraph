import type {
  DesignAgentSendRequest,
  DesignAgentStreamEvent,
  DesignAgentRunEventRecordSnapshot,
  DesignAgentRunRecordSnapshot,
  DesignArtifactPatchApplyResult,
  DesignArtifactExportResult,
  DesignExportFormat,
  DesignArtifactPatchPreviewResult,
  DesignPatchFileOperation,
  DesignSubagentRecordSnapshot,
} from '@/apps/design/application/common'
import { throwIfAborted, waitForPageletReady } from '@/packages/services/pagelet-host/browser/pagelet-ready'
import {
  designSystemContextFromSettings,
  loadDesignRuntimeSettings,
  type DesignRuntimeSettings,
} from './design-runtime-settings'
import { getDesignPageletClient } from './getClient'
import {
  projectAgentEventToDesign,
  projectDesignAgentRunEventRecords,
  type DesignAgentRunProjection,
  type DesignAgentRunStatus,
  type DesignProjectedArtifact,
} from './design-agent-projector'

const READY_ATTEMPTS = 40
const READY_INTERVAL_MS = 500
const PROBE_TIMEOUT_MS = 3000

export interface DesignAgentSendOptions {
  prompt: string
  sessionId: string
  context?: Record<string, unknown>
  signal?: AbortSignal
  onStatus?: (status: DesignAgentRunStatus) => void
  onAssistantText?: (text: string) => void
  onArtifact?: (artifact: DesignProjectedArtifact) => void
  onSubagent?: (subagent: DesignSubagentRecordSnapshot) => void
  onTraceEvent?: (event: DesignAgentStreamEvent) => void
}

async function waitForDesignPageletReady(signal?: AbortSignal): Promise<void> {
  const client = getDesignPageletClient()
  await waitForPageletReady(() => client.info(), {
    attempts: READY_ATTEMPTS,
    intervalMs: READY_INTERVAL_MS,
    probeTimeoutMs: PROBE_TIMEOUT_MS,
    signal,
    notReadyMessage: 'Design pagelet is not ready. Please try again in a moment.',
  })
}

export class PageletDesignAgentService {
  async send(options: DesignAgentSendOptions): Promise<void> {
    const runId = globalThis.crypto.randomUUID()

    try {
      options.onStatus?.('running')
      await waitForDesignPageletReady(options.signal)
      throwIfAborted(options.signal)

      const client = getDesignPageletClient()
      let removeAbortListener = () => {}
      const abortPromise = new Promise<never>((_resolve, reject) => {
        if (!options.signal) return
        const handleAbort = () => {
          void client.cancelAgent(runId)
          reject(new Error('Cancelled'))
        }
        if (options.signal.aborted) {
          handleAbort()
          return
        }
        options.signal.addEventListener('abort', handleAbort, { once: true })
        removeAbortListener = () => {
          options.signal?.removeEventListener('abort', handleAbort)
        }
      })

      const subscription = client.onAgentEvent((event) => {
        if (options.signal?.aborted && (event.type !== 'agent_event' || event.event.type !== 'run_cancelled')) return
        if (event.runId !== runId) return
        options.onTraceEvent?.(event)

        if (event.type === 'subagent_updated') {
          options.onSubagent?.(event.subagent)
          return
        }

        if (event.type === 'agent_event') {
          projectAgentEventToDesign(event.event, {
            onStatus: status => { options.onStatus?.(status); },
            onAssistantText: text => { options.onAssistantText?.(text); },
            onArtifact: artifact => { options.onArtifact?.(artifact); },
          })
          return
        }

        if (event.type === 'run_failed') {
          options.onStatus?.('failed')
        }
      })

      const request: DesignAgentSendRequest = {
        runId,
        sessionId: options.sessionId,
        prompt: options.prompt,
        settings: readRuntimeSettings(),
        context: contextWithDesignSystem(options.context),
      }

      try {
        const result = await Promise.race([client.sendAgent(request), abortPromise])
        options.onStatus?.(result.status)
      } finally {
        removeAbortListener()
        subscription.unsubscribe()
      }
    } catch (error) {
      options.onStatus?.(isCancelledError(error) ? 'cancelled' : 'failed')
      throw error
    }
  }

  async listSubagents(signal?: AbortSignal): Promise<DesignSubagentRecordSnapshot[]> {
    await waitForDesignPageletReady(signal)
    throwIfAborted(signal)
    return getDesignPageletClient().listSubagents()
  }

  async listAgentRuns(signal?: AbortSignal): Promise<DesignAgentRunRecordSnapshot[]> {
    await waitForDesignPageletReady(signal)
    throwIfAborted(signal)
    return getDesignPageletClient().listAgentRuns()
  }

  async getAgentRun(runId: string, signal?: AbortSignal): Promise<DesignAgentRunRecordSnapshot | null> {
    await waitForDesignPageletReady(signal)
    throwIfAborted(signal)
    return getDesignPageletClient().getAgentRun(runId)
  }

  async listAgentRunEvents(runId: string, signal?: AbortSignal): Promise<DesignAgentRunEventRecordSnapshot[]> {
    await waitForDesignPageletReady(signal)
    throwIfAborted(signal)
    return getDesignPageletClient().listAgentRunEvents(runId)
  }

  async getAgentRunProjection(runId: string, signal?: AbortSignal): Promise<DesignAgentRunProjection> {
    const events = await this.listAgentRunEvents(runId, signal)
    return projectDesignAgentRunEventRecords(events)
  }

  async getSubagentResult(
    childRunId: string,
    options: { consume?: boolean; signal?: AbortSignal } = {},
  ): Promise<DesignSubagentRecordSnapshot | null> {
    await waitForDesignPageletReady(options.signal)
    throwIfAborted(options.signal)
    return getDesignPageletClient().getSubagentResult(childRunId, options.consume)
  }

  async cancelSubagent(childRunId: string, signal?: AbortSignal): Promise<boolean> {
    await waitForDesignPageletReady(signal)
    throwIfAborted(signal)
    return getDesignPageletClient().cancelSubagent(childRunId)
  }

  async previewArtifactPatch(options: {
    artifactId: string
    operations: DesignPatchFileOperation[]
    sessionId?: string
    signal?: AbortSignal
  }): Promise<DesignArtifactPatchPreviewResult> {
    await waitForDesignPageletReady(options.signal)
    throwIfAborted(options.signal)
    const client = getDesignPageletClient()
    return client.previewArtifactPatch({
      runId: globalThis.crypto.randomUUID(),
      sessionId: options.sessionId,
      artifactId: options.artifactId,
      settings: readRuntimeSettings(),
      operations: options.operations,
    })
  }

  async applyArtifactPatch(options: {
    artifactId: string
    operations: DesignPatchFileOperation[]
    sessionId?: string
    signal?: AbortSignal
  }): Promise<DesignArtifactPatchApplyResult> {
    await waitForDesignPageletReady(options.signal)
    throwIfAborted(options.signal)
    const client = getDesignPageletClient()
    return client.applyArtifactPatch({
      runId: globalThis.crypto.randomUUID(),
      sessionId: options.sessionId,
      artifactId: options.artifactId,
      settings: readRuntimeSettings(),
      operations: options.operations,
    })
  }

  async exportArtifact(options: {
    artifactId: string
    artifact: unknown
    formats: DesignExportFormat[]
    sessionId?: string
    signal?: AbortSignal
  }): Promise<DesignArtifactExportResult> {
    await waitForDesignPageletReady(options.signal)
    throwIfAborted(options.signal)
    const client = getDesignPageletClient()
    const result: DesignArtifactExportResult = await client.exportArtifact({
      runId: globalThis.crypto.randomUUID(),
      sessionId: options.sessionId,
      artifactId: options.artifactId,
      artifact: options.artifact,
      formats: options.formats,
    })
    return result
  }
}

function readRuntimeSettings(): DesignRuntimeSettings {
  return loadDesignRuntimeSettings(localStorage)
}

function contextWithDesignSystem(context: Record<string, unknown> | undefined): Record<string, unknown> {
  const settings = readRuntimeSettings()
  return {
    ...context,
    designSystem: {
      ...designSystemContextFromSettings(settings),
      ...(recordField(context, 'designSystem') ?? {}),
    },
  }
}

function isCancelledError(error: unknown): boolean {
  return error instanceof Error && error.message === 'Cancelled'
}

function recordField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return field && typeof field === 'object' && !Array.isArray(field)
    ? field as Record<string, unknown>
    : undefined
}
