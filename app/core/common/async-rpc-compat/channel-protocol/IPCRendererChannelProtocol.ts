import { IPCRendererChannel } from '@x-oasis/async-call-rpc-electron'
import type { IpcRenderer } from '@x-oasis/async-call-rpc-electron'
import type RPCServiceHost from '../RPCServiceHost'
import type { LegacyChannelProps } from '../types'
import { bindHostToChannel } from '../registerToServiceHost'

export type IPCRendererChannelProtocolProps = LegacyChannelProps & {
  channelName: string
  projectName: string
  ipcRenderer: IpcRenderer
}

export default class IPCRendererChannelProtocol extends IPCRendererChannel {
  private _host?: RPCServiceHost

  constructor(props: IPCRendererChannelProtocolProps) {
    const { channelName, ipcRenderer, projectName, serviceHost, masterProcessName, ...rest } = props
    super({ channelName, ipcRenderer, projectName, description: masterProcessName, ...rest })
    this._host = serviceHost
    bindHostToChannel(this, this._host)
  }

  setServiceHost(host: RPCServiceHost): void {
    this._host = host
    bindHostToChannel(this, host)
  }
}
