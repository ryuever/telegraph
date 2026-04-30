import type Panel from '@app/services/tabs/electron-main/Panel'

export type CreatePanelProps = {
  projectName: string
}

export type PanelStack = {
  projectName: string
  panel: Panel
}
