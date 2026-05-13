import { injectable } from '@x-oasis/di'
import { webContents } from 'electron'
import type { AgentSinkPushPayload, IAgentStreamSink } from '../common/types'
import { AGENT_STREAM_DATA_CHANNEL } from '../common/config'

@injectable()
export default class AgentStreamSink implements IAgentStreamSink {
  async push(payload: AgentSinkPushPayload): Promise<void> {
    const { webContentsId, chunk } = payload
    console.info(
      '[AgentStreamSink] push received',
      JSON.stringify({ webContentsId, type: chunk.type, runId: (chunk as any).runId ?? null })
    )
    const wc = webContents.fromId(webContentsId)
    if (!wc || wc.isDestroyed()) {
      console.warn(
        '[AgentStreamSink] webContents missing/destroyed',
        JSON.stringify({ webContentsId, type: chunk.type, runId: (chunk as any).runId ?? null })
      )
      return
    }
    wc.send(AGENT_STREAM_DATA_CHANNEL, chunk)
  }
}
