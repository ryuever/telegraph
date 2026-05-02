import { createId, injectable } from '@x-oasis/di'
import { Disposable } from '@x-oasis/disposable'
import { ElectronUtilityProcessChannel } from '@x-oasis/async-call-rpc-electron'
import { ProxyRPCClient, RPCServiceHost } from '@x-oasis/async-call-rpc'
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

  protected _processListener: ElectronUtilityProcessChannel

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
    this.serviceHost = new RPCServiceHost()
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
    this._processListener = new ElectronUtilityProcessChannel({
      process: this._process,
      description: `${this._processName}-process`,
    })
    this._processListener.setServiceHost(this.serviceHost)

    this._rpcClient = new ProxyRPCClient(PingMainServicePath, {
      channel: this._processListener,
    }).createProxy<IProcessPingClient>()

    this._rpcClient.onPing(this.ping.bind(this))
  }
}
