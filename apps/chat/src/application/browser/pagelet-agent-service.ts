import type { AgentSendOptions, AgentService } from './types'
import {
  type ChatSendRequest,
  type ChatStreamEvent,
} from '@/apps/chat/application/common'
import { getChatPageletClient } from '@/apps/chat/application/browser/getClient'

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
          onLlmTrace?.({ runId, sessionId: sid, trace: event.trace })
        }
      } else {
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
          apiKey: '',
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
