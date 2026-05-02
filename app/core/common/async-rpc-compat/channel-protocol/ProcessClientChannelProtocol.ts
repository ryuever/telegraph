import { ElectronUtilityProcessChannel } from '@x-oasis/async-call-rpc-electron'
import type { ParentPort, MainPort } from '@x-oasis/async-call-rpc-electron'
import type RPCServiceHost from '../RPCServiceHost'
import type { LegacyChannelProps } from '../types'
import { bindHostToChannel } from '../registerToServiceHost'

export type ProcessClientChannelProtocolProps = LegacyChannelProps & {
  port: ParentPort | MainPort
}

export default class ProcessClientChannelProtocol extends ElectronUtilityProcessChannel {
  private _host?: RPCServiceHost

  constructor(props: ProcessClientChannelProtocolProps) {
    const { port, serviceHost, masterProcessName, ...rest } = props
    super({ parentPort: port as ParentPort, description: masterProcessName, ...rest })
    this._host = serviceHost
    bindHostToChannel(this, this._host)
  }

  setServiceHost(host: RPCServiceHost): void {
    this._host = host
    bindHostToChannel(this, host)
  }
}
