import { ElectronUtilityProcessChannel } from '@x-oasis/async-call-rpc-electron'
import type { UtilityProcess } from '@x-oasis/async-call-rpc-electron'
import type RPCServiceHost from '../RPCServiceHost'
import type { LegacyChannelProps } from '../types'
import { bindHostToChannel } from '../registerToServiceHost'

export type ProcessChannelProtocolProps = LegacyChannelProps & {
  process: UtilityProcess
}

export default class ProcessChannelProtocol extends ElectronUtilityProcessChannel {
  private _host?: RPCServiceHost

  constructor(props: ProcessChannelProtocolProps) {
    const { process, serviceHost, masterProcessName, ...rest } = props
    super({ process, description: masterProcessName, ...rest })
    this._host = serviceHost
    bindHostToChannel(this, this._host)
  }

  setServiceHost(host: RPCServiceHost): void {
    this._host = host
    bindHostToChannel(this, host)
  }
}
