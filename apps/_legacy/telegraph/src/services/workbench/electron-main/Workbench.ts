import { createId, inject, injectable } from '@x-oasis/di'
import { Disposable } from '@x-oasis/disposable'
import type { BrowserWindow } from 'electron'
import { app } from 'electron'
import { Emitter } from '@x-oasis/emitter'
import type { WindowManager } from '@telegraph/services/window-manager/electron-main/WindowManager'
import { WindowManagerId } from '@telegraph/services/window-manager/electron-main/WindowManager'
import type { LogService } from '@telegraph/services/log/common/log'
import { LogServiceId } from '@telegraph/services/log/common/log'
import { ProjectRegistryId } from '@telegraph/services/project-registry/electron-main/ProjectRegistry'
import type { Projects } from '@telegraph/services/project-registry/electron-main/ProjectRegistry'
import type { BrowserViewConfig } from '@telegraph/services/project-registry/electron-main/types'
import type { FileAccess } from '@telegraph/services/file-access/electron-main/FileAccess'
import { FileAccessId } from '@telegraph/services/file-access/electron-main/FileAccess'
import { TELEGRAPH_PAGELET_RENDERER_PROCESS_ID } from '@telegraph/core/node/process/env'
import { PerformanceStage, WorkBenchLog } from '@telegraph/services/log/common/constants'
import { PerformanceTracker } from '@telegraph/services/log/common/performance'
import type { IWorkbench } from '../common/types'

export const WorkbenchId = createId('workbench-id')

@injectable()
export class Workbench extends Disposable implements IWorkbench {
  private _emitter = new Emitter({ name: 'workbench' })

  private onDidMainWindowCreatedEvent = this._emitter.register('on-did-main-window-created')

  private performanceTracker: PerformanceTracker

  onDidMainWindowCreated = this.onDidMainWindowCreatedEvent.subscribe

  constructor(
    @inject(LogServiceId) private logService: LogService,
    @inject(FileAccessId) private fileAccess: FileAccess,
    @inject(WindowManagerId) public windowManager: WindowManager,
    @inject(ProjectRegistryId) private projects: Projects
  ) {
    super()
    this.performanceTracker = new PerformanceTracker(this.logService.trace.bind(this.logService))
    this.windowManager.initialize(this)
  }

  createMainWindow() {
    this.performanceTracker.start(PerformanceStage.WaitAppReady)
    this.logService.info(WorkBenchLog.WaitAppReady)
    app.whenReady().then(() => {
      this.performanceTracker.end(PerformanceStage.WaitAppReady)
      this.logService.info(WorkBenchLog.CreateMainWindowStart)
      this.registerDisposable(
        this.windowManager.onDidMainWindowCreated((window: BrowserWindow) => {
          this.performanceTracker.end(PerformanceStage.CreateMainWindow)
          this.logService.info(WorkBenchLog.CreateMainWindowEnd)
          this.onDidMainWindowCreatedEvent.fire(window)
        })
      )
      this.performanceTracker.start(PerformanceStage.CreateMainWindow)
      this.windowManager.createMainWindow()
    })
  }

  createAuxiliaryWindow() {
    this.windowManager.createAuxiliaryWindow()
  }

  createDisposablePanel(props: { projectName: string }) {
    this.windowManager.createDisposablePanel(props)
  }

  killPageletProcess() {}

  // TODO: temp to use
  async loadAppURL() {
    this.performanceTracker.start(PerformanceStage.LoadAppPage)
    this.logService.info(WorkBenchLog.LoadAppPageStart)
    await this.windowManager
      .getMainWindow()
      .window[
        MAIN_WINDOW_VITE_DEV_SERVER_URL ? 'loadURL' : 'loadFile'
      ](...this.fileAccess.asLoadURL(`/app?${TELEGRAPH_PAGELET_RENDERER_PROCESS_ID}=main-renderer-app`))
    this.logService.info(WorkBenchLog.LoadAppPageEnd)
    this.performanceTracker.end(PerformanceStage.LoadAppPage)
  }

  createPanel(props: { windowId?: string; projectName: string }) {
    this.logService.info(WorkBenchLog.CreatePanel, {
      projectName: props.projectName,
    })
    this.windowManager.createPanel(props)
  }

  getPageletConfig(projectName: string) {
    const configs = this.getPageletConfigs()
    return configs.find(config => config.projectName === projectName)
  }

  // temp setting, will read from config file in the future
  getPageletConfigs(): BrowserViewConfig[] {
    const preload = this.fileAccess.asFileUri('@build/preload.js').fsPath
    const builtinConfigs: BrowserViewConfig[] = [
      {
        projectName: 'monitor',
        loadURL: '/monitor',
        openDevTools: false,
        webPreferences: { preload },
        amdEntry: this.fileAccess.asFileUri('@build/monitor-pagelet-entry.js').fsPath,
      },
      {
        projectName: 'chat',
        loadURL: '/chat',
        openDevTools: false,
        webPreferences: { preload },
      },
      {
        projectName: 'design',
        loadURL: '/design',
        openDevTools: false,
        webPreferences: { preload },
      },
    ]
    return [...builtinConfigs, ...this.projects.getLoadConfigs()]
  }
}
