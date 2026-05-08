import { createId } from '@x-oasis/di'
import { Disposable } from '@x-oasis/disposable'
import { ProxyRPCClient, RPCServiceHost } from '@x-oasis/async-call-rpc'
import { IPCRendererChannel } from '@x-oasis/async-call-rpc-electron'
import { PortAwareIPCRendererChannel } from './PortAwareIPCRendererChannel'
import { RPCMessageChannel } from '@x-oasis/async-call-rpc-web'
import {
  acquirePortMainServicePath,
  mainProcessPortServicePath,
  sharedProcessPortServicePath,
  pageletClintChannelServicePath,
  pageletProcessPortServicePath,
  daemonProcessPortServicePath,
} from '@telegraph/services/port-manager/common/config'
import type { IAcquirePortMainPromisify } from '@telegraph/services/port-manager/common/types'
import type { IAssignPassingPortProps } from '@telegraph/services/process/common/types'
import { AssignPassingPortType } from '@telegraph/services/process/common/types'
import { TELEGRAPH_PAGELET_RENDERER_PROCESS_ID } from '@telegraph/core/node/process/env'
import type { LogService } from '@telegraph/services/log/common/log'
import { toDisposable } from '@x-oasis/disposable'
import type { MessagePortMain } from 'electron'
import { MessageChannelPair } from '../common/MessageChannelPair'
import { createConnectId } from '../common/connectId'

export const PageletClientChannelId = createId('pagelet-client-channel')

export class PageletClientChannel extends Disposable {
  type: AssignPassingPortType

  id: string

  private logService: LogService

  private _projectName: string

  private _pageletRendererProcessId: string

  private serviceHost: RPCServiceHost

  private _isInlinePanel: boolean

  private _portChannel: IPCRendererChannel

  private messageChannelPairs = new Map<string, MessageChannelPair>()

  private _portChannelRPCClient: IAcquirePortMainPromisify

  private _pageletChannelProtocol: RPCMessageChannel

  private _sharedProcessChannelProtocol: RPCMessageChannel

  private _daemonProcessChannelProtocol: RPCMessageChannel

  private _mainProcessChannelProtocol: RPCMessageChannel

  constructor(logService: LogService, pageletRendererProcessId?: string) {
    super()

    this.logService = logService

    if (pageletRendererProcessId) {
      // inline panel 模式：直接使用传入的 ID
      this._pageletRendererProcessId = pageletRendererProcessId
      this._isInlinePanel = true
    } else {
      // 传统 BrowserView 模式：从 URL 参数获取
      this._isInlinePanel = false
      const hashLocation = window.location.hash
      let search = window.location.search

      if (!search && hashLocation) {
        const parts = hashLocation.split('#')[1].split('?')
        search = parts[1]
      }

      const urlParams = new URLSearchParams(search)
      this._pageletRendererProcessId = urlParams.get(TELEGRAPH_PAGELET_RENDERER_PROCESS_ID)!
    }
    this.id = this.pageletRendererProcessId
    this.type = AssignPassingPortType.PageletRenderer

    this.serviceHost = new RPCServiceHost()
    this.serviceHost.registerServiceHandler(pageletClintChannelServicePath, this)

    this.initBuiltInChannelProtocol()
  }

  initBuiltInChannelProtocol() {
    this._pageletChannelProtocol = new RPCMessageChannel({
      description: `${this._projectName}-pagelet-client`,
    })
    this._pageletChannelProtocol.setServiceHost(this.serviceHost)
    this._sharedProcessChannelProtocol = new RPCMessageChannel({
      description: `${this._projectName}-shared-client`,
    })
    this._sharedProcessChannelProtocol.setServiceHost(this.serviceHost)
    this._daemonProcessChannelProtocol = new RPCMessageChannel({
      description: `${this._projectName}-daemon-client`,
    })
    this._daemonProcessChannelProtocol.setServiceHost(this.serviceHost)
    this._mainProcessChannelProtocol = new RPCMessageChannel({
      description: `${this._projectName}-main-client`,
    })
    this._mainProcessChannelProtocol.setServiceHost(this.serviceHost)
  }

  get pageletRendererProcessId() {
    return this._pageletRendererProcessId
  }

  get pageletChannelProtocol() {
    return this._pageletChannelProtocol
  }

  get sharedProcessChannelProtocol() {
    return this._sharedProcessChannelProtocol
  }

  get daemonProcessChannelProtocol() {
    return this._daemonProcessChannelProtocol
  }

  get mainProcessChannelProtocol() {
    return this._mainProcessChannelProtocol
  }

  initPortChannel(props: { projectName: string; masterProcessName: string }) {
    const { projectName, masterProcessName } = props

    this._projectName = projectName

    // inline panel 使用 PortAwareIPCRendererChannel 以正确处理
    // contextIsolation 下 preload bridge 转发的 MessagePort
    const ChannelClass = this._isInlinePanel ? PortAwareIPCRendererChannel : IPCRendererChannel

    this._portChannel = new ChannelClass({
      channelName: 'acquire-port',
      projectName,
      description: masterProcessName,
      ipcRenderer: window.telegraph.ipcRenderer as any,
    })

    this._portChannelRPCClient = new ProxyRPCClient(acquirePortMainServicePath, {
      channel: this._portChannel,
    }).createProxy<IAcquirePortMainPromisify>()

    this.acquirePageletPort()
    this.acquireDaemonPort()
    this.acquireSharedPort()
    this.acquireMainPort()

    this.initAssignPassingPortListener()

    this.registerDisposable(
      toDisposable(() => {
        this._portChannelRPCClient.handlePageletRendererDisposed(this.pageletRendererProcessId)
      })
    )
  }

  initAssignPassingPortListener() {
    const ChannelClass = this._isInlinePanel ? PortAwareIPCRendererChannel : IPCRendererChannel
    const channel = new ChannelClass({
      channelName: `${this.id}-assign-passing-port`,
      projectName: this._projectName,
      description: this.id,
      ipcRenderer: window.telegraph.ipcRenderer as any,
    })
    channel.setServiceHost(this.serviceHost)
  }

  private async acquirePort(toType: AssignPassingPortType) {
    const connectId = createConnectId({
      fromId: this.pageletRendererProcessId,
      fromType: this.type,
      toType,
    })
    console.log(`[PageletClientChannel] acquirePort: connectId=${connectId}, isInline=${this._isInlinePanel}`)
    this.logService.info(`acquire port, connectId: ${connectId}`)

    const port = (await this._portChannelRPCClient.acquirePageletRendererPort({
      connectId,
    })) as unknown as MessagePort
    this.logService.info(`receive port, connectId: ${connectId}`)
    return {
      port,
      connectId,
    }
  }

  async acquirePageletPort() {
    const { port, connectId } = await this.acquirePort(AssignPassingPortType.PageletProcess)
    this.pageletChannelProtocol.bindPort(port)
    const pair = new MessageChannelPair({
      logService: this.logService,
      connectId,
      peerRequestPath: pageletProcessPortServicePath,
      channel: this.pageletChannelProtocol,
    })
    this.messageChannelPairs.set(connectId, pair)
  }

  async acquireSharedPort() {
    const { port, connectId } = await this.acquirePort(AssignPassingPortType.SharedProcess)
    this.sharedProcessChannelProtocol.bindPort(port)
    const pair = new MessageChannelPair({
      logService: this.logService,
      connectId,
      peerRequestPath: sharedProcessPortServicePath,
      channel: this.sharedProcessChannelProtocol,
    })
    this.messageChannelPairs.set(connectId, pair)
  }

  async acquireDaemonPort() {
    const { port, connectId } = await this.acquirePort(AssignPassingPortType.DaemonProcess)
    this.daemonProcessChannelProtocol.bindPort(port)
    const pair = new MessageChannelPair({
      logService: this.logService,
      connectId,
      peerRequestPath: daemonProcessPortServicePath,
      channel: this.daemonProcessChannelProtocol,
    })
    this.messageChannelPairs.set(connectId, pair)
  }

  async acquireMainPort() {
    const { port, connectId } = await this.acquirePort(AssignPassingPortType.MainProcess)
    this.mainProcessChannelProtocol.bindPort(port)
    const pair = new MessageChannelPair({
      logService: this.logService,
      connectId,
      peerRequestPath: mainProcessPortServicePath,
      channel: this.mainProcessChannelProtocol,
    })

    this.messageChannelPairs.set(connectId, pair)
  }

  disconnectPassingPort(connectId: string) {
    const pair = this.messageChannelPairs.get(connectId)
    if (pair) pair.disconnect()
  }

  resumeConnection(props: { type: AssignPassingPortType }) {
    const { type } = props

    if (type === AssignPassingPortType.SharedProcess) {
      this.acquireSharedPort()
    } else if (type === AssignPassingPortType.PageletProcess) {
      this.acquirePageletPort()
    } else if (type === AssignPassingPortType.DaemonProcess) {
      this.acquireDaemonPort()
    }
  }

  assignPassingPort(props: IAssignPassingPortProps, port: MessagePortMain) {
    const { connectId, reconnect = false } = props
    if (reconnect) {
      const pair = this.messageChannelPairs.get(connectId)
      if (pair) {
        pair.reconnect(port)
      }
    }
  }

  sayHelloOptionsRequest(connectId: string) {
    const pair = this.messageChannelPairs.get(connectId)
    if (pair) {
      return pair.handleSayHelloRequest()
    }
  }
}
