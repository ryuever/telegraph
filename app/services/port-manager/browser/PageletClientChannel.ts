import { createId } from '@x-oasis/di'
import { Disposable } from '@x-oasis/disposable'
import type { MainPort } from '@x-oasis/async-call-rpc'
import { ProxyRPCClient, RPCServiceHost } from '@x-oasis/async-call-rpc'

import IPCRendererChannelProtocol from '@x-oasis/async-call-rpc/channel-protocol/IPCRendererChannelProtocol'
import {
  acquirePortMainServicePath,
  mainProcessPortServicePath,
  sharedProcessPortServicePath,
  pageletClintChannelServicePath,
  pageletProcessPortServicePath,
  daemonProcessPortServicePath,
} from '@app/services/port-manager/common/config'
import type { IAcquirePortMainPromisify } from '@app/services/port-manager/common/types'
import IPCRendererMessageChannelProtocol from '@x-oasis/async-call-rpc/channel-protocol/IPCRendererMessageChannelProtocol'
import type { IAssignPassingPortProps } from '@app/services/process/common/types'
import { AssignPassingPortType } from '@app/services/process/common/types'
import { REDCITY_PAGELET_RENDERER_PROCESS_ID } from '@app/core/node/process/env'
import type { LogService } from '@app/services/log/common/log'
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

  private _portChannel: IPCRendererChannelProtocol

  private messageChannelPairs = new Map<string, MessageChannelPair>()

  private _portChannelRPCClient: IAcquirePortMainPromisify

  private _pageletChannelProtocol: IPCRendererMessageChannelProtocol

  private _sharedProcessChannelProtocol: IPCRendererMessageChannelProtocol

  private _daemonProcessChannelProtocol: IPCRendererMessageChannelProtocol

  private _mainProcessChannelProtocol: IPCRendererMessageChannelProtocol

  constructor(logService: LogService) {
    super()

    this.logService = logService

    const hashLocation = window.location.hash
    let search = window.location.search

    if (!search && hashLocation) {
      const parts = hashLocation.split('#')[1].split('?')
      search = parts[1]
    }

    const urlParams = new URLSearchParams(search)
    this._pageletRendererProcessId = urlParams.get(REDCITY_PAGELET_RENDERER_PROCESS_ID)!
    this.id = this.pageletRendererProcessId
    this.type = AssignPassingPortType.PageletRenderer

    this.serviceHost = new RPCServiceHost('pagelet-client-channel')
    this.serviceHost.registerServiceHandler(pageletClintChannelServicePath, this)

    this.initBuiltInChannelProtocol()
  }

  initBuiltInChannelProtocol() {
    this._pageletChannelProtocol = new IPCRendererMessageChannelProtocol({
      serviceHost: this.serviceHost,
      masterProcessName: `${this._projectName}-pagelet-client`,
    })
    this._sharedProcessChannelProtocol = new IPCRendererMessageChannelProtocol({
      serviceHost: this.serviceHost,
      masterProcessName: `${this._projectName}-shared-client`,
    })
    this._daemonProcessChannelProtocol = new IPCRendererMessageChannelProtocol({
      serviceHost: this.serviceHost,
      masterProcessName: `${this._projectName}-daemon-client`,
    })
    this._mainProcessChannelProtocol = new IPCRendererMessageChannelProtocol({
      serviceHost: this.serviceHost,
      masterProcessName: `${this._projectName}-main-client`,
    })
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

    this._portChannel = new IPCRendererChannelProtocol({
      channelName: 'acquire-port',
      projectName,
      masterProcessName,
      ipcRenderer: window.redcity.ipcRenderer as any,
    })

    this._portChannelRPCClient = new ProxyRPCClient({
      requestPath: acquirePortMainServicePath,
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
    new IPCRendererChannelProtocol({
      channelName: `${this.id}-assign-passing-port`,
      projectName: this._projectName,
      masterProcessName: this.id,
      serviceHost: this.serviceHost,
      ipcRenderer: window.redcity.ipcRenderer as any,
    })
  }

  private async acquirePort(toType: AssignPassingPortType) {
    const connectId = createConnectId({
      fromId: this.pageletRendererProcessId,
      fromType: this.type,
      toType,
    })
    this.logService.info(`acquire port, connectId: ${connectId}`)

    const port = (await this._portChannelRPCClient.acquirePageletRendererPort({
      connectId,
    })) as unknown as MainPort
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
