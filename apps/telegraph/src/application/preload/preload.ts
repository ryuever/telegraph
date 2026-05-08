// Phase 1 — minimal preload: exposes a tiny ipcRenderer wrapper on
// `window.telegraph`. Phase 2+ will mount the renderer cp client through this
// same surface.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const api = {
  ipc: {
    send(channel: string, ...args: unknown[]): void {
      ipcRenderer.send(channel, ...args);
    },
    invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
      return ipcRenderer.invoke(channel, ...args) as Promise<T>;
    },
    on(
      channel: string,
      listener: (event: IpcRendererEvent, ...args: unknown[]) => void,
    ): () => void {
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
  },
};

contextBridge.exposeInMainWorld('telegraph', api);

export type TelegraphPreloadApi = typeof api;
