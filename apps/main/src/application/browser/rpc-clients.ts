import { createOrchestratorClient } from '@x-oasis/async-call-rpc-electron/browser';
import { clientHost } from '@x-oasis/async-call-rpc';
import {
  MAIN_WINDOW_SERVICE_PATH,
  type IMainWindowService,
} from '@/packages/services/pagelet-host/common';

/**
 * The single OrchestratorClient instance for the main renderer.
 *
 * Owns the renderer↔preload direct + IPC channels and is the source of
 * `getProxy()` for every pagelet's service. Per-pagelet proxy accessors
 * live next to each pagelet (see `apps/<pagelet>/.../browser/getClient.ts`)
 * and pull `client` from here so they all share the same channel and
 * `clientHost` registration.
 *
 * H7 (D-008): the per-pagelet proxies that used to be eager top-level
 * `client.getProxy(...)` exports here moved out into per-app lazy
 * getters. This file now only owns the things that genuinely belong to
 * the main window scope: the OrchestratorClient itself and the
 * main-window IPC service (which is window-scoped, not pagelet-scoped).
 */
export const client = createOrchestratorClient({
  directChannelDescription: 'renderer↔preload',
  ipcChannelDescription: 'renderer↔preload:ipc',
});

export const mainWindowClient = clientHost
  .registerClient(MAIN_WINDOW_SERVICE_PATH, { channel: client.ipcChannel })
  .createProxy() as unknown as IMainWindowService;
