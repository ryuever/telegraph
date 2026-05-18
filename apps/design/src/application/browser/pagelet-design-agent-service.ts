import type { RuntimeSettings } from '@/packages/agent-protocol'
import type { DesignAgentSendRequest, DesignAgentStreamEvent } from '@/apps/design/application/common'
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error('probe timed out')) }, ms)
    promise
      .then(value => { clearTimeout(timer); resolve(value) })
      .catch((error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      })
  })
}

async function waitForPageletReady(): Promise<void> {
  const client = getDesignPageletClient()
  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt++) {
    try {
      await withTimeout(client.info(), PROBE_TIMEOUT_MS)
      return
    } catch {
      await sleep(READY_INTERVAL_MS)
    }
  }
  throw new Error('Design pagelet is not ready. Please try again in a moment.')
}

export class PageletDesignAgentService {
  async send(options: DesignAgentSendOptions): Promise<void> {
    const runId = globalThis.crypto.randomUUID()
    options.onStatus?.('running')
    await waitForPageletReady()

    const client = getDesignPageletClient()
    const unsubscribe = client.onAgentEvent((event) => {
      if (options.signal?.aborted) return
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

    try {
      const request: DesignAgentSendRequest = {
        runId,
        sessionId: options.sessionId,
        prompt: options.prompt,
        settings: readRuntimeSettings(),
        context: options.context,
      }

      const result = await client.sendAgent(request)
      options.onStatus?.(result.status === 'completed' ? 'completed' : 'failed')
    } finally {
      unsubscribe()
    }
  }
}

function readRuntimeSettings(): RuntimeSettings {
  const raw = localStorage.getItem('telegraph.chat.modelSettings')
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const str = (value: unknown, fallback: string): string => typeof value === 'string' ? value : fallback
      const bool = (value: unknown, fallback: boolean): boolean => typeof value === 'boolean' ? value : fallback
      return {
        provider: str(parsed.provider, 'minimax-cn'),
        modelId: str(parsed.modelId, 'MiniMax-M2.7'),
        apiKey: str(parsed.apiKey, ''),
        baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : undefined,
        backend: str(parsed.backend, 'pi-ai'),
        orchestration: str(parsed.orchestration, 'none'),
        orchestrationPattern: str(parsed.orchestrationPattern, 'chain'),
        worktreeIsolation: bool(parsed.worktreeIsolation, false),
        extensionBlocklist: Array.isArray(parsed.extensionBlocklist) ? parsed.extensionBlocklist as string[] : [],
      }
    } catch {
      // Fall through to defaults.
    }
  }

  return {
    provider: 'minimax-cn',
    modelId: 'MiniMax-M2.7',
    apiKey: '',
    backend: 'pi-ai',
    orchestration: 'none',
    orchestrationPattern: 'chain',
  }
}
