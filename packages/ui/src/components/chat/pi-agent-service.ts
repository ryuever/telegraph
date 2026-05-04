import type { AgentRuntimeSettings, AgentTextMessage } from '@telegraph/agent'
import type { AgentSendOptions, AgentService } from './types'

const AGENT_STREAM_CHANNEL = 'telegraph:agent:stream'
const AGENT_STREAM_DATA_CHANNEL = 'telegraph:agent:stream:data'

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

  async send({ conversation, onChunk, signal }: AgentSendOptions): Promise<void> {
    const lastMessage = conversation.messages.filter(m => m.role === 'user').at(-1)
    if (!lastMessage) {
      throw new Error('Last message must be from user')
    }

    const ipc = (window as any).telegraph?.ipcRenderer
    if (!ipc) throw new Error('IPC not available')

    if (!this.settings.apiKey) {
      throw new Error('API key is required. Please set it in settings.')
    }

    let error: Error | null = null

    const listener = (_event: any, data: any) => {
      if (signal?.aborted) return
      if (data.type === 'text_delta') {
        onChunk(data.text)
      } else if (data.type === 'error') {
        error = new Error(typeof data.error === 'string' ? data.error : JSON.stringify(data.error))
      }
    }

    ipc.on(AGENT_STREAM_DATA_CHANNEL, listener)

    try {
      await ipc.invoke(AGENT_STREAM_CHANNEL, {
        message: lastMessage.content,
        settings: this.settings,
      })

      if (error) throw error
    } finally {
      ipc.removeListener(AGENT_STREAM_DATA_CHANNEL, listener)
    }
  }
}
