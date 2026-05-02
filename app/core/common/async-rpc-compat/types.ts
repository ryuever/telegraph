import type RPCServiceHost from './RPCServiceHost'
import type { AbstractChannelProtocolProps } from '@x-oasis/async-call-rpc'

export type LegacyChannelProps = AbstractChannelProtocolProps & {
  serviceHost?: RPCServiceHost
  masterProcessName?: string
  receiverMiddlewares?: any[]
  senderMiddlewares?: any[]
}

export { default as RPCServiceHost } from './RPCServiceHost'
