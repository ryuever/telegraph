import { Emitter } from '@x-oasis/emitter'
import { injectable, createId, inject } from '@x-oasis/di'
import type { LogService } from '@telegraph/services/log/common/log'
import { LogServiceId } from '@telegraph/services/log/common/log'
import type Panel from '@telegraph/services/tabs/electron-main/Panel'
import { PanelFactoryId } from '@telegraph/services/tabs/electron-main/Panel'
import type { IPanelFactory } from '@telegraph/services/tabs/electron-main/Panel'
import { DisposablePanelFactoryId } from '@telegraph/services/tabs/electron-main/DisposablePanel'
import type { IDisposablePanelFactory } from '@telegraph/services/tabs/electron-main/DisposablePanel'
import type { FileAccess } from '@telegraph/services/file-access/electron-main/FileAccess'
import { FileAccessId } from '@telegraph/services/file-access/electron-main/FileAccess'
import type { PanelStack, CreatePanelProps } from '@telegraph/services/window-manager/common/types'
import type { Workbench } from '@telegraph/services/workbench/electron-main/Workbench'
import type Pagelet from '@telegraph/services/tabs/electron-main/Pagelet'
import { buildId } from '@x-oasis/id'
import type PageletProcess from '@telegraph/services/process/pagelet-process/electron-main/PageletProcess'
import { BaseWindowLog } from '@telegraph/services/log/common/constants'
import BaseWindow from './BaseWindow'

export const BrowserWindowFactoryId = createId('browser-window-factory')
export type IBrowserWindowFactory = (option: any) => BrowserWindow

@injectable()
export class BrowserWindow extends BaseWindow {
  private workbench: Workbench

  /**
   * the last stack is appear on top !!!
   */
  private panelsStack: PanelStack[] = []

  /**
   * In order to reuse pagelet process
   */
  private cachedPageletProcessMap = new Map<string, PageletProcess>()

  private _emitter = new Emitter({ name: 'browser-window' })

  private onDidPanelCreatedEvent = this._emitter.register('on-did-panel-created')

  onDidPanelCreated = this.onDidPanelCreatedEvent.subscribe

  constructor(
    options: any,
    @inject(LogServiceId) private _logService: LogService,
    @inject(FileAccessId) private _fileAccess: FileAccess,
    @inject(PanelFactoryId) private panelFactory: IPanelFactory,
    @inject(DisposablePanelFactoryId) private disposablePanelFactory: IDisposablePanelFactory
  ) {
    const { workbench, ...rest } = options || {}
    super(rest, _logService, _fileAccess)
    this.workbench = workbench

    // 窗口关闭时清理所有 panel 和 cached pagelet process
    this.onWindowDidCloseHandler(() => {
      this.disposeAllPanels()
    })
  }

  get id() {
    return buildId('window', this.window.id)
  }

  addPagelet(props: { targetProjectName: string; projectName: string }) {
    const stack = this.panelsStack.find(stack => stack.projectName === props.targetProjectName)
    if (stack) {
      stack.panel.addPagelet({
        projectName: props.projectName,
      })
    }
  }

  getCurrentTopPanelStack() {
    const len = this.panelsStack.length
    return this.panelsStack[len - 1] || null
  }

  getCachedPageletProcess(projectName: string) {
    return this.cachedPageletProcessMap.get(projectName)
  }

  setCachedPageletProcess(projectName: string, pageletProcess: PageletProcess) {
    return this.cachedPageletProcessMap.set(projectName, pageletProcess)
  }

  deleteCachePageletProcess(projectName: string) {
    return this.cachedPageletProcessMap.delete(projectName)
  }

  public createDisposablePanel(props: CreatePanelProps) {
    const { projectName } = props
    const panel = this.disposablePanelFactory({
      projectName,
      workbench: this.workbench,
      browserWindow: this,
    })
    panel.addPagelet({ projectName })
  }

  findPagelet(pageletId: string): Pagelet | null {
    for (let idx = 0; idx < this.panelsStack.length; idx++) {
      const pagelet = this.panelsStack[idx].panel.pagelets.find(pagelet => pagelet.id === pageletId)
      if (pagelet) return pagelet
    }
    return null
  }

  killPageletProcess() {}

  private disposeAllPanels() {
    // dispose 所有 panel（会级联 dispose pagelet → removeBrowserView + destroy webContents）
    const panels = this.panelsStack.splice(0)
    for (const stack of panels) {
      stack.panel.disposePanel()
    }

    // kill 所有 cached pagelet process
    for (const [name, pageletProcess] of this.cachedPageletProcessMap) {
      pageletProcess.dispose()
    }
    this.cachedPageletProcessMap.clear()
  }

  findPageletProcess(pageletId: string) {
    const pagelet = this.findPagelet(pageletId)
    if (pagelet) return pagelet.pageletProcess
  }

  shouldStackDisposed(index: number, stackSize: number, stack: PanelStack) {
    return false
  }

  /**
   *
   * @param addedPanel new added panel
   *
   * called after panel is created and push to stack, then you can make
   * panel clean up task
   */
  onDidPanelCreatedHandler(addedPanel: PanelStack) {
    const size = this.panelsStack.length
    const copy = this.panelsStack.slice()
    this._logService.info(`${BaseWindowLog.CreatePanel}: ${addedPanel.projectName}`)
    // the recently created should not be processed.
    for (let index = 0; index < size - 1; index++) {
      const stack = copy[index]
      if (this.shouldStackDisposed(index, size, stack)) {
        stack.panel.disposePanel()
        this._logService.info(`${BaseWindowLog.DisposePanel}: ${stack.panel.projectName}`)
      }
    }

    this.onDidPanelCreatedEvent.fire(addedPanel)
  }

  removePanel(panel: Panel) {
    const index = this.panelsStack.findIndex(stack => stack.panel === panel)
    if (index !== -1) this.panelsStack.splice(index, 1)
  }

  createPanel(props: CreatePanelProps) {
    const { projectName, fullscreen } = props
    const index = this.panelsStack.findIndex(stack => stack.projectName === projectName)
    if (index !== -1) {
      const stack = this.panelsStack[index]
      if (index === this.panelsStack.length - 1) return
      const currentPanel = this.getCurrentTopPanelStack()?.panel
      this.panelsStack.splice(index, 1)
      this.panelsStack.push(stack)
      const panel = stack.panel
      panel.setToTop()
      if (currentPanel) {
        currentPanel.setToBackground()
      }
      return
    }
    const panel = this.panelFactory({
      projectName,
      workbench: this.workbench,
      browserWindow: this,
      fullscreen,
    })

    panel.addPagelet({ projectName })
    const stack = { projectName, panel }
    this.panelsStack.push(stack)

    this.onDidPanelCreatedHandler(stack)
  }

  isPanelOnTop(panel: Panel) {
    const currentPanelStack = this.getCurrentTopPanelStack()
    if (!currentPanelStack) return false
    if (currentPanelStack.panel !== panel) return false
    return true
  }
}
