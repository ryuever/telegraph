import { ipcMain } from 'electron'
import { ProxyRPCClient } from '@x-oasis/async-call-rpc'
import type { ElectronMessagePortMainChannel } from '@x-oasis/async-call-rpc-electron'
import type { AgentRuntimeSettings } from '@telegraph/agent/types'
import type { IAgentStreamService } from '../common/types'
import {
  AGENT_STREAM_CHANNEL,
  agentStreamServicePath,
} from '@telegraph/services/agent/common/config'

interface StreamRequest {
  message: string
  settings: AgentRuntimeSettings
}

/**
 * Registers renderer IPC that forwards streaming agent work to the
 * **daemon** utility-process (see A-002). Chunks return via
 * {@link AgentStreamSink} on the main process.
 */
export function setupAgentHandler(daemonChannel: ElectronMessagePortMainChannel) {
  const daemonAgent = new ProxyRPCClient(agentStreamServicePath, {
    channel: daemonChannel,
  }).createProxy() as unknown as IAgentStreamService

  try {
    ipcMain.handle(AGENT_STREAM_CHANNEL, async (event, req: StreamRequest) => {
      await daemonAgent.runStream({
        webContentsId: event.sender.id,
        message: req.message,
        settings: req.settings,
      })
    })
  } catch (err) {
    console.error('[AgentHandler] Failed to register handler:', err)
  }
}
