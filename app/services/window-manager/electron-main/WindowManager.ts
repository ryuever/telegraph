import { inject, injectable, createId } from '@x-oasis/di'
import { Disposable } from '@x-oasis/disposable'
import { Event } from '@x-oasis/emitter'
import type { Workbench } from '@app/services/workbench/electron-main/Workbench'
import type PageletProcess from '@app/services/process/pagelet-process/electron-main/PageletProcess'
import { buildId } from '@x-oasis/id'
import type { LogService } from '@app/services/log/common/log'
import { LogServiceId } from '@app/services/log/common/log'
import type { FileAccess } from '@app/services/file-access/electron-main/FileAccess'
import { FileAccessId } from '@app/services/file-access/electron-main/FileAccess'
import { REDCITY_PAGELET_RENDERER_PROCESS_ID } from '@app/core/node/process/env'
import { BrowserWindowFactoryId } from './BrowserWindow'
import type { IBrowserWindowFactory, BrowserWindow } from './BrowserWindow'

export const WindowManagerId = createId('browser-window-factory')

@injectable()
export class WindowManager extends Disposable {
  private workbench: Workbench

  private mainWindow: BrowserWindow

  private auxiliaryWindow: BrowserWindow

  private windowMap = new Map<string, BrowserWindow>()

  private onDidMainWindowCreatedEvent = new Event({ name: 'on-did-main-window-created' })

  onDidMainWindowCreated = this.onDidMainWindowCreatedEvent.subscribe

  constructor(
    @inject(FileAccessId) private fileAccess: FileAccess,
    @inject(BrowserWindowFactoryId) private browserWindowFactory: IBrowserWindowFactory,
    @inject(LogServiceId) private logService: LogService
  ) {
    super()
  }

  initialize(workbench: Workbench) {
    this.workbench = workbench
  }

  createMainWindow() {
    this.mainWindow = this.browserWindowFactory({
      isPrimary: true,
      workbench: this.workbench,
    })
    this.registerDisposable(
      this.mainWindow.onDidWindowCreated(() => {
        this.onDidMainWindowCreatedEvent.fire(this.mainWindow.window)
      })
    )
    this.mainWindow.createWindow()
    this.windowMap.set(this.mainWindow.id, this.mainWindow)
  }

  createAuxiliaryWindow() {
    this.auxiliaryWindow = this.browserWindowFactory({
      isPrimary: false,
      workbench: this.workbench,
    })
    this.registerDisposable(
      this.auxiliaryWindow.onDidWindowCreated(() => {
        this.auxiliaryWindow.window.loadURL(
          ...this.fileAccess.asLoadURL(
            `/auxiliary?${REDCITY_PAGELET_RENDERER_PROCESS_ID}=auxiliary-app`
          )
        )
      })
    )
    this.auxiliaryWindow.createWindow()
    this.windowMap.set(this.auxiliaryWindow.id, this.auxiliaryWindow)
  }

  getMainWindow() {
    return this.mainWindow
  }

  createDisposablePanel(props: { windowId?: string; projectName: string }) {
    const { windowId, ...rest } = props
    let window = this.getWindow(windowId ?? '')
    if (!windowId) window = this.auxiliaryWindow
    window?.createDisposablePanel(rest)
  }

  createPanel(props: { windowId?: string; projectName: string }) {
    const { windowId, ...rest } = props
    let window = this.getWindow(windowId ?? '')
    if (!windowId) window = this.mainWindow
    window?.createPanel(rest)
  }

  findPageletProcess(props: { windowId?: string; pageletId: string }): PageletProcess | null {
    const { windowId = buildId('window', 1), pageletId } = props
    const window = this.getWindow(windowId)
    return window?.findPageletProcess(pageletId) ?? null
  }

  getWindow(windowId: string) {
    return this.windowMap.get(windowId)
  }
}
