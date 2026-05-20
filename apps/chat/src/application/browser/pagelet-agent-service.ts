import type { AgentSendOptions, AgentService } from './types'
import {
  type ChatSendRequest,
  type ChatStreamEvent,
} from '@/apps/chat/application/common'
import { readRuntimeSettingsFromStorage } from '@/packages/agent/browser/runtime-settings-storage'
import { throwIfAborted, waitForPageletReady } from '@/packages/services/pagelet-host/browser/pagelet-ready'
import { getChatPageletClient } from '@/apps/chat/application/browser/getClient'
import { createChatAgentEventProjectionState, isLegacyProjectionEvent, projectAgentEventToChat } from './agent-event-projector'

const READY_ATTEMPTS = 40
const READY_INTERVAL_MS = 500
const PROBE_TIMEOUT_MS = 3000

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
async function waitForChatPageletReady(signal?: AbortSignal): Promise<void> {
  const client = getChatPageletClient()
  await waitForPageletReady(() => client.info(), {
    attempts: READY_ATTEMPTS,
    intervalMs: READY_INTERVAL_MS,
    probeTimeoutMs: PROBE_TIMEOUT_MS,
    signal,
    notReadyMessage: 'Chat pagelet is not ready. Please try again in a moment.',
  })
}

export class PageletAgentService implements AgentService {
  async send({
    conversation,
    onChunk,
    onToolCall,
    onSubagentUpdate,
    onStatus,
    signal,
    onLlmTrace,
  }: AgentSendOptions): Promise<void> {
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
    const projectionState = createChatAgentEventProjectionState()
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
          onSubagentUpdate,
          onStatus,
          onLlmTrace,
          projectionState,
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
      await waitForChatPageletReady(signal)
      throwIfAborted(signal)

      const client = getChatPageletClient()
      const subscription = client.onStreamEvent(streamListener)
      let removeAbortListener = () => {}
      const abortPromise = new Promise<never>((_resolve, reject) => {
        if (!signal) return
        const handleAbort = () => {
          void client.cancel(runId)
          reject(new Error('Cancelled'))
        }
        if (signal.aborted) {
          handleAbort()
          return
        }
        signal.addEventListener('abort', handleAbort, { once: true })
        removeAbortListener = () => {
          signal.removeEventListener('abort', handleAbort)
        }
      })

      const request: ChatSendRequest = {
        message: lastMessage.content,
        settings,
        runId,
        sessionId: conversation.id,
      }

      onStatus?.('running')

      try {
        const result = await Promise.race([client.send(request), abortPromise])

        if (result.status === 'completed') {
          onStatus?.('completed')
        } else {
          onStatus?.('failed')
        }
      } finally {
        removeAbortListener()
        subscription.unsubscribe()
      }
    } catch (err) {
      onStatus?.('failed')
      throw err
    }
  }

  private getSettings(): ChatSendRequest['settings'] {
    return readRuntimeSettingsFromStorage(localStorage) as ChatSendRequest['settings']
  }
}
