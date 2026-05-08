import { createId, injectable } from '@x-oasis/di'
import { Disposable } from '@x-oasis/disposable'
import { ElectronUtilityProcessChannel } from '@x-oasis/async-call-rpc-electron'
import { Event } from '@x-oasis/emitter'
import { RPCServiceHost, ProxyRPCClient } from '@x-oasis/async-call-rpc'
import { PingMainServicePath } from '@telegraph/services/ping/common/config'

import type { IProcessPingMain } from '../common/types'

export const ProcessPingClientFactoryId = createId('process-ping-client-factory')
export type IProcessPingClientFactory = (props: {
  processName: string
  process: any
}) => ProcessPingClient

@injectable()
export class ProcessPingClient extends Disposable {
  private _process: any

  private _processName: string

  private _processReporter: ElectronUtilityProcessChannel

  private _updateTime: number

  private _rpcClient: IProcessPingMain

  private serviceHost: RPCServiceHost

  private pingInterval: number

  private onPingEvent = new Event({ name: 'on-ping' })

  onPing = this.onPingEvent.subscribe

  constructor(props: { processName: string; process: any }) {
    super()

    this.pingInterval = 10 * 1000
    this._processName = props?.processName
    this._process = props?.process
    this.serviceHost = new RPCServiceHost()
    this.serviceHost.registerServiceHandler(PingMainServicePath, this)

    this.setupReporter()
  }

  setProcess(process: any) {
    this._process = process
  }

  setupReporter() {
    this._processReporter = new ElectronUtilityProcessChannel({
      parentPort: process.parentPort as any,
      description: `${this._processName}-xxxx-process`,
    })
    this._processReporter.setServiceHost(this.serviceHost)

    setInterval(() => {
      this.onPingEvent.fire(this._processName)
    }, this.pingInterval)

    this._rpcClient = new ProxyRPCClient(PingMainServicePath, {
      channel: this._processReporter,
    }).createProxy<IProcessPingMain>()

    this._rpcClient.connect()
  }
}
