import { injectable } from '@x-oasis/di'
import { webContents } from 'electron'
import type { AgentStreamChunk, IAgentStreamSink } from '../common/types'
import { AGENT_STREAM_DATA_CHANNEL } from '../common/config'

@injectable()
export default class AgentStreamSink implements IAgentStreamSink {
  async push(webContentsId: number, chunk: AgentStreamChunk): Promise<void> {
    const wc = webContents.fromId(webContentsId)
    if (!wc || wc.isDestroyed()) {
      return
    }
    wc.send(AGENT_STREAM_DATA_CHANNEL, chunk)
  }
}
