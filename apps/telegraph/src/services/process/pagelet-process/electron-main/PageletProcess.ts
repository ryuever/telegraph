import { createId, inject, injectable } from '@x-oasis/di'
import { Disposable } from '@x-oasis/disposable'
import type { IUtilityProcessFactory } from '@telegraph/core/electron-main/utility-process/utilityProcess'
import type { IUtilityProcessConfig } from '@telegraph/core/electron-main/utility-process/types/utilityProcess'
import type UtilityProcess from '@telegraph/core/electron-main/utility-process/utilityProcess'
import { UtilityProcessFactoryId } from '@telegraph/core/electron-main/utility-process/utilityProcess'
import type { FileAccess } from '@telegraph/services/file-access/electron-main/FileAccess'
import { FileAccessId } from '@telegraph/services/file-access/electron-main/FileAccess'
import type { MessagePortMain } from 'electron'
import { AssignPassingPortType } from '@telegraph/services/process/common/types'
import { AcquireProcessPortMainFactoryId } from '@telegraph/services/port-manager/electron-main/AcquireProcessPortMain'
import type {
  AcquireProcessPortMain,
  IAcquireProcessPortMainFactory,
} from '@telegraph/services/port-manager/electron-main/AcquireProcessPortMain'
import type SharedProcessMain from '@telegraph/services/process/shared-process/electron-main/SharedProcessMain'
import { SharedProcessMainId } from '@telegraph/services/process/shared-process/electron-main/SharedProcessMain'

import type DaemonProcessMain from '@telegraph/services/process/daemon-process/electron-main/DaemonProcessMain'
import { DaemonProcessMainId } from '@telegraph/services/process/daemon-process/electron-main/DaemonProcessMain'

import type MainProcess from '@telegraph/services/process/main-process/electron-main/MainProcess'
import { MainProcessId } from '@telegraph/services/process/main-process/electron-main/MainProcess'
import type { WindowManager } from '@telegraph/services/window-manager/electron-main/WindowManager'
import type { ToReconnect, ToReverse } from '@telegraph/services/port-manager/common/types'

export const PageletProcessFactoryId = createId('pagelet-process-factory')
export type IPageletProcessFactory = (
  projectName: string,
  windowManager: WindowManager
) => PageletProcess

@injectable()
export default class PageletProcess extends Disposable {
  private utilityProcess: UtilityProcess

  private _projectName: string

  private _windowManager: WindowManager

  private portManager: AcquireProcessPortMain

  constructor(
    projectName: string,
    windowManager: WindowManager,
    @inject(FileAccessId) private fileAccess: FileAccess,
    @inject(DaemonProcessMainId) private daemonProcessMain: DaemonProcessMain,
    @inject(MainProcessId) private mainProcess: MainProcess,
    @inject(SharedProcessMainId) private sharedProcessMain: SharedProcessMain,
    @inject(UtilityProcessFactoryId) private utilityProcessFactory: IUtilityProcessFactory,
    @inject(AcquireProcessPortMainFactoryId)
    private acquireProcessPortMainFactory: IAcquireProcessPortMainFactory
  ) {
    super()
    this._projectName = projectName
    this._windowManager = windowManager
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

  createUtilityProcess(props: Partial<IUtilityProcessConfig> = {}) {
    this.utilityProcess = this.utilityProcessFactory()

    this.utilityProcess.start({
      id: props.id!,
      projectName: this._projectName,
      serviceName: `${this._projectName}-pagelet-process`,
      ppid: process.pid,
      entry: this.fileAccess.asFileUri('@build/pagelet-process-bootstrap.js').fsPath,
      ...props,
    })

    this.portManager = this.acquireProcessPortMainFactory(
      'pagelet-process',
      props.id!,
      AssignPassingPortType.PageletProcess,
      this.sharedProcessMain,
      this.daemonProcessMain,
      this.mainProcess,
      this._windowManager
    )

    this.portManager.initAcquirePortListener(this.utilityProcess.process!)

    return this.utilityProcess
  }
}
