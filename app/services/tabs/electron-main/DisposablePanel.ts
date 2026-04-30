import { Disposable } from '@x-oasis/disposable'
import { BrowserView } from 'electron'
import { Emitter } from '@x-oasis/emitter'
import { injectable, createId, inject } from '@x-oasis/di'
import { FileAccessId } from '@app/services/file-access/electron-main/FileAccess'
import type { FileAccess } from '@app/services/file-access/electron-main/FileAccess'
import { DisposablePageletFactoryId } from '@app/services/tabs/electron-main/DisposablePagelet'
import type DisposablePagelet from '@app/services/tabs/electron-main/DisposablePagelet'

import type { IDisposablePageletFactory } from '@app/services/tabs/electron-main/DisposablePagelet'

import type { BrowserWindow } from '@app/services/window-manager/electron-main/BrowserWindow'
import type { Workbench } from '@app/services/workbench/electron-main/Workbench'
import { buildId } from '@x-oasis/id'
import type { Dimension, DisposablePanelProps, CreatePageletProps } from '../common/types'

export const DisposablePanelFactoryId = createId('disposable-panel-factory')
export type IDisposablePanelFactory = (props: DisposablePanelProps) => DisposablePanel

@injectable()
export default class DisposablePanel extends Disposable {
  private _id: string

  private _browserWindow: BrowserWindow

  private _projectName: string

  private _dimension: Dimension

  private _workbench: Workbench

  protected _pagelet: DisposablePagelet

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

  constructor(
    props: DisposablePanelProps,
    @inject(FileAccessId) private fileAccess: FileAccess,
    @inject(DisposablePageletFactoryId) private disposablePageletFactory: IDisposablePageletFactory
  ) {
    super()
    this._browserWindow = props.browserWindow

    this._workbench = props.workbench

    this._projectName = props.projectName

    this._id = `${this._browserWindow.id}_${buildId('disposable-panel', this.projectName)}`

    const [width, height] = this.window.getSize()

    this._dimension = {
      x: 0,
      y: 0,
      width,
      height,
    }
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

  createPanel() {
    const view = new BrowserView()
    view.setBounds(this._dimension)
    this.window.addBrowserView(view)
  }

  addPagelet(props: CreatePageletProps) {
    const projectName = props.projectName
    const config = {
      projectName,
      webPreferences: {
        preload: this.fileAccess.asFileUri('@build/preload.js').fsPath,
      },
      loadURL: '/explorer',
    }
    if (config) {
      this._pagelet = this.disposablePageletFactory({
        dimension: this._dimension,
        projectName,
        browserViewConfig: config,
        panel: this,
        workbench: this._workbench,
        browserWindow: this._browserWindow,
      })
    }
  }
}
