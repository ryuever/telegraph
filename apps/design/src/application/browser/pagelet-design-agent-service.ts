import type { RuntimeSettings } from '@/packages/agent-protocol'
import type {
  DesignAgentSendRequest,
  DesignAgentStreamEvent,
  DesignAgentRunRecordSnapshot,
  DesignArtifactPatchApplyResult,
  DesignArtifactPatchPreviewResult,
  DesignPatchFileOperation,
  DesignSubagentRecordSnapshot,
} from '@/apps/design/application/common'
import {
  AGENT_MODEL_SETTINGS_STORAGE_KEY,
  LEGACY_CHAT_MODEL_SETTINGS_STORAGE_KEY,
  readRuntimeSettingsFromStorage,
} from '@/packages/agent/browser/runtime-settings-storage'
import { throwIfAborted, waitForPageletReady } from '@/packages/services/pagelet-host/browser/pagelet-ready'
import { normalizeDesignRuntimeSettings } from './design-runtime-settings'
import { getDesignPageletClient } from './getClient'
import {
  projectAgentEventToDesign,
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
        context: options.context,
      }

      try {
        const result = await Promise.race([client.sendAgent(request), abortPromise])
        options.onStatus?.(result.status === 'completed' ? 'completed' : 'failed')
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
}

function readRuntimeSettings(): RuntimeSettings {
  return normalizeDesignRuntimeSettings(readRuntimeSettingsFromStorage(localStorage), {
    forceDesignProfile: !hasSavedRuntimeSettings(localStorage),
  })
}

function hasSavedRuntimeSettings(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(AGENT_MODEL_SETTINGS_STORAGE_KEY) !== null ||
    storage.getItem(LEGACY_CHAT_MODEL_SETTINGS_STORAGE_KEY) !== null
}

function isCancelledError(error: unknown): boolean {
  return error instanceof Error && error.message === 'Cancelled'
}
