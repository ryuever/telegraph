import type RPCServiceHost from '@x-oasis/async-call-rpc/rpc-service/RPCServiceHost'
import type { Container } from '@x-oasis/di'

export type IPageletProcess = any

export type InitApplicationInPagelet = (
  parentContainer: Container,
  serviceHost: RPCServiceHost
) => void
