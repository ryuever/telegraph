import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { ProxyRPCClient } from '@x-oasis/async-call-rpc'
import type { ElectronMessagePortMainChannel } from '@x-oasis/async-call-rpc-electron'
import type { AgentRuntimeSettings } from '@telegraph/agent/types'
import type { IAgentStreamService, RunAgentStreamResult } from '../common/types'
import {
  AGENT_STREAM_CHANNEL,
  AGENT_STREAM_DATA_CHANNEL,
  agentStreamServicePath,
} from '@telegraph/services/agent/common/config'

interface StreamRequest {
  runId?: string
  message: string
  settings: AgentRuntimeSettings
  sessionId?: string
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
    ipcMain.handle(AGENT_STREAM_CHANNEL, async (event, req: StreamRequest): Promise<RunAgentStreamResult> => {
      const runId = req.runId ?? randomUUID()
      try {
        return await daemonAgent.runStream({
          webContentsId: event.sender.id,
          runId,
          sessionId: req.sessionId ?? '',
          message: req.message,
          settings: req.settings,
        })
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        event.sender.send(AGENT_STREAM_DATA_CHANNEL, {
          type: 'run_failed',
          runId,
          status: 'failed',
          error: `daemon_dispatch_failed: ${errorMsg}`,
        })
        event.sender.send(AGENT_STREAM_DATA_CHANNEL, {
          type: 'error',
          runId,
          error: `daemon_dispatch_failed: ${errorMsg}`,
        })
        return {
          runId,
          status: 'failed',
          error: `daemon_dispatch_failed: ${errorMsg}`,
        }
      }
    })
  } catch (err) {
    console.error('[AgentHandler] Failed to register handler:', err)
  }
}
