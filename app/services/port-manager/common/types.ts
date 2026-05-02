import type { ElectronMessagePortMainChannel } from '@x-oasis/async-call-rpc-electron'
import type { RPCMessageChannel } from '@x-oasis/async-call-rpc-web'
import type { LogService } from '@app/services/log/common/log'
import type { AssignPassingPortType } from '@app/services/process/common/types'
import type { PromisifyService } from '@app/services/types'
import type { MessagePortMain } from 'electron'

export type AcquirePortProps = {
  connectId: string
  reconnect?: boolean
}

export type ToReverse = () => void
export type ToReconnect = () => void

export type AcquiredPortRequestEntry = {
  connectId: string
  isConsumer: boolean

  /**
   *
   * 当发起方 destroy 时，通知接收方断开
   */
  toDispose?: () => void

  /**
   * 当接收方 destroy 时，通知发起方断开
   */
  toReverse?: ToReverse

  /**
   * 接收方 rebuild，通知发起方再次连接
   */
  toReconnect?: ToReconnect
}

export type RemovePortProps = {
  channelId: string
  type: AssignPassingPortType
  removePortType: AssignPassingPortType
}

export type IAcquirePortMainPromisify = PromisifyService<IAcquirePortMain>

export interface IAcquirePortMain {
  acquirePageletRendererPort: (props: AcquirePortProps) => MessagePortMain
  // removePageletRendererPort: (props: RemovePortProps) => void

  /**
   *
   * @param pageletId
   * @returns
   *
   * waiting for a rpc request, which means peer renderer has been disposed
   */
  handlePageletRendererDisposed: (pageletId: string) => void
}

export type IAcquireProcessPortMainPromisify = PromisifyService<IAcquireProcessPortMain>

export interface IAcquireProcessPortMain {
  acquirePort: (props: AcquirePortProps) => MessagePortMain
}

export type MessageChannelPairHostEntry = {
  channel: ElectronMessagePortMainChannel | RPCMessageChannel | null
}

export type MessageChannelPairPeerEntry = {
  isConnected: boolean
  client: {
    sayHelloOptionsRequest: (connectId: string) => Promise<boolean>
  }
}

export type messageChannelPairChannel =
  | ElectronMessagePortMainChannel
  | RPCMessageChannel

export type MessageChannelPairProps = {
  connectId: string
  logService: LogService
  peerRequestPath: string
  channel: messageChannelPairChannel
}
