// Phase 2 — preload bridge.
//
// Exposes an `ipcRenderer`-shaped object on `window.telegraph.ipc` that the
// renderer-side `IPCRendererChannel` consumes verbatim. Method signatures must
// match the subset that `@x-oasis/async-call-rpc-electron`'s
// `IPCRendererChannel` calls into:
//
//   - `send(channel, data)`
//   - `postMessage(channel, data, transfer?)`     ← needed for Transferable
//   - `on(channel, listener)`                     ← listener is (event, ...args)
//   - `removeListener(channel, listener)`
//   - `removeAllListeners(channel)`
//
// We don't proxy `invoke`/`sendSync` etc — orchestrator only needs the
// async message-passing surface above.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

type IpcListener = (event: IpcRendererEvent, ...args: unknown[]) => void;

const ipc = {
  send(channel: string, ...args: unknown[]): void {
    ipcRenderer.send(channel, ...args);
  },
  postMessage(channel: string, message: unknown, transfer?: MessagePort[]): void {
    ipcRenderer.postMessage(channel, message, transfer);
  },
  on(channel: string, listener: IpcListener): void {
    ipcRenderer.on(channel, listener);
  },
  removeListener(channel: string, listener: IpcListener): void {
    ipcRenderer.removeListener(channel, listener);
  },
  removeAllListeners(channel: string): void {
    ipcRenderer.removeAllListeners(channel);
  },
};

const api = { ipc };

contextBridge.exposeInMainWorld('telegraph', api);

export type TelegraphPreloadApi = typeof api;
export type TelegraphIpcRenderer = typeof ipc;
