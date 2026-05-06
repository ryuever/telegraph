import { inject, injectable, createId } from '@x-oasis/di'
import { Disposable } from '@x-oasis/disposable'
import { Event } from '@x-oasis/emitter'
import type { Workbench } from '@telegraph/services/workbench/electron-main/Workbench'
import type PageletProcess from '@telegraph/services/process/pagelet-process/electron-main/PageletProcess'
import { buildId } from '@x-oasis/id'
import type { LogService } from '@telegraph/services/log/common/log'
import { LogServiceId } from '@telegraph/services/log/common/log'
import type { FileAccess } from '@telegraph/services/file-access/electron-main/FileAccess'
import { FileAccessId } from '@telegraph/services/file-access/electron-main/FileAccess'
import { TELEGRAPH_PAGELET_RENDERER_PROCESS_ID } from '@telegraph/core/node/process/env'
import { BrowserWindowFactoryId } from './BrowserWindow'
import type { IBrowserWindowFactory, BrowserWindow } from './BrowserWindow'

export const WindowManagerId = createId('browser-window-factory')

const MONITOR_WINDOW_WIDTH = 620
const MONITOR_WINDOW_HEIGHT = 760
const MONITOR_WINDOW_MIN_WIDTH = 480
const MONITOR_WINDOW_MIN_HEIGHT = 520

@injectable()
export class WindowManager extends Disposable {
  private workbench: Workbench

  private mainWindow: BrowserWindow

  private auxiliaryWindow: BrowserWindow

  private monitorWindow: BrowserWindow | null = null

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
            `/auxiliary?${TELEGRAPH_PAGELET_RENDERER_PROCESS_ID}=auxiliary-app`
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

  getMonitorWindow() {
    if (this.monitorWindow && !this.monitorWindow.window?.isDestroyed()) {
      return this.monitorWindow
    }
    return null
  }

  createMonitorWindow() {
    const existing = this.getMonitorWindow()
    if (existing) {
      existing.window.focus()
      return existing
    }

    const monitorWindow = this.browserWindowFactory({
      isPrimary: false,
      workbench: this.workbench,
      width: MONITOR_WINDOW_WIDTH,
      height: MONITOR_WINDOW_HEIGHT,
      minWidth: MONITOR_WINDOW_MIN_WIDTH,
      minHeight: MONITOR_WINDOW_MIN_HEIGHT,
      title: 'Monitor',
    })

    this.registerDisposable(
      monitorWindow.onDidWindowCreated(() => {
        // 通过 Panel/Pagelet 机制创建 BrowserView + PageletProcess
        // fullscreen=true 让 BrowserView 占满窗口（无侧边栏偏移）
        monitorWindow.createPanel({ projectName: 'monitor', fullscreen: true })

        // BrowserWindow 自身不加载 URL（内容在 BrowserView 中），
        // ready-to-show 可能不会触发，需要手动显示窗口
        if (!monitorWindow.window.isVisible()) {
          monitorWindow.window.show()
        }
      })
    )

    this.registerDisposable(
      monitorWindow.onWindowDidCloseHandler(() => {
        this.windowMap.delete(monitorWindow.id)
        if (this.monitorWindow === monitorWindow) {
          this.monitorWindow = null
        }
      })
    )

    monitorWindow.createWindow()
    this.monitorWindow = monitorWindow
    this.windowMap.set(monitorWindow.id, monitorWindow)
    return monitorWindow
  }

  toggleMonitorWindow() {
    const existing = this.getMonitorWindow()
    if (existing) {
      existing.window.close()
      return
    }
    this.createMonitorWindow()
  }

  createDisposablePanel(props: { windowId?: string; projectName: string }) {
    const { windowId, ...rest } = props
    let window = this.getWindow(windowId ?? '')
    if (!windowId) window = this.auxiliaryWindow
    window?.createDisposablePanel(rest)
  }

  createPanel(props: { windowId?: string; projectName: string; fullscreen?: boolean }) {
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
