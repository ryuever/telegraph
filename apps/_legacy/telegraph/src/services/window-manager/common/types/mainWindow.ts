import type Panel from '@telegraph/services/tabs/electron-main/Panel'

export type CreatePanelProps = {
  projectName: string
  /** 当为 true 时，BrowserView 占满整个窗口（不预留侧边栏偏移） */
  fullscreen?: boolean
}

export type PanelStack = {
  projectName: string
  panel: Panel
}
