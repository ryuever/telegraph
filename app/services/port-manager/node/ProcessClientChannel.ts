import { inject, injectable } from '@x-oasis/di'
import { Disposable } from '@x-oasis/disposable'
import {
  acquirePortMainServicePath,
  mainProcessPortServicePath,
  daemonProcessPortServicePath,
  pageletClintChannelServicePath,
  pageletProcessPortServicePath,
  sharedProcessPortServicePath,
} from '@app/services/port-manager/common/config'

import ProcessClientChannelProtocol from '@x-oasis/async-call-rpc/channel-protocol/ProcessClientChannelProtocol'
import type { MainPort } from '@x-oasis/async-call-rpc'
import { ProxyRPCClient, RPCServiceHost } from '@x-oasis/async-call-rpc'
import type { MessagePortMain } from 'electron'

import type { IAssignPassingPortProps, IProcessNode } from '@app/services/process/common/types'
import { AssignPassingPortType } from '@app/services/process/common/types'
import type { IAcquireProcessPortMainPromisify } from '@app/services/port-manager/common/types'
import DeferredMessageChannelProtocol from '@x-oasis/async-call-rpc/channel-protocol/DeferredMessageChannelProtocol'
import type { LogService } from '@app/services/log/common/log'
import { LogServiceId } from '@app/services/log/common/log'
import { PortManagerLog } from '@app/services/log/common/constants'
import { MessageChannelPair } from '../common/MessageChannelPair'
import { createConnectId, parseConnectId } from '../common/connectId'

export const ProcessClientChannelId = 'process-client-channel'

@injectable()
export class ProcessClientChannel extends Disposable implements IProcessNode {
  private _id: string

  private serviceHost: RPCServiceHost

  private _portChannel: ProcessClientChannelProtocol

  private _portChannelRPCClient: IAcquireProcessPortMainPromisify

  private _sharedProcessChannelProtocol: DeferredMessageChannelProtocol

  private _daemonProcessChannelProtocol: DeferredMessageChannelProtocol

  private _mainProcessChannelProtocol: DeferredMessageChannelProtocol

  private messageChannelPairs = new Map<string, MessageChannelPair>()

  type: AssignPassingPortType

  get sharedProcessChannelProtocol() {
    return this._sharedProcessChannelProtocol
  }

  get daemonProcessChannelProtocol() {
    return this._daemonProcessChannelProtocol
  }

  get mainProcessChannelProtocol() {
    return this._mainProcessChannelProtocol
  }

  constructor(@inject(LogServiceId) private logService: LogService) {
    super()
    this.initBuiltInChannelProtocol()
  }

  initBuiltInChannelProtocol() {
    this._sharedProcessChannelProtocol = new DeferredMessageChannelProtocol({
      masterProcessName: 'process-client',
    })
    this._daemonProcessChannelProtocol = new DeferredMessageChannelProtocol({
      masterProcessName: 'process-client',
    })
    this._mainProcessChannelProtocol = new DeferredMessageChannelProtocol({
      masterProcessName: 'process-client',
    })
  }

  initPortChannel(props: { id: string; type: AssignPassingPortType; serviceHost: RPCServiceHost }) {
    const { id, serviceHost, type } = props

    this._id = id
    this.type = type
    this.serviceHost = serviceHost

    this.serviceHost.registerServiceHandler(sharedProcessPortServicePath, this)
    this.serviceHost.registerServiceHandler(pageletProcessPortServicePath, this)
    this.serviceHost.registerServiceHandler(daemonProcessPortServicePath, this)

    const portServiceHost = new RPCServiceHost('port-service-host')
    portServiceHost.registerServiceHandler(acquirePortMainServicePath, this)

    this._portChannel = new ProcessClientChannelProtocol({
      port: process.parentPort as unknown as MainPort,
      serviceHost: portServiceHost,
      masterProcessName: `shared-utility-process`,
    })

    this._portChannelRPCClient = new ProxyRPCClient({
      requestPath: acquirePortMainServicePath,
      channel: this._portChannel,
    }).createProxy<IAcquireProcessPortMainPromisify>()

    this.sharedProcessChannelProtocol.setServiceHost(this.serviceHost)
    this.daemonProcessChannelProtocol.setServiceHost(this.serviceHost)
    this.mainProcessChannelProtocol.setServiceHost(this.serviceHost)

    /**
     * Attempt to connect main process on default.
     */
    this.acquireMainPort()
  }

  sayHelloOptionsRequest(connectId: string) {
    const pair = this.messageChannelPairs.get(connectId)
    if (pair) {
      return pair.handleSayHelloRequest()
    }
  }

  private async acquirePort(toType: AssignPassingPortType) {
    const connectId = createConnectId({
      fromId: this._id,
      fromType: this.type,
      toType,
    })
    this.logService.info(PortManagerLog.RequestPort, `connectId: ${connectId}`)
    const port = await this._portChannelRPCClient.acquirePort({
      connectId,
    })
    this.logService.info(PortManagerLog.PortResponse, `connectId: ${connectId}`)
    return {
      port: port as unknown as MainPort,
      connectId,
    }
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
    } else if (type === AssignPassingPortType.DaemonProcess) {
      this.acquireDaemonPort()
    } else if (type === AssignPassingPortType.MainProcess) {
      // In general, this condition will not happen...
      this.acquireMainPort()
    }
  }

  assignPassingPort(props: IAssignPassingPortProps, port: MessagePortMain) {
    const { connectId, reconnect = false } = props

    if (reconnect) {
      const pair = this.messageChannelPairs.get(connectId)
      if (pair) {
        pair.reconnect(port)
        return
      }
    }

    const { fromType } = parseConnectId(connectId)

    this.logService.info(PortManagerLog.AssignPort, `connectId: ${connectId}`)

    const messageChannel = new DeferredMessageChannelProtocol({
      port: port as unknown as MainPort,
      serviceHost: this.serviceHost,
      masterProcessName: 'shared-utility-process',
    })

    if (fromType === AssignPassingPortType.PageletRenderer) {
      const pair = new MessageChannelPair({
        logService: this.logService,
        connectId,
        peerRequestPath: pageletClintChannelServicePath,
        channel: messageChannel,
      })
      this.messageChannelPairs.set(connectId, pair)
    } else if (fromType === AssignPassingPortType.PageletProcess) {
      const pair = new MessageChannelPair({
        logService: this.logService,
        connectId,
        peerRequestPath: pageletProcessPortServicePath,
        channel: messageChannel,
      })
      this.messageChannelPairs.set(connectId, pair)
    }
  }
}
