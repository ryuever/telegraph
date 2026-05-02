import { createId, injectable } from '@x-oasis/di'
import { Disposable } from '@x-oasis/disposable'
import ProcessChannelProtocol from '@app/core/common/async-rpc-compat/channel-protocol/ProcessChannelProtocol'
import { ProxyRPCClient, RPCServiceHost } from '@app/core/common/async-rpc-compat'
import { PingMainServicePath } from '@app/services/ping/common/config'
import { Emitter } from '@x-oasis/emitter'
import type { IProcessPingClient } from '../common/types'

export const ProcessPingMainFactoryId = createId('process-ping-main-factory')
export type IProcessPingMainFactory = (props: {
  processName: string
  process: any
}) => ProcessPingMain

@injectable()
export class ProcessPingMain extends Disposable {
  private _process: any

  private _processName: string

  protected _processListener: ProcessChannelProtocol

  private _rpcClient: IProcessPingClient

  private _updateTime: number

  private _connected: boolean

  private serviceHost: RPCServiceHost

  private emitter = new Emitter({ name: 'ping-service' })

  private onDidProcessReadyEvent = this.emitter.register('on-process-ready')

  onDidProcessReady = this.onDidProcessReadyEvent.subscribe

  constructor(props: { processName: string; process: any }) {
    super()

    this._processName = props?.processName
    this._process = props?.process
    this.serviceHost = new RPCServiceHost('ping-service')
    this.serviceHost.registerServiceHandler(PingMainServicePath, this)

    this.setupListener()
  }

  setProcess(process: any) {
    this._process = process
  }

  get updateTime() {
    return this._updateTime
  }

  ping(project?: string) {
    this._updateTime = Date.now()
  }

  get connected() {
    return this._connected
  }

  connect() {
    this._connected = true
  }

  setupListener() {
    // TODO：这么做现在有问题，比如shared process相当于有两个地方接受
    // process client发来的消息
    this._processListener = new ProcessChannelProtocol({
      process: this._process,
      serviceHost: this.serviceHost,
      masterProcessName: `${this._processName}-process`,
    })

    this._rpcClient = new ProxyRPCClient({
      requestPath: PingMainServicePath,
      channel: this._processListener,
    }).createProxy<IProcessPingClient>()

    this._rpcClient.onPing(this.ping.bind(this))
  }
}
