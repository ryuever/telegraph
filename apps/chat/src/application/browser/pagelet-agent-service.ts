import type { AgentSendOptions, AgentService } from './types'
import {
  type ChatSendRequest,
  type ChatStreamEvent,
} from '@/apps/chat/application/common'
import { getChatPageletClient } from '@/apps/chat/application/browser/getClient'
import { isLegacyProjectionEvent, projectAgentEventToChat } from './agent-event-projector'

const READY_ATTEMPTS = 40
const READY_INTERVAL_MS = 500
const PROBE_TIMEOUT_MS = 3000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

/**
 * Race an RPC call against a timeout.  The x-oasis RPCMessageChannel
 * logs "send called before port was bound" and silently returns **without
 * settling the call promise** when the port isn't ready, so a bare
 * `client.info()` would hang forever.  Wrapping it in a timeout lets us
 * detect that situation and retry.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => { reject(new Error('probe timed out')) },
      ms,
    )
    promise
      .then(value => { clearTimeout(timer); resolve(value) })
      .catch((err: unknown) => {
        clearTimeout(timer)
        reject(err instanceof Error ? err : new Error(String(err)))
      })
  })
}

/**
 * Wait for the chat pagelet RPC channel to be ready.
 *
 * The chat utility process boots asynchronously after spawn.  During
 * that window the preload bridge hasn't received a MessagePort for the
 * `chat` participant yet.  x-oasis's RPCMessageChannel silently drops
 * sends in that state (warns but never settles the promise), so we
 * probe `info()` with a per-attempt timeout and retry until the call
 * succeeds.
 */
async function waitForPageletReady(): Promise<void> {
  const client = getChatPageletClient()
  for (let attempt = 0; attempt < READY_ATTEMPTS; attempt++) {
    try {
      await withTimeout(client.info(), PROBE_TIMEOUT_MS)
      return // port is bound — pagelet is ready
    } catch {
      await sleep(READY_INTERVAL_MS)
    }
  }
  throw new Error('Chat pagelet is not ready. Please try again in a moment.')
}

export class PageletAgentService implements AgentService {
  private listeners = new Map<string, (event: ChatStreamEvent) => void>()
  private unsub: (() => void) | null = null

  async send({ conversation, onChunk, onToolCall, onStatus, signal, onLlmTrace }: AgentSendOptions): Promise<void> {
    const lastMessage = conversation.messages.filter(m => m.role === 'user').at(-1)
    if (!lastMessage) throw new Error('Last message must be from user')

    const runId = globalThis.crypto.randomUUID()

    const settings = this.getSettings()

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
          provider: settings.provider,
          modelId: settings.modelId,
          backend: settings.backend ?? 'pi-ai',
          orchestration: settings.orchestration ?? 'none',
          pattern: settings.orchestrationPattern ?? null,
        },
      },
    })

    let sawAgentEvent = false
    const streamListener = (event: ChatStreamEvent) => {
      if (signal?.aborted) return
      if (event.runId !== runId) return

      if (event.type === 'runtime_event' && event.event) {
        sawAgentEvent = true
        projectAgentEventToChat(event.event, {
          sessionId: event.sessionId || conversation.id,
          runId,
          onChunk,
          onToolCall,
          onStatus,
          onLlmTrace,
        })
        return
      }

      if (sawAgentEvent && isLegacyProjectionEvent(event.type)) {
        return
      }

      if (event.type === 'run_queued') {
        onStatus?.('queued')
      } else if (event.type === 'run_started') {
        onStatus?.('running')
      } else if (event.type === 'text_delta') {
        onStatus?.('running')
        if (event.text) onChunk(event.text)
      } else if (event.type === 'run_completed' || event.type === 'done') {
        onStatus?.('completed')
      } else if (event.type === 'run_failed' || event.type === 'error') {
        onStatus?.('failed')
      } else if (event.type === 'llm_trace') {
        const sid = event.sessionId || conversation.id
        if (event.trace) {
          onLlmTrace?.({ runId, sessionId: sid, trace: event.trace })
        }
      }
    }

    try {
      // Wait for the pagelet RPC channel to be bound before sending.
      // The chat utility process boots asynchronously after spawn; the
      // renderer may try to call RPC methods before the channel is ready.
      onStatus?.('queued')
      await waitForPageletReady()

      const client = getChatPageletClient()
      client.onStreamEvent(streamListener)

      const request: ChatSendRequest = {
        message: lastMessage.content,
        settings,
        runId,
        sessionId: conversation.id,
      }

      onStatus?.('running')

      const result = await client.send(request)

      if (result.status === 'completed') {
        onStatus?.('completed')
      } else {
        onStatus?.('failed')
      }
    } catch (err) {
      onStatus?.('failed')
      throw err
    }
  }

  private getSettings(): ChatSendRequest['settings'] {
    const raw = localStorage.getItem('telegraph.chat.modelSettings')
    if (raw) {
      try {
        const parsed: Record<string, unknown> = JSON.parse(raw) as Record<string, unknown>
        const str = (v: unknown, fallback: string): string => typeof v === 'string' ? v : fallback
        const bool = (v: unknown, fallback: boolean): boolean => typeof v === 'boolean' ? v : fallback
        return {
          provider: str(parsed.provider, 'minimax-cn'),
          modelId: str(parsed.modelId, 'MiniMax-M2.7'),
          apiKey: str(parsed.apiKey, ''),
          baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : undefined,
          backend: str(parsed.backend, 'pi-ai') as ChatSendRequest['settings']['backend'],
          orchestration: str(parsed.orchestration, 'none') as ChatSendRequest['settings']['orchestration'],
          orchestrationPattern: str(parsed.orchestrationPattern, 'chain') as ChatSendRequest['settings']['orchestrationPattern'],
          worktreeIsolation: bool(parsed.worktreeIsolation, false),
          extensionBlocklist: Array.isArray(parsed.extensionBlocklist) ? parsed.extensionBlocklist as string[] : [],
        }
      } catch { /* noop */ }
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
}
