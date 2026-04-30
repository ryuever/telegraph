import type { IpcRenderer, WebFrame } from './electronTypes'

export interface IpcMessagePort {
  acquire(responseChannel: string, nonce: string): void
}

export const redcityGlobal = (window as any).redcity
export const ipcRenderer: IpcRenderer = redcityGlobal?.ipcRenderer
export const ipcMessagePort: IpcMessagePort = redcityGlobal?.ipcMessagePort
export const webFrame: WebFrame = redcityGlobal?.webFrame
