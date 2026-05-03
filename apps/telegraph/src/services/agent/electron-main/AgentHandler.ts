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
  ipcMain.handle(AGENT_STREAM_CHANNEL, async (event, req: StreamRequest) => {
    const agent = new PiAgent().withSettings(req.settings)
    const callbacks = {
      onChunk: (text: string) => {
        event.sender.send(AGENT_STREAM_DATA_CHANNEL, { type: 'text_delta', text })
      },
      onError: (error: Error) => {
        event.sender.send(AGENT_STREAM_DATA_CHANNEL, { type: 'error', error: error.message })
      },
      onDone: () => {
        event.sender.send(AGENT_STREAM_DATA_CHANNEL, { type: 'done' })
      },
    }
    try {
      await agent.send(req.message, callbacks)
    } catch (error) {
      event.sender.send(AGENT_STREAM_DATA_CHANNEL, {
        type: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
}
