export { default as RPCServiceHost } from './RPCServiceHost'
export { default as ProxyRPCClient } from './ProxyRPCClient'
export type { LegacyChannelProps } from './types'
export type { MainPort, ParentPort } from '@x-oasis/async-call-rpc-electron'

export { AbstractChannelProtocol, RPCError, JSONRPCErrorCode } from '@x-oasis/async-call-rpc'
export type {
  CreateContextFn,
  IMessageChannel,
  AbstractChannelProtocolProps,
  SendingProps,
  ClientMiddleware,
  SenderMiddleware,
  SubscriptionObserver,
  ErrorResponse,
  ErrorResponseDetail,
  ID,
} from '@x-oasis/async-call-rpc'
