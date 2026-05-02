import { IPCMainChannel } from '@x-oasis/async-call-rpc-electron'
import type { WebContents } from '@x-oasis/async-call-rpc-electron'
import type RPCServiceHost from '../RPCServiceHost'
import type { LegacyChannelProps } from '../types'
import { bindHostToChannel } from '../registerToServiceHost'

export type IPCMainChannelProtocolProps = LegacyChannelProps & {
  channelName: string
  webContents: WebContents
}

export default class IPCMainChannelProtocol extends IPCMainChannel {
  private _host?: RPCServiceHost

  constructor(props: IPCMainChannelProtocolProps) {
    const { channelName, webContents, serviceHost, masterProcessName, ...rest } = props
    super({ channelName, webContents, description: masterProcessName, ...rest })
    this._host = serviceHost
    bindHostToChannel(this, this._host)
  }

  setServiceHost(host: RPCServiceHost): void {
    this._host = host
    bindHostToChannel(this, host)
  }
}
