// Phase 2 — renderer-side control-plane client.
//
// Wraps `IPCRendererChannel` so the rest of the renderer doesn't need to know
// about preload bridge wiring or the cp-channel name. One channel per renderer
// process; the same channel is reused by every cp service proxy
// (inspector now, more in Phase 3+).
//
// Intentionally NOT injected through `@x-oasis/di` — the renderer doesn't
// boot a DI container in Phase 2; this module exposes a tiny module-scoped
// singleton instead.
//
// ## Channel ownership split (Phase 4)
//
// The renderer shares the same Electron IPC channel name with the preload.
// Both sides listen on the same channel:
//
//   • preload's IPCRendererChannel  — owns the `activateConnection` handler.
//     It receives the MessagePort directly (no contextBridge hop) and wires it
//     to the design direct channel (RPCMessageChannel).  The preload sends the
//     ReturnSuccess ack back to main so the orchestrator can transition to READY.
//
//   • renderer's IPCRendererChannel (this file) — used only for outgoing
//     inspector RPC (getTopology, requestConnect) and their incoming responses.
//     It MUST NOT register an activateConnection handler, because:
//       1. It cannot safely receive the MessagePort across contextBridge.
//       2. Sending "Method not found" from this channel would confuse main's
//          orchestrator (it would reject the activateParticipant deferred).
//
//     To achieve silent pass-through for any incoming requests (like
//     activateConnection), we attach an empty RPCServiceHost. The
//     handleRequest middleware skips requests whose path is not found in the
//     host — no error reply is sent.
import { IPCRendererChannel } from '@x-oasis/async-call-rpc-electron/electron-browser';
import { RPCServiceHost } from '@x-oasis/async-call-rpc';
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
 *
 * The channel is equipped with an empty `RPCServiceHost` so any incoming
 * requests that this channel does not handle (e.g. `activateConnection`,
 * which is owned by the preload) are silently ignored instead of replied
 * to with "Method not found".
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

  const channel = new IPCRendererChannel({
    channelName: ORCHESTRATOR_CP_CHANNEL_NAME,
    // x-oasis types `ipcRenderer` as Electron's full IpcRenderer; our preload
    // bridge only exposes the subset IPCRendererChannel actually calls into
    // (`send` / `postMessage` / `on` / `removeListener` / `removeAllListeners`).
    // Cast narrowly here rather than widening the preload surface.
    ipcRenderer: ipc as unknown as IpcRenderer,
    projectName: ORCHESTRATOR_PROJECT_NAME,
    description: 'renderer-cp',
  });

  // Attach an empty service host so handleRequest silently ignores any
  // incoming requests (e.g. activateConnection) whose path is not registered
  // here. Without this, the framework would emit a "Method not found" reply
  // for those requests, which would confuse main's activateParticipant deferred.
  channel.setServiceHost(new RPCServiceHost());

  cachedChannel = channel;
  return cachedChannel;
}
