import { createId, inject, injectable } from '@x-oasis/di'
import { Disposable } from '@x-oasis/disposable'
import IPCMainGlobalChannelProtocol from '@x-oasis/async-call-rpc/channel-protocol/IPCMainGlobalChannelProtocol'
import type { MessagePortMain } from 'electron'
import { MessageChannelMain } from 'electron'
import type SharedProcessMain from '@app/services/process/shared-process/electron-main/SharedProcessMain'

import type DaemonProcessMain from '@app/services/process/daemon-process/electron-main/DaemonProcessMain'

import type MainProcess from '@app/services/process/main-process/electron-main/MainProcess'

import type { WindowManager } from '@app/services/window-manager/electron-main/WindowManager'
import { ProxyRPCClient, RPCServiceHost } from '@x-oasis/async-call-rpc'
import type { MainPort } from '@x-oasis/async-call-rpc'

import {
  acquirePortMainServicePath,
  daemonProcessPortServicePath,
  mainProcessPortServicePath,
  pageletClintChannelServicePath,
  pageletProcessPortServicePath,
  sharedProcessPortServicePath,
} from '@app/services/port-manager/common/config'

import type {
  AcquirePortProps,
  IAcquirePortMain,
  MessageChannelPairProps,
  AcquiredPortRequestEntry,
} from '@app/services/port-manager/common/types'
import type { IAssignPassingPortProps } from '@app/services/process/common/types'
import { AssignPassingPortType } from '@app/services/process/common/types'
import DeferredMessageChannelProtocol from '@x-oasis/async-call-rpc/channel-protocol/DeferredMessageChannelProtocol'

import { sharedProcessName } from '@app/services/process/shared-process/common/config'
import { daemonProcessName } from '@app/services/process/daemon-process/common/config'
import { LogServiceId } from '@app/services/log/common/log'
import type { LogService } from '@app/services/log/common/log'
import IPCMainChannelProtocol from '@x-oasis/async-call-rpc/channel-protocol/IPCMainChannelProtocol'
import { PortManagerLog } from '@app/services/log/common/constants'
import { MessageChannelPair } from '../common/MessageChannelPair'
import { parseConnectId } from '../common/connectId'

export const AcquirePortId = createId('acquire-port')

@injectable()
export class AcquirePortMain extends Disposable implements IAcquirePortMain {
  type: AssignPassingPortType

  id: string

  private acquirePageletRendererPortEntryMap = new Map<
    string,
    Map<string, AcquiredPortRequestEntry>
  >()

  protected mainProcess: MainProcess

  private sharedProcessMain: SharedProcessMain

  private daemonProcessMain: DaemonProcessMain

  private buildInProcessNames: string[]

  private windowManager: WindowManager

  private _serviceHost: RPCServiceHost

  private messageChannelPairs = new Map<string, MessageChannelPair>()

  private pageletRendererChannelClientMap = new Map<string, any>()

  /**
   * created on default, then connect channel later
   */
  sharedProcessChannel: DeferredMessageChannelProtocol

  /**
   * created on default, then connect channel later
   */
  daemonProcessChannel: DeferredMessageChannelProtocol

  private portChannelServiceHost: RPCServiceHost

  protected acquirePortFromRenderer: IPCMainGlobalChannelProtocol

  constructor(@inject(LogServiceId) private logService: LogService) {
    super()
    this.portChannelServiceHost = new RPCServiceHost('port-channel')
    this.portChannelServiceHost.registerServiceHandler(acquirePortMainServicePath, this)
    this.buildInProcessNames = [sharedProcessName, daemonProcessName]

    this.type = AssignPassingPortType.MainProcess
    this.id = 'main-process'

    // should be create on initialization, or will cause error if you have defined
    // process on the root module
    this.buildInProcessNames.forEach(processName => {
      this.initBuiltInChannelClient(processName)
    })
  }

  isBuiltInChannel(processName: string) {
    return this.buildInProcessNames.indexOf(processName) !== -1
  }

  /**
   * channel client no need serviceHost. it will send request to the end...
   */
  initBuiltInChannelClient(processName: string) {
    const messageChannel = new DeferredMessageChannelProtocol({
      serviceHost: this.serviceHost,
      masterProcessName: 'main-process',
    })

    switch (processName) {
      case sharedProcessName: {
        this.sharedProcessChannel = messageChannel
        break
      }

      case daemonProcessName: {
        this.daemonProcessChannel = messageChannel
        break
      }

      default: // ....
    }
  }

  get serviceHost() {
    return this._serviceHost
  }

  initAcquirePort(
    sharedProcessMain: SharedProcessMain,
    daemonProcessMain: DaemonProcessMain,
    mainProcess: MainProcess,
    windowManager: WindowManager,
    serviceHost: RPCServiceHost
  ) {
    this.sharedProcessMain = sharedProcessMain
    this.daemonProcessMain = daemonProcessMain
    this.mainProcess = mainProcess
    this.windowManager = windowManager
    this._serviceHost = serviceHost

    // note: the global listener serviceHost should be `portChannelServiceHost`
    this.acquirePortFromRenderer = new IPCMainGlobalChannelProtocol({
      channelName: 'acquire-port',
      serviceHost: this.portChannelServiceHost,
      masterProcessName: 'main-process',
    })

    this.sharedProcessChannel.setServiceHost(this._serviceHost)
    this.daemonProcessChannel.setServiceHost(this._serviceHost)

    // should receive `notifyConnectionOptions`；
    this.serviceHost.registerServiceHandler(mainProcessPortServicePath, this)
    this.serviceHost.registerServiceHandler(sharedProcessPortServicePath, this)
    this.serviceHost.registerServiceHandler(daemonProcessPortServicePath, this)
    this.serviceHost.registerServiceHandler(pageletProcessPortServicePath, this)
  }

  initAssignPageletRendererPassingPort(pageletId: string) {
    if (this.pageletRendererChannelClientMap.has(pageletId)) return
    // TODO: note: the global listener serviceHost should be `portChannelServiceHost`
    const channel = new IPCMainChannelProtocol({
      webContents: this.windowManager.getMainWindow().window.webContents,
      channelName: `${pageletId}-assign-passing-port`,
      masterProcessName: 'main-process',
    })

    this.pageletRendererChannelClientMap.set(
      pageletId,
      new ProxyRPCClient({
        requestPath: pageletClintChannelServicePath,
        channel,
      }).createProxy()
    )
  }

  sayHelloOptionsRequest(connectId: string) {
    const pair = this.messageChannelPairs.get(connectId)
    if (pair) {
      return pair.handleSayHelloRequest()
    }
  }

  /**
   *
   * @param props
   * @param port
   *
   * 这个时候只是完成了发，还没有确定对方是否已经收到并且创建channel，
   * 所以，只有当对方通过channel给你发了一个通知一会，才能够确定channel建联了
   */
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

    const pairProps = {
      connectId,
      logService: this.logService,
    } as MessageChannelPairProps

    this.logService.info(PortManagerLog.AssignPort, `connectId: ${connectId}`)

    if (fromType === AssignPassingPortType.SharedProcess) {
      this.sharedProcessChannel.bindPort(port as any as MainPort)
      pairProps.channel = this.sharedProcessChannel
      pairProps.peerRequestPath = sharedProcessPortServicePath
      this.messageChannelPairs.set(connectId, new MessageChannelPair(pairProps))
      return this.sharedProcessChannel
    }

    if (fromType === AssignPassingPortType.DaemonProcess) {
      this.daemonProcessChannel.bindPort(port as any as MainPort)
      pairProps.channel = this.daemonProcessChannel
      pairProps.peerRequestPath = daemonProcessPortServicePath
      this.messageChannelPairs.set(connectId, new MessageChannelPair(pairProps))
      return this.daemonProcessChannel
    }

    const messageChannel = new DeferredMessageChannelProtocol({
      port: port as any as MainPort,
      serviceHost: this.serviceHost,
      masterProcessName: 'main-process',
    })

    pairProps.channel = messageChannel

    if (fromType === AssignPassingPortType.PageletRenderer) {
      pairProps.peerRequestPath = pageletClintChannelServicePath
    } else if (fromType === AssignPassingPortType.PageletProcess) {
      pairProps.peerRequestPath = pageletProcessPortServicePath
    }

    this.messageChannelPairs.set(connectId, new MessageChannelPair(pairProps))
  }

  disconnectPassingPort(connectId: string) {
    const pair = this.messageChannelPairs.get(connectId)
    if (pair) pair.disconnect()
  }

  /**
   * 这个主要是针对renderer的，因为如果是process的话，它触发的是 `AcquireProcessPortMain`;
   * 所以，关于renderer的所有port创建都是通过此方式建立
   * @param props
   * @returns
   */
  acquirePageletRendererPort(props: AcquirePortProps) {
    const { connectId } = props
    const { fromId, toType } = parseConnectId(connectId)
    let group = this.acquirePageletRendererPortEntryMap.get(fromId)
    if (!group) {
      group = new Map()
      this.acquirePageletRendererPortEntryMap.set(fromId, group)
    }
    let entry = group.get(connectId)
    const reconnect = !!entry

    const { port1: peerPort, port2: returnPort } = new MessageChannelMain()

    this.logService.info(PortManagerLog.ReceiveRequestPort, connectId, {
      reconnect,
    })

    entry = {
      connectId,
      toDispose: undefined,
      toReverse: undefined,
      toReconnect: undefined,
      isConsumer: false,
    }

    this.initAssignPageletRendererPassingPort(fromId)

    switch (toType) {
      case AssignPassingPortType.PageletProcess: {
        entry.toDispose = () => {
          // 通知接收方断开
          this.windowManager
            .findPageletProcess({
              pageletId: fromId,
            })
            ?.disconnectPassingPort(connectId)
        }

        entry.toReverse = () => {
          // 通知接收方断开，但是接收方进程如果已经完全销毁，消息是发不过去的
          entry.toDispose?.()
          // 通知发起方断开
          const client = this.pageletRendererChannelClientMap.get(fromId)
          client.disconnectPassingPort(connectId)
        }

        entry.toReconnect = () => {
          // 通知发起方重新连接
          const client = this.pageletRendererChannelClientMap.get(fromId)
          client.resumeConnection({
            type: AssignPassingPortType.PageletProcess,
          })
        }

        this.windowManager
          .findPageletProcess({
            pageletId: fromId,
          })
          ?.assignPassingPort(connectId, peerPort, entry.toReverse, entry.toReconnect, reconnect)
        break
      }

      case AssignPassingPortType.SharedProcess: {
        entry.toDispose = () => {
          this.sharedProcessMain.disconnectPassingPort(connectId)
        }
        entry.toReverse = () => {
          entry.toDispose?.()
          const client = this.pageletRendererChannelClientMap.get(fromId)

          client.disconnectPassingPort(connectId)
        }
        entry.toReconnect = () => {
          const client = this.pageletRendererChannelClientMap.get(fromId)
          client.resumeConnection({
            type: AssignPassingPortType.SharedProcess,
          })
        }

        this.sharedProcessMain.assignPassingPort(
          connectId,
          peerPort,
          entry.toReverse,
          entry.toReconnect,
          reconnect
        )
        break
      }

      case AssignPassingPortType.DaemonProcess: {
        entry.toDispose = () => {
          this.daemonProcessMain.disconnectPassingPort(connectId)
        }

        entry.toReverse = () => {
          entry.toDispose?.()
          const client = this.pageletRendererChannelClientMap.get(fromId)
          client.disconnectPassingPort(connectId)
        }
        entry.toReconnect = () => {
          const client = this.pageletRendererChannelClientMap.get(fromId)

          client.resumeConnection({
            type: AssignPassingPortType.DaemonProcess,
          })
        }
        this.daemonProcessMain.assignPassingPort(
          connectId,
          peerPort,
          entry.toReverse,
          entry.toReconnect,
          reconnect
        )
        break
      }

      case AssignPassingPortType.MainProcess: {
        entry.toDispose = () => {
          this.disconnectPassingPort(connectId)
        }

        // if main process has issue, it will be restart app
        entry.toReverse = () => {}
        entry.toReconnect = () => {}

        this.assignPassingPort(
          {
            connectId,
            reconnect,
          },
          peerPort
        )
        break
      }

      default:
      //
    }

    group.set(connectId, entry)

    return returnPort
  }

  /**
   *
   * @param pageletId
   * dispose bind port to pagelet renderer
   */
  handlePageletRendererDisposed(pageletId: string) {
    const group = this.acquirePageletRendererPortEntryMap.get(pageletId)
    if (group) {
      for (const [_, value] of group) {
        value.toDispose?.()
      }
    }
  }
}
