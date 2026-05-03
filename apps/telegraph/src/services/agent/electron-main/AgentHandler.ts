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
      console.log('[AgentHandler] Stream request:', {
        provider: req.settings.provider,
        modelId: req.settings.modelId,
        hasApiKey: !!req.settings.apiKey,
      })
      const agent = new PiAgent(req.settings)
      try {
        await agent.send({
          messages: [{ role: 'user', content: req.message }],
          callbacks: {
            onTextDelta: (text: string) => {
              event.sender.send(AGENT_STREAM_DATA_CHANNEL, { type: 'text_delta', text })
            },
            onError: (reason: string, errorObj: any) => {
              const errorMsg = errorObj instanceof Error ? errorObj.message : String(errorObj)
              console.error('[AgentHandler] Stream error - reason:', reason, 'error:', errorMsg)
              event.sender.send(AGENT_STREAM_DATA_CHANNEL, {
                type: 'error',
                error: `${reason}: ${errorMsg}`,
              })
            },
            onDone: (reason: string) => {
              console.log('[AgentHandler] Stream completed with reason:', reason)
              event.sender.send(AGENT_STREAM_DATA_CHANNEL, { type: 'done' })
            },
          },
        })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const stack = error instanceof Error ? error.stack : ''
        console.error('[AgentHandler] Stream exception:', { message: msg, stack })
        event.sender.send(AGENT_STREAM_DATA_CHANNEL, {
          type: 'error',
          error: msg,
        })
      }
    })
    console.log('[AgentHandler] Handler registered successfully')
  } catch (err) {
    console.error('[AgentHandler] Failed to register handler:', err)
  }
}
