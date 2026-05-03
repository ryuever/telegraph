import { createId, inject, injectable } from '@x-oasis/di'
import { Disposable } from '@x-oasis/disposable'

import type { IUtilityProcessFactory } from '@telegraph/core/electron-main/utility-process/utilityProcess'
import type UtilityProcess from '@telegraph/core/electron-main/utility-process/utilityProcess'
import { UtilityProcessFactoryId } from '@telegraph/core/electron-main/utility-process/utilityProcess'
import type { FileAccess } from '@telegraph/services/file-access/electron-main/FileAccess'
import { FileAccessId } from '@telegraph/services/file-access/electron-main/FileAccess'
import type DaemonProcessMain from '@telegraph/services/process/daemon-process/electron-main/DaemonProcessMain'

import type MainProcess from '@telegraph/services/process/main-process/electron-main/MainProcess'
import { MainProcessId } from '@telegraph/services/process/main-process/electron-main/MainProcess'

import type { MessagePortMain } from 'electron'
import { AssignPassingPortType } from '@telegraph/services/process/common/types'

import { AcquireProcessPortMainFactoryId } from '@telegraph/services/port-manager/electron-main/AcquireProcessPortMain'
import type {
  AcquireProcessPortMain,
  IAcquireProcessPortMainFactory,
} from '@telegraph/services/port-manager/electron-main/AcquireProcessPortMain'
import type { WindowManager } from '@telegraph/services/window-manager/electron-main/WindowManager'
import type { ToReconnect, ToReverse } from '@telegraph/services/port-manager/common/types'

export const SharedProcessMainId = createId('shared-process-main')

@injectable()
export default class SharedProcessMain extends Disposable {
  private utilityProcess: UtilityProcess

  private windowManager: WindowManager

  private portManager: AcquireProcessPortMain

  private daemonProcessMain: DaemonProcessMain

  constructor(
    @inject(FileAccessId) private fileAccess: FileAccess,
    @inject(MainProcessId) private mainProcess: MainProcess,
    @inject(UtilityProcessFactoryId) private utilityProcessFactory: IUtilityProcessFactory,
    @inject(AcquireProcessPortMainFactoryId)
    private acquireProcessPortMainFactory: IAcquireProcessPortMainFactory
  ) {
    super()
  }

  initialize(windowManager: WindowManager, daemonProcessMain: DaemonProcessMain) {
    this.daemonProcessMain = daemonProcessMain
    this.windowManager = windowManager
  }

  assignPassingPort(
    connectId: string,
    port: MessagePortMain,
    toReverse: ToReverse,
    toReconnect: ToReconnect,
    reconnect?: boolean
  ) {
    this.portManager.assignPassingPort(connectId, port, toReverse, toReconnect, reconnect)
  }

  disconnectPassingPort(connectId: string) {
    this.portManager.disconnectPassingPort(connectId)
  }

  get name() {
    return 'shared-process'
  }

  handleProcessDisposed() {
    this.portManager.handleProcessDisposed()
  }

  handleResumeConnection() {
    this._createUtilityProcess()
    this.portManager.updateAcquirePortListener(this.utilityProcess.process!)

    this.portManager.resumeConnection()
  }

  initializePortManager() {
    this.portManager = this.acquireProcessPortMainFactory(
      'shared-process',
      'shared-process',
      AssignPassingPortType.SharedProcess,
      this,
      this.daemonProcessMain,
      this.mainProcess,
      this.windowManager
    )
  }

  _createUtilityProcess() {
    this.utilityProcess = this.utilityProcessFactory()
    this.utilityProcess.start({
      id: 'shared-process',
      serviceName: 'shared-process',
      ppid: process.pid,
      entry: this.fileAccess.asFileUri('@build/shared-process-bootstrap.js').fsPath,
    })
  }

  createUtilityProcess() {
    this.initializePortManager()
    this._createUtilityProcess()
    this.portManager.initAcquirePortListener(this.utilityProcess.process!)
    return this.utilityProcess
  }
}
