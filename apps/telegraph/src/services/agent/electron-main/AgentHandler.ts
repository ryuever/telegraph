import { ipcMain } from 'electron'
import { PiAgent } from '@telegraph/agent'
import type { AgentRuntimeSettings } from '@telegraph/agent'

export const AGENT_STREAM_CHANNEL = 'telegraph:agent:stream'
export const AGENT_STREAM_DATA_CHANNEL = 'telegraph:agent:stream:data'

interface StreamRequest {
  message: string
  settings: AgentRuntimeSettings
}

export function setupAgentHandler() {
  try {
    ipcMain.handle(AGENT_STREAM_CHANNEL, async (event, req: StreamRequest) => {
      console.log('[AgentHandler] Stream request received for provider:', req.settings.provider)
      const agent = new PiAgent(req.settings)
      try {
        await agent.send({
          messages: [{ role: 'user', content: req.message }],
          callbacks: {
            onTextDelta: (text: string) => {
              event.sender.send(AGENT_STREAM_DATA_CHANNEL, { type: 'text_delta', text })
            },
            onError: (reason: string) => {
              console.error('[AgentHandler] Stream error:', reason)
              event.sender.send(AGENT_STREAM_DATA_CHANNEL, { type: 'error', error: reason })
            },
            onDone: () => {
              console.log('[AgentHandler] Stream completed')
              event.sender.send(AGENT_STREAM_DATA_CHANNEL, { type: 'done' })
            },
          },
        })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error('[AgentHandler] Stream exception:', msg)
        event.sender.send(AGENT_STREAM_DATA_CHANNEL, {
          type: 'error',
          error: msg,
        })
      }
    })
    console.log('[AgentHandler] Handler registered for', AGENT_STREAM_CHANNEL)
  } catch (err) {
    console.error('[AgentHandler] Failed to register handler:', err)
  }
}
