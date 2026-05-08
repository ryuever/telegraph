// Phase 2 — renderer-side control-plane client.
//
// Wraps `IPCRendererChannel` so the rest of the renderer doesn't need to know
// about preload bridge wiring or the cp-channel name. One channel per renderer
// process; the same channel is reused by every cp service proxy
// (inspector now, more in Phase 3+).
//
// Intentionally NOT injected through `@x-oasis/di` — the renderer doesn't
// boot a DI container in Phase 2; this module exposes a tiny module-scoped
// singleton instead. If renderer-side DI shows up later, dropping `@injectable`
// on this class is a one-line change.
import { IPCRendererChannel } from '@x-oasis/async-call-rpc-electron';
import type { IpcRenderer } from 'electron';

import {
  ORCHESTRATOR_CP_CHANNEL_NAME,
  ORCHESTRATOR_PROJECT_NAME,
} from '@telegraph/services/connection-orchestrator/common/cp-config';

let cachedChannel: IPCRendererChannel | undefined;

/**
 * Lazy-init the renderer cp channel. The preload bridge must have run before
 * the first call; we throw a loud error otherwise so the failure mode is
 * obvious during dev.
 */
export function getRendererCpChannel(): IPCRendererChannel {
  if (cachedChannel) return cachedChannel;

  // `window.telegraph` is ambient-typed as required, but at runtime the
  // preload bridge might genuinely be missing (e.g. if context isolation
  // misconfigures). Read through `unknown` so the runtime guard survives the
  // type system's optimism.
  const bridge = (window as unknown as { telegraph?: { ipc?: unknown } }).telegraph;
  const ipc = bridge?.ipc;
  if (!ipc) {
    throw new Error(
      'RendererCpClient: window.telegraph.ipc missing — preload bridge did not run',
    );
  }

  cachedChannel = new IPCRendererChannel({
    channelName: ORCHESTRATOR_CP_CHANNEL_NAME,
    // x-oasis types `ipcRenderer` as Electron's full IpcRenderer; our preload
    // bridge only exposes the subset IPCRendererChannel actually calls into
    // (`send` / `postMessage` / `on` / `removeListener` / `removeAllListeners`).
    // Cast narrowly here rather than widening the preload surface.
    ipcRenderer: ipc as unknown as IpcRenderer,
    projectName: ORCHESTRATOR_PROJECT_NAME,
    description: 'renderer-cp',
  });

  return cachedChannel;
}
