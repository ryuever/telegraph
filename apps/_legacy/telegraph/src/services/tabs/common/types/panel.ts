import type { BrowserWindow } from '@telegraph/services/window-manager/electron-main/BrowserWindow'
import type { Workbench } from '@telegraph/services/workbench/electron-main/Workbench'

export type CreatePageletProps = {
  projectName: string
}

export type Dimension = {
  x: number
  y: number
  width: number
  height: number
}

export type DisposablePanelProps = {} & PanelProps

export type PanelProps = {
  projectName: string
  workbench: Workbench
  browserWindow: BrowserWindow
  /** 当为 true 时，BrowserView 占满整个窗口（不预留侧边栏偏移） */
  fullscreen?: boolean
}

export type PanelType = {
  BrowserView: 'browserView'
  Embed: 'embed'
}
