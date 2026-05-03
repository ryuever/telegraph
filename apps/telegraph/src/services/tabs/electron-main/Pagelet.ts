import type { LoadFileOptions } from 'electron'
import { BrowserView } from 'electron'
import { Disposable } from '@x-oasis/disposable'
import { Emitter } from '@x-oasis/emitter'
import { createId, injectable, inject } from '@x-oasis/di'
import { PageletProcessFactoryId } from '@telegraph/services/process/pagelet-process/electron-main/PageletProcess'
import type PageletProcess from '@telegraph/services/process/pagelet-process/electron-main/PageletProcess'
import type { IPageletProcessFactory } from '@telegraph/services/process/pagelet-process/electron-main/PageletProcess'
import type MainProcess from '@telegraph/services/process/main-process/electron-main/MainProcess'
import { MainProcessId } from '@telegraph/services/process/main-process/electron-main/MainProcess'
import type { LogService } from '@telegraph/services/log/common/log'
import { LogServiceId } from '@telegraph/services/log/common/log'

import { SharedProcessMainId } from '@telegraph/services/process/shared-process/electron-main/SharedProcessMain'
import type SharedProcessMain from '@telegraph/services/process/shared-process/electron-main/SharedProcessMain'
import type { Workbench } from '@telegraph/services/workbench/electron-main/Workbench'

import type { BrowserWindow } from '@telegraph/services/window-manager/electron-main/BrowserWindow'
import { TELEGRAPH_PAGELET_RENDERER_PROCESS_ID } from '@telegraph/core/node/process/env'
import { buildId } from '@x-oasis/id'
import { toDisposable } from '@x-oasis/disposable'
import type { FileAccess } from '@telegraph/services/file-access/electron-main/FileAccess'
import { FileAccessId } from '@telegraph/services/file-access/electron-main/FileAccess'

import { PageletLog, PerformanceStage } from '@telegraph/services/log/common/constants'
import { PerformanceTracker } from '@telegraph/services/log/common/performance'
import type { PageletProps, Dimension, BrowserViewConfig } from '../common/types'
import type Panel from './Panel'

export const PageletFactoryId = createId('pagelet-factory')
export type IPageletFactory = (props: PageletProps) => Pagelet

@injectable()
export default class Pagelet extends Disposable {
  private _id: string

  private _view: BrowserView

  private _workbench: Workbench

  private _browserWindow: BrowserWindow

  private _dimension: Dimension

  private _panel: Panel

  private _projectName: string

  private browserViewConfig: BrowserViewConfig

  pageletProcess: PageletProcess

  private emitter = new Emitter({ name: 'panel' })

  private onWillCreateEvent = this.emitter.register('on-will-create')

  onWillCreate = this.onWillCreateEvent.subscribe

  private onDidCreatedEvent = this.emitter.register('on-did-created')

  onDidCreate = this.onDidCreatedEvent.subscribe

  private onWillSetToTopEvent = this.emitter.register('on-will-set-to-top')

  onWillSetToTop = this.onWillSetToTopEvent.subscribe

  private onDidSetToTopEvent = this.emitter.register('on-did-set-to-top')

  onDidSetToTop = this.onDidSetToTopEvent.subscribe

  onDidFinishLoadEvent = this.emitter.register('on-did-finish-load')

  onDidFinishLoad = this.onDidFinishLoadEvent.subscribe

  private onWillDisposeEvent = this.emitter.register('on-will-dispose')

  onWillDispose = this.onWillDisposeEvent.subscribe

  private onDidDisposedEvent = this.emitter.register('on-did-disposed')

  onDidDisposed = this.onDidDisposedEvent.subscribe

  private performanceTracker: PerformanceTracker

  constructor(
    props: PageletProps,
    @inject(FileAccessId) private fileAccess: FileAccess,
    @inject(LogServiceId) private logService: LogService,
    @inject(MainProcessId) private mainProcess: MainProcess,
    @inject(SharedProcessMainId) private sharedProcessMain: SharedProcessMain,
    @inject(PageletProcessFactoryId) private pageletProcessFactory: IPageletProcessFactory
  ) {
    super()
    const { workbench, dimension, browserWindow, projectName, browserViewConfig, panel } = props
    this._workbench = workbench
    this._panel = panel
    this._browserWindow = browserWindow
    this._dimension = dimension!
    this._projectName = projectName
    this._id = `${this._panel.id}_${buildId('pagelet', this.projectName)}`

    this.browserViewConfig = browserViewConfig
    this.performanceTracker = new PerformanceTracker(this.logService.trace.bind(this.logService))

    this.onWillCreateEvent.fire()
    this.logService.info(`${this.projectName} ${PageletLog.CreatePageletStart}`)

    this.createBrowserView()
    this.startupPageletProcess()

    this.registerDisposable(
      toDisposable(() => {
        this._panel.removePagelet(this)
      })
    )
  }

  get id() {
    return this._id
  }

  get view() {
    return this._view
  }

  get projectName() {
    return this._projectName
  }

  get window() {
    return this._browserWindow.window
  }

  setToTop() {
    this.logService.info(`${this.projectName} ${PageletLog.PageletSetTop}`)
    this.onWillSetToTopEvent.fire()
    if (this._view) this.window.setTopBrowserView(this._view)
    this.logService.info(`${this.projectName} ${PageletLog.PageletDidSetTop}`)
    this.onDidSetToTopEvent.fire()
  }

  setBounds(dimension: Dimension) {
    this.view.setBounds(dimension)
  }

  createBrowserView() {
    this.performanceTracker.start(PerformanceStage.CreateBrowserView)
    this.logService.info(`${this.projectName} ${PageletLog.CreateBrowserViewStart}`)
    this._view = new BrowserView({
      webPreferences: this.browserViewConfig.webPreferences,
    })

    this.registerBrowserViewListeners()

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      this._view.webContents.loadURL(
        ...this.fileAccess.asLoadURL(this.browserViewConfig.loadURL, {
          query: {
            [TELEGRAPH_PAGELET_RENDERER_PROCESS_ID]: this.id,
          },
        })
      )
    } else {
      this._view.webContents
        .loadFile(
          ...(this.fileAccess.asLoadURL(this.browserViewConfig.loadURL, {
            query: {
              [TELEGRAPH_PAGELET_RENDERER_PROCESS_ID]: this.id,
            },
          }) as [string, LoadFileOptions])
        )
        .then(() => {
          this.logService.info(`${this.projectName} ${PageletLog.LoadPageletPageSuccess}`)
          this.performanceTracker.end(PerformanceStage.CreateBrowserView)
        })
        .catch(e => {
          this.logService.error(`${this.projectName} ${PageletLog.LoadPageletPageFail}`, e.message)
        })
    }

    this.setBounds(this._dimension)
    this.window.addBrowserView(this._view)

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) this._view.webContents.openDevTools()

    this.onDidCreatedEvent.fire()

    this.registerDisposable(
      toDisposable(() => {
        this.mainProcess.handlePageletRendererDisposed(this.id)
        this.window.removeBrowserView(this._view)
        // https://github.com/electron/electron/issues/10096#issuecomment-774505246
        ;(this._view.webContents as any)?.destroy()
      })
    )
  }

  registerBrowserViewListeners() {
    this._view.webContents.addListener('did-finish-load', () => {
      this.onDidFinishLoadEvent.fire()
    })
  }

  startupPageletProcess() {
    try {
      const reservedPageletProcess = this._browserWindow.getCachedPageletProcess(this.projectName)

      if (reservedPageletProcess) {
        this.pageletProcess = reservedPageletProcess
        this.logService.info(`${this.projectName} ${PageletLog.PageletProcessReused}`)
        return
      }

      this.pageletProcess = this.pageletProcessFactory(
        this.projectName,
        this._workbench.windowManager
      )

      this.pageletProcess.createUtilityProcess({
        id: this.id,
        amdEntry: this.browserViewConfig.amdEntry,
      })

      this._browserWindow.setCachedPageletProcess(this.projectName, this.pageletProcess)
    } catch (err) {
      this.logService.error(`${this.projectName} ${PageletLog.PageletProcessError}`)
    }
  }

  disposePagelet() {
    this.logService.info(`${this.projectName} ${PageletLog.PageletDispose}`)
    this.onWillDisposeEvent.fire()
    this.dispose()
    this.onDidDisposedEvent.fire()
  }
}
