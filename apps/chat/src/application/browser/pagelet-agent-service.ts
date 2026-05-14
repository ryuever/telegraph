import type { AgentSendOptions, AgentService, ChatConversation, ChatMessage, LlmTracePayload } from './types'
import {
  CHAT_PAGELET_SERVICE_PATH,
  type ChatSendRequest,
  type ChatStreamEvent,
  type IChatPageletService,
} from '@/apps/chat/application/common'

let chatPageletClient: IChatPageletService | null = null

function getChatPageletClient(): IChatPageletService {
  if (!chatPageletClient) {
    throw new Error('Chat pagelet client not initialized. Call initChatPageletClient first.')
  }
  return chatPageletClient
}

export function initChatPageletClient(client: IChatPageletService): void {
  chatPageletClient = client
}

export class PageletAgentService implements AgentService {
  private listeners = new Map<string, (event: ChatStreamEvent) => void>()
  private unsub: (() => void) | null = null

  async send({ conversation, onChunk, onStatus, signal, onLlmTrace }: AgentSendOptions): Promise<void> {
    const lastMessage = conversation.messages.filter(m => m.role === 'user').at(-1)
    if (!lastMessage) throw new Error('Last message must be from user')

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
          provider: 'mock',
          modelId: '',
          backend: 'pi-ai',
          orchestration: 'none',
          pattern: null,
        },
      },
    })

    const streamListener = (event: ChatStreamEvent) => {
      if (signal?.aborted) return
      if (event.runId !== runId) return

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
          onLlmTrace?.({ runId, sessionId: sid, trace: event.trace as LlmTracePayload })
        }
      } else if (event.type === 'runtime_event') {
        const sid = event.sessionId || conversation.id
        if (event.event) {
          onLlmTrace?.({
            runId,
            sessionId: sid,
            trace: { kind: 'runtime_event', event: event.event },
          })
        }
      }
    }

    try {
      const client = getChatPageletClient()
      client.onStreamEvent(streamListener)

      const settings = this.getSettings()
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
      } else if (result.status === 'failed') {
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
        const parsed = JSON.parse(raw)
        return {
          provider: parsed.provider ?? 'minimax-cn',
          modelId: parsed.modelId ?? 'MiniMax-M2.7',
          apiKey: '',
          baseUrl: parsed.baseUrl,
          backend: parsed.backend ?? 'pi-ai',
          orchestration: parsed.orchestration ?? 'none',
          orchestrationPattern: parsed.orchestrationPattern ?? 'chain',
          worktreeIsolation: parsed.worktreeIsolation ?? false,
          extensionBlocklist: parsed.extensionBlocklist ?? [],
        }
      } catch {}
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
