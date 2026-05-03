import type { AgentRuntimeSettings, AgentTextMessage } from '@telegraph/agent'
import type { AgentSendOptions, AgentService } from './types'

const AGENT_STREAM_CHANNEL = 'telegraph:agent:stream'
const AGENT_STREAM_DATA_CHANNEL = 'telegraph:agent:stream:data'

/**
 * Adapter that proxies agent requests through IPC to the main process.
 * Translates ChatConversation → pi-ai message list and forwards the
 * stream's text deltas into `onChunk`.
 */
export class PiAgentService implements AgentService {
  constructor(private settings: AgentRuntimeSettings) {}

  updateSettings(next: AgentRuntimeSettings) {
    this.settings = next
  }

  async send({ conversation, onChunk, signal }: AgentSendOptions): Promise<void> {
    const lastMessage = conversation.messages.at(-1)
    if (!lastMessage || lastMessage.role !== 'user') {
      throw new Error('Last message must be from user')
    }

    const ipc = (window as any).telegraph?.ipcRenderer
    if (!ipc) throw new Error('IPC not available')

    if (!this.settings.apiKey) {
      throw new Error('API key is required. Please set it in settings.')
    }

    let error: Error | null = null
    let streamEnded = false

    const listener = (_event: any, data: any) => {
      if (signal?.aborted) return
      if (data.type === 'text_delta') {
        onChunk(data.text)
      } else if (data.type === 'done') {
        streamEnded = true
      } else if (data.type === 'error') {
        error = new Error(data.error)
      }
    }

    ipc.on(AGENT_STREAM_DATA_CHANNEL, listener)

    try {
      console.log('[PiAgentService] Invoking agent with settings:', {
        provider: this.settings.provider,
        modelId: this.settings.modelId,
        hasApiKey: !!this.settings.apiKey,
      })

      await ipc.invoke(AGENT_STREAM_CHANNEL, {
        message: lastMessage.content,
        settings: this.settings,
      })

      if (error) throw error
      if (!streamEnded) {
        console.warn('[PiAgentService] Stream ended without explicit done event')
      }
    } catch (err) {
      console.error('[PiAgentService] Error:', err)
      throw err
    } finally {
      ipc.removeListener(AGENT_STREAM_DATA_CHANNEL, listener)
    }
  }
}
