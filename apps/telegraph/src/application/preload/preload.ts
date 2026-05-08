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
//
// ## Phase 4 — design direct channel
//
// The activated `MessagePort` from `activateConnection` cannot safely cross
// the contextBridge boundary (Electron's structured-clone does not transfer
// `MessagePort` objects through the bridge). All port handling MUST therefore
// live here in the preload, where `ipcRenderer` is available without isolation.
//
// Pattern (mirrors x-oasis example renderer-acquire-utility-port-orchestrator):
//   1. Create `IPCRendererChannel` directly with `ipcRenderer`.
//   2. Create a `RPCMessageChannel` (unbound, disconnected state).
//   3. Register `registerOrchestratorHandler` on the cp channel — when the
//      orchestrator sends `activateConnection`, `bindPort` wires the arriving
//      `MessagePort` to the direct channel.
//   4. Create `ProxyRPCClient<IDesignService>` on the direct channel.
//   5. Expose `window.telegraph.designService.ping(now)` via contextBridge so
//      the renderer can call it without ever touching a port directly.
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IPCRendererChannel,
  registerOrchestratorHandler,
} from '@x-oasis/async-call-rpc-electron/electron-browser';
import { RPCMessageChannel } from '@x-oasis/async-call-rpc-web';
import { ProxyRPCClient } from '@x-oasis/async-call-rpc';

import {
  ORCHESTRATOR_CP_CHANNEL_NAME,
  ORCHESTRATOR_PROJECT_NAME,
} from '@telegraph/services/connection-orchestrator/common/cp-config';
import {
  DESIGN_SERVICE_PATH,
  type IDesignService,
} from '@telegraph/services/connection-orchestrator/common/types';

// ── IPC bridge (for inspector RPC from renderer) ───────────────────────────

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

// ── Direct channel setup (preload-owned, port stays here) ──────────────────

// Create the cp channel with the real ipcRenderer — no bridge indirection.
const cpChannel = new IPCRendererChannel({
  channelName: ORCHESTRATOR_CP_CHANNEL_NAME,
  ipcRenderer,
  projectName: ORCHESTRATOR_PROJECT_NAME,
  description: 'preload-cp',
});

// Unbound direct channel — port will be wired when activateConnection fires.
const designDirectChannel = new RPCMessageChannel({
  description: 'preload-design-direct',
});

// Register the orchestrator handler. When main calls activateConnection and
// transfers the MessagePort to this renderer, the handler runs here in the
// preload context where the native MessagePort is accessible. We bind it
// directly to designDirectChannel — no contextBridge hop, no structured-clone
// stripping.
registerOrchestratorHandler(cpChannel, (port: MessagePort) => {
  designDirectChannel.bindPort(port);
});

// Build the typed proxy. ProxyRPCClient queues outgoing calls while the
// channel is disconnected (before bindPort), so callers don't need to await
// "channel ready" themselves — the pending send queue will drain on bindPort.
const designProxy = new ProxyRPCClient(DESIGN_SERVICE_PATH, {
  channel: designDirectChannel,
}).createProxy() as unknown as IDesignService;

// Expose a plain-data surface for the renderer.  contextBridge can safely
// transfer primitives and Promises of primitives/plain-objects, which is all
// `ping` needs.
const designService = {
  ping(now: number): Promise<{ pong: number; serverTime: number }> {
    return designProxy.ping(now);
  },
};

// ── contextBridge export ───────────────────────────────────────────────────

const api = { ipc, designService };

contextBridge.exposeInMainWorld('telegraph', api);

export type TelegraphPreloadApi = typeof api;
export type TelegraphIpcRenderer = typeof ipc;
export type TelegraphDesignService = typeof designService;
