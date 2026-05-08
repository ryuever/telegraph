import { createId, inject, injectable } from '@x-oasis/di'
import { Disposable } from '@x-oasis/disposable'
import { MessageChannelMain } from 'electron'
import type { UtilityProcess, MessagePortMain } from 'electron'
import type SharedProcessMain from '@telegraph/services/process/shared-process/electron-main/SharedProcessMain'

import type DaemonProcessMain from '@telegraph/services/process/daemon-process/electron-main/DaemonProcessMain'

import type MainProcess from '@telegraph/services/process/main-process/electron-main/MainProcess'

import { RPCServiceHost, ProxyRPCClient } from '@x-oasis/async-call-rpc'
import { ElectronUtilityProcessChannel } from '@x-oasis/async-call-rpc-electron'
import type { IProcessNode } from '@telegraph/services/process/common/types'
import { AssignPassingPortType } from '@telegraph/services/process/common/types'

import type {
  ProcessPingMain,
  IProcessPingMainFactory,
} from '@telegraph/services/ping/electron-main/ProcessPingMain'
import { ProcessPingMainFactoryId } from '@telegraph/services/ping/electron-main/ProcessPingMain'
import { acquirePortMainServicePath } from '@telegraph/services/port-manager/common/config'
import type {
  AcquiredPortRequestEntry,
  AcquirePortProps,
  IAcquireProcessPortMain,
  ToReconnect,
  ToReverse,
} from '@telegraph/services/port-manager/common/types'

import type { WindowManager } from '@telegraph/services/window-manager/electron-main/WindowManager'
import type { LogService } from '@telegraph/services/log/common/log'
import { LogServiceId } from '@telegraph/services/log/common/log'
import { PortManagerLog } from '@telegraph/services/log/common/constants'
import { parseConnectId } from '../common/connectId'

export const AcquireProcessPortMainFactoryId = createId('acquire-process-port-main-factory')
export type IAcquireProcessPortMainFactory = (
  name: string,
  id: string,
  type: AssignPassingPortType,
  sharedProcessMain: SharedProcessMain,
  daemonProcessMain: DaemonProcessMain,
  mainProcess: MainProcess,
  windowManager: WindowManager
) => AcquireProcessPortMain

@injectable()
export class AcquireProcessPortMain extends Disposable implements IAcquireProcessPortMain {
  private name: string

  private acquiredPortRequestEntryMap = new Map<string, Map<string, AcquiredPortRequestEntry>>()

  private id: string

  private type: AssignPassingPortType

  private sharedProcessMain: SharedProcessMain

  private daemonProcessMain: DaemonProcessMain

  private mainProcess: MainProcess

  protected windowManager: WindowManager

  private processChannel: ElectronUtilityProcessChannel

  private portChannelServiceHost: RPCServiceHost

  private pingService: ProcessPingMain

  private rpcClient: IProcessNode

  private _process: UtilityProcess

  // private pageletRendererPortMap = new Map<string, Token>()

  constructor(
    name: string,
    id: string,
    type: AssignPassingPortType,
    sharedProcessMain: SharedProcessMain,
    daemonProcessMain: DaemonProcessMain,
    mainProcess: MainProcess,
    windowManager: WindowManager,
    @inject(LogServiceId) private logService: LogService,
    @inject(ProcessPingMainFactoryId) private processPingMainFactory: IProcessPingMainFactory
  ) {
    super()

    this.name = name
    this.id = id
    this.type = type
    this.windowManager = windowManager
    this.sharedProcessMain = sharedProcessMain
    this.daemonProcessMain = daemonProcessMain
    this.mainProcess = mainProcess

    this.portChannelServiceHost = new RPCServiceHost()

    this.portChannelServiceHost.registerServiceHandler(acquirePortMainServicePath, this)
  }

  initAcquirePortListener(process: UtilityProcess) {
    this._process = process
    this.processChannel = new ElectronUtilityProcessChannel({
      process,
      description: 'main-process',
    })
    this.processChannel.setServiceHost(this.portChannelServiceHost)

    this.rpcClient = new ProxyRPCClient(acquirePortMainServicePath, {
      channel: this.processChannel,
    }).createProxy()

    this.pingService = this.processPingMainFactory({
      processName: 'shared-process',
      process: this._process,
    })
  }

  updateAcquirePortListener(process: UtilityProcess) {
    this._process = process

    if (this.processChannel) {
      this.processChannel.disconnect()
    }

    this.processChannel = new ElectronUtilityProcessChannel({
      process,
      description: 'main-process',
    })
    this.processChannel.setServiceHost(this.portChannelServiceHost)

    this.rpcClient = new ProxyRPCClient(acquirePortMainServicePath, {
      channel: this.processChannel,
    }).createProxy()

    this.pingService = this.processPingMainFactory({
      processName: 'shared-process',
      process: this._process,
    })
  }

  disconnectPassingPort(connectId: string) {
    this.rpcClient.disconnectPassingPort(connectId)
  }

  assignPassingPort(
    connectId: string,
    port: MessagePortMain,
    toReverse: ToReverse,
    toReconnect: ToReconnect,
    reconnect?: boolean
  ) {
    this.logService.info(PortManagerLog.AssignPort, connectId)

    const { fromId } = parseConnectId(connectId)

    let group = this.acquiredPortRequestEntryMap.get(fromId)
    if (!group) {
      group = new Map()
      this.acquiredPortRequestEntryMap.set(fromId, group)
    }

    group.set(connectId, {
      connectId,
      toReverse,
      toReconnect,
      isConsumer: true,
    } as AcquiredPortRequestEntry)

    this.rpcClient.assignPassingPort({ connectId, reconnect }, port)
  }

  acquirePort(props: AcquirePortProps) {
    const { connectId } = props
    const { fromId, toType } = parseConnectId(connectId)

    let group = this.acquiredPortRequestEntryMap.get(fromId)
    if (!group) {
      group = new Map()
      this.acquiredPortRequestEntryMap.set(fromId, group)
    }

    let entry = group.get(connectId)!
    const reconnect = !!entry
    const { port1: peerPort, port2: returnPort } = new MessageChannelMain()

    this.logService.info(PortManagerLog.ReceiveRequestPort, `connectId: ${connectId}`, {
      reconnect,
    })

    entry = {
      connectId,
      isConsumer: false,
    }

    switch (toType) {
      // node process 和 shared process 建联
      case AssignPassingPortType.SharedProcess: {
        entry.toDispose = () => {
          // 通知接收方断开连接
          this.sharedProcessMain.disconnectPassingPort(connectId)
        }
        entry.toReverse = () => {
          // 通知接收方断开，但是接收方进程如果已经完全销毁，消息是发不过去的
          entry.toDispose?.()
          // 通知发起方断开连接
          this.rpcClient.disconnectPassingPort(connectId)
        }
        entry.toReconnect = () => {
          // 通知发起方重新连接
          this.rpcClient.resumeConnection({
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

      // node process 和 daemon process 建联
      case AssignPassingPortType.DaemonProcess: {
        entry.toDispose = () => {
          this.daemonProcessMain.disconnectPassingPort(connectId)
        }

        entry.toReverse = () => {
          entry.toDispose?.()

          this.rpcClient.disconnectPassingPort(connectId)
        }
        entry.toReconnect = () => {
          this.rpcClient.resumeConnection({ type: AssignPassingPortType.DaemonProcess })
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

      // node process 跟 main process 建联
      case AssignPassingPortType.MainProcess: {
        entry.toDispose = () => {
          this.mainProcess.disconnectPassingPort(connectId)
        }

        // main process condition !!!, should restart app
        entry.toReverse = () => {}
        entry.toReconnect = () => {}

        this.mainProcess.assignPassingPort(connectId, peerPort, reconnect)
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
  handleProcessDisposed() {
    for (const [_, group] of this.acquiredPortRequestEntryMap) {
      if (group) {
        for (const [_, value] of group) {
          const { isConsumer, toDispose, toReverse } = value
          // 作为接收方，通知发起方断开
          if (isConsumer) toReverse?.()
          // 作为发起方，只需要通知接收方断开
          if (!isConsumer) toDispose?.()
        }
      }
    }
  }

  resumeConnection() {
    for (const [_, group] of this.acquiredPortRequestEntryMap) {
      if (group) {
        for (const [_, value] of group) {
          const { isConsumer, toReconnect } = value
          if (isConsumer) {
            toReconnect?.()
          }
        }
      }
    }
  }
}
