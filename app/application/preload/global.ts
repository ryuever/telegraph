import type { IpcRenderer, WebFrame } from './electronTypes'

export interface IpcMessagePort {
  acquire(responseChannel: string, nonce: string): void
}

export const telegraphGlobal = (window as any).telegraph
export const ipcRenderer: IpcRenderer = telegraphGlobal?.ipcRenderer
export const ipcMessagePort: IpcMessagePort = telegraphGlobal?.ipcMessagePort
export const webFrame: WebFrame = telegraphGlobal?.webFrame
