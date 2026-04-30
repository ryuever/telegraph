import { BrowserWindow } from 'electron'
import type { Event as ElectronEvent, LoadFileOptions, LoadURLOptions, Rectangle } from 'electron'
import { fromNodeEvent, Emitter } from '@x-oasis/emitter'
import { Disposable } from '@x-oasis/disposable'
import { WindowError } from '@app/services/window-manager/common/types'
import type { LogService } from '@app/services/log/common/log'
import type { FileAccess } from '@app/services/file-access/electron-main/FileAccess'

import { dimensions } from '../common/config'

class BaseWindow extends Disposable {
  protected _id: string

  private options: any

  private _isPrimary: boolean

  private __emitter = new Emitter({ name: 'base-window' })

  private _window: BrowserWindow

  private fileAccess: FileAccess

  private logService: LogService

  onWindowWillCreateEvent = this.__emitter.register('on-window-will-create')

  onWindowWillCreate = this.onWindowWillCreateEvent.subscribe

  private onDidWindowCreatedEvent = this.__emitter.register('on-did-window-created')

  onDidWindowCreated = this.onDidWindowCreatedEvent.subscribe

  onWindowDidCloseEvent = this.__emitter.register('on-window-did-close')

  onWindowDidCloseHandler = this.onWindowDidCloseEvent.subscribe

  onWindowContentDidLoadEvent = this.__emitter.register('on-window-content-did-load')

  onWindowContentDidLoadHandler = this.onWindowContentDidLoadEvent.subscribe

  private onWillWindowResizeEvent = this.__emitter.register('on-will-window-resize')

  onWillWindowResize = this.onWillWindowResizeEvent.subscribe

  constructor(options: any, logService: LogService, fileAccess: FileAccess) {
    super()
    const { isPrimary = false } = options
    this._isPrimary = isPrimary
    this.logService = logService
    this.fileAccess = fileAccess
    this.options = this.resolveOptions(options)
  }

  get window() {
    return this._window
  }

  resolveOptions(options: any) {
    return {
      show: false,
      titleBarStyle: 'hidden',
      ...dimensions[this._isPrimary ? 'primary' : 'auxiliary'],
      webPreferences: {
        preload: this.fileAccess.asFileUri('@build/preload.js').fsPath,
      },
      ...options,
    }
  }

  createWindow() {
    this.onWindowWillCreateEvent.fire(this)
    this._window = new BrowserWindow(this.options)

    const protoLoadURL = this._window.loadURL
    const protoLoadFile = this._window.loadFile

    this._window.loadURL = (url: string, options?: LoadURLOptions | LoadFileOptions) => {
      if (/^\//.test(url) || /^file/.test(url)) {
        return protoLoadFile.call(this._window, url, options)
      }

      return protoLoadURL.call(this._window, url, options)
    }

    this.onDidWindowCreatedEvent.fire(this)
    this.registerListeners()
    return this._window
  }

  registerListeners() {
    this._window.once('ready-to-show', () => {
      this._window.show()
    })
    this.registerDisposable(
      fromNodeEvent(
        this._window,
        'closed'
      )(() => {
        this.onWindowDidCloseEvent.fire()
        this.dispose()
      })
    )

    this.registerDisposable(
      fromNodeEvent(
        this._window.webContents,
        'unresponsive'
      )(() => {
        this.onWindowError(WindowError.UNRESPONSIVE)
      })
    )

    this.registerDisposable(
      fromNodeEvent(
        this._window.webContents,
        'did-fail-load'
      )((...args: any[]) => {
        const [_, errorCode, errorDesc] = args
        this.onWindowError(WindowError.CONTENT_FAIL_LOAD, {
          errorCode,
          errorDesc,
        })
      })
    )

    this.registerDisposable(
      fromNodeEvent(
        this._window.webContents,
        'render-process-gone'
      )((_event: any, details: Record<string, any>) => {
        this.onWindowError(WindowError.RENDER_PROCESS_GONE, details)
      })
    )

    this.registerDisposable(
      fromNodeEvent(
        this._window.webContents,
        'did-finish-load'
      )(() => {
        this.onWindowContentDidLoadEvent.fire()
      })
    )

    this.registerDisposable(
      fromNodeEvent(
        this._window,
        'will-resize'
      )((e: ElectronEvent, bounds: Rectangle) => {
        this.onWillWindowResizeEvent.fire(e, bounds)
      })
    )
  }

  onWindowError(windowError: WindowError, extraInfo?: Record<string, any>) {
    this.logService.error(`base window error: ${windowError}`, extraInfo)
  }
}

export default BaseWindow
