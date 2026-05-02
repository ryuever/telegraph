import { ProxyRPCClient as RealProxyRPCClient } from '@x-oasis/async-call-rpc'
import type { AbstractChannelProtocol } from '@x-oasis/async-call-rpc'

export type ProxyRPCClientProps = {
  requestPath: string
  channel: AbstractChannelProtocol | (() => AbstractChannelProtocol)
}

export default class ProxyRPCClient extends RealProxyRPCClient {
  constructor(props: ProxyRPCClientProps) {
    const { requestPath, channel } = props
    const resolvedChannel = typeof channel === 'function' ? channel() : channel
    super(requestPath, { channel: resolvedChannel })
  }
}
