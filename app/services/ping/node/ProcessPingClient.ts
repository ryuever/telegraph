import { createId, injectable } from '@x-oasis/di'
import { Disposable } from '@x-oasis/disposable'
import ProcessClientChannelProtocol from '@app/core/common/async-rpc-compat/channel-protocol/ProcessClientChannelProtocol'
import { Event } from '@x-oasis/emitter'
import { RPCServiceHost, ProxyRPCClient } from '@app/core/common/async-rpc-compat'
import { PingMainServicePath } from '@app/services/ping/common/config'

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

  private _processReporter: ProcessClientChannelProtocol

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
    this.serviceHost = new RPCServiceHost('ping-service')
    this.serviceHost.registerServiceHandler(PingMainServicePath, this)

    this.setupReporter()
  }

  setProcess(process: any) {
    this._process = process
  }

  setupReporter() {
    this._processReporter = new ProcessClientChannelProtocol({
      port: process.parentPort,
      serviceHost: this.serviceHost,
      masterProcessName: `${this._processName}-xxxx-process`,
    })

    setInterval(() => {
      this.onPingEvent.fire(this._processName)
    }, this.pingInterval)

    this._rpcClient = new ProxyRPCClient({
      requestPath: PingMainServicePath,
      channel: this._processReporter,
    }).createProxy<IProcessPingMain>()

    this._rpcClient.connect()
  }
}
