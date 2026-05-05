import type { AgentRuntimeSettings } from '@telegraph/agent'
import type { AgentSendOptions, AgentService } from './types'

const AGENT_STREAM_CHANNEL = 'telegraph:agent:stream'
const AGENT_STREAM_DATA_CHANNEL = 'telegraph:agent:stream:data'

/** Late stream chunks can arrive after invoke resolves; detach listener slightly later so `llm_trace` is not dropped. */
const IPC_STREAM_DETACH_MS = 1500

type InvokeRunResult = {
  runId: string
  status: 'completed' | 'failed'
  text?: string
  error?: string
}

function resolveInvokeTimeoutMs(settings: AgentRuntimeSettings): number {
  if (settings.orchestration === 'pi-subagents') {
    if (settings.orchestrationPattern === 'parallel') return 480_000
    return 360_000
  }
  return 150_000
}

/**
 * Adapter that sends agent requests over IPC to the main process, which
 * forwards execution to the daemon utility-process; stream chunks are
 * fanned back via the main process to this renderer.
 */
export class PiAgentService implements AgentService {
  constructor(private settings: AgentRuntimeSettings) {}

  updateSettings(next: AgentRuntimeSettings) {
    this.settings = next
  }

  async send({ conversation, onChunk, onStatus, signal, onLlmTrace }: AgentSendOptions): Promise<void> {
    const lastMessage = conversation.messages.filter(m => m.role === 'user').at(-1)
    if (!lastMessage) {
      throw new Error('Last message must be from user')
    }

    const ipc = (window as any).telegraph?.ipcRenderer
    if (!ipc) throw new Error('IPC not available')

    if (!this.settings.apiKey) {
      throw new Error('API key is required. Please set it in settings.')
    }

    const runId = globalThis.crypto.randomUUID()
    onLlmTrace?.({
      runId,
      sessionId: conversation.id,
      trace: {
        kind: 'telegraph_turn_context',
        messages: conversation.messages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          status: m.status,
        })),
        runtimeSettingsSummary: {
          provider: this.settings.provider,
          modelId: this.settings.modelId,
          backend: this.settings.backend ?? 'pi-ai',
          orchestration: this.settings.orchestration ?? 'none',
          pattern: this.settings.orchestrationPattern ?? null,
        },
      },
    })
    let error: Error | null = null
    let terminalEventReceived = false
    let resolveDone: (() => void) | null = null
    let rejectDone: ((err: Error) => void) | null = null
    const done = new Promise<void>((resolve, reject) => {
      resolveDone = resolve
      rejectDone = reject
    })
    const finishOnce = (() => {
      let finished = false
      return (err?: Error) => {
        if (finished) return
        finished = true
        if (err) {
          rejectDone?.(err)
        } else {
          resolveDone?.()
        }
      }
    })()
    const abortHandler = () => {
      finishOnce(new Error('Request aborted'))
    }
    signal?.addEventListener('abort', abortHandler, { once: true })

    const listener = (_event: any, data: any) => {
      if (signal?.aborted) return
      // Require exact runId — payloads without runId must not advance terminal state (stderr JSON noise, etc.).
      if (!data || typeof data !== 'object' || data.runId !== runId) return
      if (data.type === 'run_queued') {
        onStatus?.('queued')
      } else if (data.type === 'run_started') {
        onStatus?.('running')
      } else if (data.type === 'text_delta') {
        // Recover UI if run_started was delayed or dropped (e.g. back-to-back runs).
        onStatus?.('running')
        onChunk(data.text)
      } else if (data.type === 'run_completed' || data.type === 'done') {
        if (!terminalEventReceived) {
          terminalEventReceived = true
          onStatus?.('completed')
        }
        finishOnce()
      } else if (data.type === 'error' || data.type === 'run_failed') {
        terminalEventReceived = true
        onStatus?.('failed')
        error = new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error))
        finishOnce(error)
      } else if (data.type === 'llm_trace') {
        const sid =
          'sessionId' in data && typeof data.sessionId === 'string' && data.sessionId.length > 0
            ? data.sessionId
            : conversation.id
        onLlmTrace?.({ runId, sessionId: sid, trace: data.trace })
      }
    }

    ipc.on(AGENT_STREAM_DATA_CHANNEL, listener)

    try {
      // Even if stream status events are delayed/lost, message is actively running now.
      onStatus?.('running')

      const invokeTimeoutMs = resolveInvokeTimeoutMs(this.settings)
      const result = (await Promise.race([
        ipc.invoke(AGENT_STREAM_CHANNEL, {
          message: lastMessage.content,
          settings: this.settings,
          runId,
          sessionId: conversation.id,
        }),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(
              new Error(
                `invoke_timeout: run did not complete within ${invokeTimeoutMs}ms`
              )
            )
          }, invokeTimeoutMs)
        }),
      ])) as InvokeRunResult

      // Fallback when stream events are delayed/lost, or RPC returns before listeners fire.
      if (!terminalEventReceived) {
        if (result?.status === 'failed') {
          const fallbackError = new Error(result.error || 'agent run failed')
          terminalEventReceived = true
          onStatus?.('failed')
          error = fallbackError
          finishOnce(fallbackError)
        } else {
          if (typeof result?.text === 'string' && result.text.length > 0) {
            onChunk(result.text)
          }
          terminalEventReceived = true
          onStatus?.('completed')
          finishOnce()
        }
      }
      await done

      if (error) throw error
    } finally {
      signal?.removeEventListener('abort', abortHandler)
      const ipcRef = ipc
      const listenerRef = listener
      setTimeout(() => {
        ipcRef.removeListener(AGENT_STREAM_DATA_CHANNEL, listenerRef)
      }, IPC_STREAM_DETACH_MS)
    }
  }
}
