import type { Workbench } from '@telegraph/services/workbench/electron-main/Workbench'
import type { WebPreferences } from 'electron'
import type { BrowserWindow } from '@telegraph/services/window-manager/electron-main/BrowserWindow'
import type Panel from '../../electron-main/Panel'
import type DisposablePanel from '../../electron-main/DisposablePanel'

type Dimension = {
  x: number
  y: number
  width: number
  height: number
}

export type BrowserViewConfig = {
  projectName: string
  loadURL: string
  webPreferences: {
    preload: string
  }
  amdEntry?: string
}

export type PageletProps = {
  projectName: string
  webPreferences?: WebPreferences
  useBrowserView?: boolean
  dimension?: Dimension

  workbench: Workbench

  browserWindow: BrowserWindow

  browserViewConfig: BrowserViewConfig

  panel: Panel
}

export type DisposablePageletProps = {
  projectName: string
  webPreferences?: WebPreferences
  useBrowserView?: boolean
  dimension?: Dimension

  workbench: Workbench

  browserWindow: BrowserWindow

  browserViewConfig: BrowserViewConfig

  panel: DisposablePanel
}
