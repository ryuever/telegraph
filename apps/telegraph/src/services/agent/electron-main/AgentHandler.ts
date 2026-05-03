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
      const agent = new PiAgent(req.settings)
      try {
        await agent.send({
          messages: [{ role: 'user', content: req.message }],
          callbacks: {
            onTextDelta: (text: string) => {
              event.sender.send(AGENT_STREAM_DATA_CHANNEL, { type: 'text_delta', text })
            },
            onError: (reason: string, errorObj: any) => {
              let errorMsg = ''
              if (errorObj instanceof Error) {
                errorMsg = errorObj.message
              } else if (typeof errorObj === 'string') {
                errorMsg = errorObj
              } else if (errorObj && typeof errorObj === 'object') {
                try {
                  errorMsg = JSON.stringify(errorObj)
                } catch {
                  errorMsg = String(errorObj)
                }
              } else {
                errorMsg = String(errorObj)
              }
              event.sender.send(AGENT_STREAM_DATA_CHANNEL, {
                type: 'error',
                error: `${reason}: ${errorMsg}`,
              })
            },
            onDone: () => {
              event.sender.send(AGENT_STREAM_DATA_CHANNEL, { type: 'done' })
            },
          },
        })
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        event.sender.send(AGENT_STREAM_DATA_CHANNEL, {
          type: 'error',
          error: msg || String(error),
        })
      }
    })
  } catch (err) {
    console.error('[AgentHandler] Failed to register handler:', err)
  }
}
