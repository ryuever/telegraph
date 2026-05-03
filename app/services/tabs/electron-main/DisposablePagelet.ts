import type { LoadFileOptions } from 'electron'
import { BrowserView } from 'electron'
import type { BrowserWindow } from '@app/services/window-manager/electron-main/BrowserWindow'
import { Disposable } from '@x-oasis/disposable'
import { Emitter } from '@x-oasis/emitter'
import { createId, injectable, inject } from '@x-oasis/di'
import type PageletProcess from '@app/services/process/pagelet-process/electron-main/PageletProcess'
import { PageletProcessFactoryId } from '@app/services/process/pagelet-process/electron-main/PageletProcess'
import type { IPageletProcessFactory } from '@app/services/process/pagelet-process/electron-main/PageletProcess'
import type MainProcess from '@app/services/process/main-process/electron-main/MainProcess'
import { MainProcessId } from '@app/services/process/main-process/electron-main/MainProcess'
import type { LogService } from '@app/services/log/common/log'
import { LogServiceId } from '@app/services/log/common/log'

import type { Workbench } from '@app/services/workbench/electron-main/Workbench'

import { REDCITY_PAGELET_RENDERER_PROCESS_ID } from '@app/core/node/process/env'

import { buildId } from '@x-oasis/id'
import { toDisposable } from '@x-oasis/disposable'
import { colors } from '@x-oasis/ansi-colors'
import { FileAccessId } from '@app/services/file-access/electron-main/FileAccess'
import type { FileAccess } from '@app/services/file-access/electron-main/FileAccess'

import type DisposablePanel from './DisposablePanel'
import type {
  PageletProps,
  Dimension,
  BrowserViewConfig,
  DisposablePageletProps,
} from '../common/types'

export const DisposablePageletFactoryId = createId('disposable-pagelet-factory')
export type IDisposablePageletFactory = (props: DisposablePageletProps) => DisposablePagelet

@injectable()
export default class DisposablePagelet extends Disposable {
  private _id: string

  private _view: BrowserView

  private _dimension: Dimension

  private _panel: DisposablePanel

  private _projectName: string

  private _workbench: Workbench

  private _browserWindow: BrowserWindow

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

  constructor(
    props: PageletProps,
    @inject(FileAccessId) private fileAccess: FileAccess,
    @inject(LogServiceId) private logService: LogService,
    @inject(MainProcessId) private mainProcess: MainProcess,
    @inject(PageletProcessFactoryId) private pageletProcessFactory: IPageletProcessFactory
  ) {
    super()
    const { panel, dimension, browserWindow, projectName, browserViewConfig } = props
    this._dimension = dimension!
    this._projectName = projectName
    this._workbench = props.workbench
    this._panel = panel as any
    this._browserWindow = browserWindow
    this._id = `${this._panel.id}_${buildId('disposable-pagelet', this.projectName)}`

    this.browserViewConfig = browserViewConfig

    this.onWillCreateEvent.fire()
    this.logService.info(`${this.projectName} pagelet will create`)

    this.createBrowserView()
    this.startupPageletProcess()

    this.registerDisposable(
      toDisposable(() => {
        // do clean
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

  setBounds(dimension: Dimension) {
    this.view.setBounds(dimension)
  }

  createBrowserView() {
    this._view = new BrowserView({
      webPreferences: this.browserViewConfig.webPreferences,
    })
    this.registerBrowserViewListeners()

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      this._view.webContents.loadURL(
        ...this.fileAccess.asLoadURL(this.browserViewConfig.loadURL, {
          query: {
            [REDCITY_PAGELET_RENDERER_PROCESS_ID]: this.id,
          },
        })
      )
    } else {
      this._view.webContents.loadFile(
        ...(this.fileAccess.asLoadURL(this.browserViewConfig.loadURL, {
          query: {
            [REDCITY_PAGELET_RENDERER_PROCESS_ID]: this.id,
          },
        }) as [string, LoadFileOptions])
      )
    }

    // this._view.webContents.loadURL(
    //   ...this.fileAccess.asLoadURL(this.browserViewConfig.loadURL, {
    //     query: {
    //       [REDCITY_PAGELET_RENDERER_PROCESS_ID]: this.id,
    //     },
    //   })
    // )

    this.setBounds(this._dimension)
    this.window.addBrowserView(this._view)

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) this._view.webContents.openDevTools()

    this.onDidCreatedEvent.fire()
    this.logService.info(`${this.projectName} pagelet did created`)

    this.registerDisposable(
      toDisposable(() => {
        this.mainProcess.handlePageletRendererDisposed(this.id)
        this.window.removeBrowserView(this._view)
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
        this.logService.info(
          ...[
            colors.magenta(`process pagelet for ${this.projectName} project renderer will be`),
            colors.yellow('reused !!!'),
          ]
        )
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
      console.error('[startup pagelets process error] ', err)
    }
  }

  disposePagelet() {
    this.logService.info(`${this.projectName} pagelet will be disposed`)
    this.onWillDisposeEvent.fire()
    this.dispose()
    this.onDidDisposedEvent.fire()
    this.logService.info(`${this.projectName} pagelet did disposed`)
  }
}
