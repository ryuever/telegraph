import type RPCServiceHost from '@app/core/common/async-rpc-compat/RPCServiceHost'
import type { Container } from '@x-oasis/di'

export type IPageletProcess = any

export type InitApplicationInPagelet = (
  parentContainer: Container,
  serviceHost: RPCServiceHost
) => void
