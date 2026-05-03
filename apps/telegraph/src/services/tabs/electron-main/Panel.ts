import { Disposable } from '@x-oasis/disposable'
import { Emitter } from '@x-oasis/emitter'
import { toDisposable } from '@x-oasis/disposable'
import { injectable, createId, inject } from '@x-oasis/di'
import type { Workbench } from '@telegraph/services/workbench/electron-main/Workbench'
import type { LogService } from '@telegraph/services/log/common/log'
import { LogServiceId } from '@telegraph/services/log/common/log'
import type { BrowserWindow } from '@telegraph/services/window-manager/electron-main/BrowserWindow'

import type { Event as ElectronEvent, Rectangle } from 'electron'
import { buildId } from '@x-oasis/id'
import { PanelLog } from '@telegraph/services/log/common/constants'
import type { Dimension, PanelProps, CreatePageletProps } from '../common/types'
import { PageletFactoryId } from './Pagelet'
import type { IPageletFactory } from './Pagelet'
import type Pagelet from './Pagelet'

export const PanelFactoryId = createId('panel-factory')
export type IPanelFactory = (props: PanelProps) => Panel

@injectable()
export default class Panel extends Disposable {
  private _id: string

  private _browserWindow: BrowserWindow

  private _projectName: string

  private _dimension: Dimension

  private _workbench: Workbench

  private _pagelets: Pagelet[] = []

  // panel位置，侧边栏200px
  private _panelPos = {
    left: 76,
    top: 0,
  }

  private emitter = new Emitter({ name: 'panel' })

  private onWillCreateEvent = this.emitter.register('on-will-create')

  onWillCreate = this.onWillCreateEvent.subscribe

  private onDidCreatedEvent = this.emitter.register('on-did-create')

  onDidCreated = this.onDidCreatedEvent.subscribe

  private onDidFinishLoadEvent = this.emitter.register('on-did-finish-load')

  onDidFinishLoad = this.onDidFinishLoadEvent.subscribe

  private onDoSetToBackgroundEvent = this.emitter.register('on-do-set-to-background')

  onDoSetToBackground = this.onDoSetToBackgroundEvent.subscribe

  private onWillSetToTopEvent = this.emitter.register('on-will-set-to-top')

  onWillSetToTop = this.onWillSetToTopEvent.subscribe

  private onDidSetToTopEvent = this.emitter.register('on-did-set-to-top')

  onDidSetToTop = this.onDidSetToTopEvent.subscribe

  private onWillDisposeEvent = this.emitter.register('on-will-dispose')

  onWillDispose = this.onWillDisposeEvent.subscribe

  private onDidDisposedEvent = this.emitter.register('on-did-disposed')

  onDidDisposed = this.onDidDisposedEvent.subscribe

  constructor(
    props: PanelProps,
    @inject(LogServiceId) private logService: LogService,
    @inject(PageletFactoryId) private pageletFactory: IPageletFactory
  ) {
    super()
    this._workbench = props.workbench
    this._projectName = props.projectName
    this._browserWindow = props.browserWindow
    this._id = `${this._browserWindow.id}_${buildId('panel', this.projectName)}`

    const [width, height] = this.window.getContentSize()

    this._dimension = this.resolveDimension({
      width,
      height,
    })

    this.registerDisposable(
      toDisposable(() => {
        this._pagelets.forEach(pagelet => pagelet.disposePagelet())

        /**
         * remove panel from stack
         */
        this._browserWindow.removePanel(this)
      })
    )

    this.registerDisposable(
      this._browserWindow.onWillWindowResize((e: ElectronEvent, bounds: Rectangle) => {
        this._dimension = this.resolveDimension({
          width: bounds.width,
          height: bounds.height,
        })
        this.updatePageletDimension()
      })
    )
  }

  get id() {
    return this._id
  }

  get window() {
    return this._browserWindow.window
  }

  get projectName() {
    return this._projectName
  }

  get pagelets() {
    return this._pagelets
  }

  isOnTop() {
    return this._browserWindow.isPanelOnTop(this)
  }

  resolveDimension(newWindowSize: { width: number; height: number }) {
    const x = this._panelPos.left
    const y = this._panelPos.top

    return {
      x,
      y,
      width: newWindowSize.width - x,
      height: newWindowSize.height - y,
    }
  }

  setToTop() {
    this.logService.info(`${this.projectName} ${PanelLog.PanelToTop}`)
    this.onWillSetToTopEvent.fire()
    this._pagelets.forEach(pagelet => pagelet.setToTop())
    this.onDidSetToTopEvent.fire()
  }

  setToBackground() {
    this.logService.info(`${this.projectName} ${PanelLog.PanelToBackground}`)
    this.onDoSetToBackgroundEvent.fire()
  }

  addPagelet(props: CreatePageletProps) {
    const projectName = props.projectName as any
    const config = this._workbench.getPageletConfig(projectName)

    if (config) {
      const pagelet = this.pageletFactory({
        workbench: this._workbench,
        browserWindow: this._browserWindow,
        dimension: this._dimension,
        projectName,
        browserViewConfig: config,
        panel: this,
      })

      this._pagelets.push(pagelet)
      this.updatePageletDimension()
    }
  }

  disposePanel() {
    this.onWillDisposeEvent.fire()
    this.dispose()
    this.onDidDisposedEvent.fire()
  }

  removePagelet(pagelet: Pagelet) {
    const index = this._pagelets.findIndex(_p => _p === pagelet)
    if (index !== -1) this._pagelets.splice(index, 1)

    this.updatePageletDimension()
  }

  updatePageletDimension() {
    const len = this._pagelets.length
    const width = this._dimension.width / len

    this._pagelets.reduce((dimension, pagelet, index) => {
      const nextDimension = {
        ...dimension,
        x: dimension.x + width * index,
        width,
      }

      pagelet.setBounds(nextDimension)

      return nextDimension
    }, this._dimension)
  }
}
