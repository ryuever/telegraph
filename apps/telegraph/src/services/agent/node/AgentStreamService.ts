import { createId, inject, injectable } from '@x-oasis/di'
import { PiAgent } from '@telegraph/agent'
import type { IAgentStreamSink, IAgentStreamService, RunAgentStreamPayload } from '../common/types'
import { agentStreamSinkServicePath } from '@telegraph/services/agent/common/config'
import { ProxyRPCClient } from '@x-oasis/async-call-rpc'
import type { ProcessClientChannel } from '@telegraph/services/port-manager/node/ProcessClientChannel'
import { ProcessClientChannelId } from '@telegraph/services/port-manager/node/ProcessClientChannel'

export const AgentStreamServiceId = createId('agent-stream-service')

@injectable()
export default class AgentStreamService implements IAgentStreamService {
  private sink: IAgentStreamSink

  constructor(@inject(ProcessClientChannelId) portManager: ProcessClientChannel) {
    this.sink = new ProxyRPCClient(agentStreamSinkServicePath, {
      channel: portManager.mainProcessChannelProtocol,
    }).createProxy() as unknown as IAgentStreamSink
  }

  async runStream(req: RunAgentStreamPayload): Promise<void> {
    const agent = new PiAgent(req.settings)
    const { webContentsId, message } = req

    const push = (chunk: Parameters<IAgentStreamSink['push']>[1]) =>
      this.sink.push(webContentsId, chunk)

    try {
      await agent.send({
        messages: [{ role: 'user', content: message }],
        callbacks: {
          onTextDelta: (text: string) => {
            void push({ type: 'text_delta', text })
          },
          onError: (reason: string, errorObj: unknown) => {
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
            void push({ type: 'error', error: `${reason}: ${errorMsg}` })
          },
          onDone: () => {
            void push({ type: 'done' })
          },
        },
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      await push({ type: 'error', error: msg || String(error) })
    }
  }
}
