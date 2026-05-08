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
//
// ## Why we install the orchestrator handler eagerly
//
// race timeline (the bug this prevents):
//
//   t0  user clicks Connect
//   t1  inspector.requestConnect() builds renderer cp channel + ProxyRPCClient
//       and sends the request via ipcRenderer
//   t2  main runs OrchestratorInspectorService.requestConnect →
//       AppOrchestrator.connect → activateParticipant → main does
//       `channel.makeRequest(ORCHESTRATOR_SERVICE_PATH, 'activateConnection',
//       port)` aimed at the renderer.
//   t3  renderer receives the activateConnection request. If the renderer cp
//       channel has no `RPCService`/host bound for ORCHESTRATOR_SERVICE_PATH,
//       handleRequest synthesises a -32601 "Method not found" reply. main's
//       activateParticipant awaits that reply and rejects, which collapses
//       the entire connect promise back to `inspector.requestConnect`'s
//       caller as `Method not found`.
//
// The previous design installed the orchestrator handler lazily inside
// `awaitDirectChannelClient` (i.e. only when the renderer's *consumer* of the
// direct channel decided to wait for the proxy). That meant the very first
// Connect — clicked before any caller awaited the direct channel — always
// raced to t3 with no handler, surfacing as the intermittent "Method not
// found". Subsequent Connects worked because the lazy install ran on the
// first Ping.
//
// Eagerly installing in `getRendererCpChannel` closes the window: by the time
// any consumer (inspector proxy, direct channel waiter, anything) holds the
// channel, the orchestrator handler is already live, and any incoming
// activateConnection has somewhere to land. The handler delegates to
// `dispatchActivatedPort` so the consumer-keyed routing logic continues to
// live in `directChannelClient`.
import { IPCRendererChannel } from '@x-oasis/async-call-rpc-electron/electron-browser';
import { registerOrchestratorHandler } from '@x-oasis/async-call-rpc-electron/electron-browser';
import type { IpcRenderer } from 'electron';

import {
  ORCHESTRATOR_CP_CHANNEL_NAME,
  ORCHESTRATOR_PROJECT_NAME,
} from '@telegraph/services/connection-orchestrator/common/cp-config';

import { dispatchActivatedPort } from './directChannelClient';

let cachedChannel: IPCRendererChannel | undefined;

/**
 * Lazy-init the renderer cp channel. The preload bridge must have run before
 * the first call; we throw a loud error otherwise so the failure mode is
 * obvious during dev.
 *
 * Side-effect on first call: registers `dispatchActivatedPort` as the
 * channel's orchestrator handler. This is what makes the very first
 * `inspector.requestConnect()` race-free (see file header).
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

  // Install the orchestrator activateConnection handler eagerly. Doing this
  // *before* anyone gets a reference to the channel guarantees the handler
  // is live by the time any RPC traffic flows in either direction. The
  // handler routes the activated port into directChannelClient's pending map
  // (keyed by servicePath) so consumers see a typed proxy at the awaited
  // promise.
  registerOrchestratorHandler(channel, dispatchActivatedPort);

  cachedChannel = channel;
  return cachedChannel;
}
