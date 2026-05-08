import type { PromisifyService } from '@telegraph/services/types'

export type IWorkbenchProsify = PromisifyService<IWorkbench>

export interface IWorkbench {
  loadAppURL: () => void
  createPanel: (props: { windowId?: string; projectName: string }) => void
}
