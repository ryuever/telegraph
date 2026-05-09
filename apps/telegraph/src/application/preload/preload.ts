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
  DAEMON_SERVICE_PATH,
  DESIGN_SERVICE_PATH,
  MONITOR_PARTICIPANT_ID,
  MONITOR_SERVICE_PATH,
  SHARED_SERVICE_PATH,
  type IDaemonService,
  type IDesignService,
  type IMonitorService,
  type ISharedService,
  type PidTreeJson,
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

// Each utility process gets its own unbound direct channel. When the
// orchestrator sends activateConnection, the arriving MessagePort must be
// routed to the correct channel.
//
// x-oasis's `registerOrchestratorHandler` callback only receives the `port`
// — there is no payload identifying which participant the port belongs to.
// We work around this by tracking connect requests in a FIFO queue: when the
// renderer calls `requestConnect(renderer, X)`, we push `X` onto the queue;
// when the activated port arrives, we pop the next expected participantId
// and bind the port to its channel. This is safe because:
//   - Connections are initiated sequentially from the UI
//   - Each `connect()` → `activateConnection` is 1:1
const designDirectChannel = new RPCMessageChannel({ description: 'preload-design-direct' });
const sharedDirectChannel = new RPCMessageChannel({ description: 'preload-shared-direct' });
const daemonDirectChannel = new RPCMessageChannel({ description: 'preload-daemon-direct' });
const monitorDirectChannel = new RPCMessageChannel({ description: 'preload-monitor-direct' });

const participantChannels = new Map<string, RPCMessageChannel>([
  ['pagelet:design', designDirectChannel],
  ['utility:shared', sharedDirectChannel],
  ['utility:daemon', daemonDirectChannel],
  [MONITOR_PARTICIPANT_ID, monitorDirectChannel],
]);

const pendingConnectQueue: string[] = [];

function enqueueConnect(participantId: string): void {
  pendingConnectQueue.push(participantId);
}

registerOrchestratorHandler(cpChannel, (port: MessagePort) => {
  const nextId = pendingConnectQueue.shift();
  const targetChannel = nextId ? participantChannels.get(nextId) : designDirectChannel;
  if (targetChannel) {
    targetChannel.bindPort(port);
  }
});

const designProxy = new ProxyRPCClient(DESIGN_SERVICE_PATH, {
  channel: designDirectChannel,
}).createProxy() as unknown as IDesignService;

const sharedProxy = new ProxyRPCClient(SHARED_SERVICE_PATH, {
  channel: sharedDirectChannel,
}).createProxy() as unknown as ISharedService;

const daemonProxy = new ProxyRPCClient(DAEMON_SERVICE_PATH, {
  channel: daemonDirectChannel,
}).createProxy() as unknown as IDaemonService;

const monitorProxy = new ProxyRPCClient(MONITOR_SERVICE_PATH, {
  channel: monitorDirectChannel,
}).createProxy() as unknown as IMonitorService;

const designService = {
  ping(now: number): Promise<{ pong: number; serverTime: number }> {
    return designProxy.ping(now);
  },
};

const sharedService = {
  ping(now: number): Promise<{ pong: number; serverTime: number }> {
    return sharedProxy.ping(now);
  },
  getAppInfo(): Promise<{ name: string; version: string }> {
    return sharedProxy.getAppInfo();
  },
};

const daemonService = {
  ping(now: number): Promise<{ pong: number; serverTime: number }> {
    return daemonProxy.ping(now);
  },
  getProcessStatus(): Promise<{ shared: string; pagelets: string[] }> {
    return daemonProxy.getProcessStatus();
  },
  getSnapshot(): Promise<{
    timestamp: number;
    totals: { cpu: number; memory: number };
    processes: Array<{
      pid: number;
      ppid: number;
      name?: string;
      type: string;
      cpu: number;
      memory: number;
    }>;
    pidTree: PidTreeJson | null;
  }> {
    return daemonProxy.getSnapshot();
  },
};

const monitorService = {
  ping(now: number): Promise<{ pong: number; serverTime: number }> {
    return monitorProxy.ping(now);
  },
};

// ── contextBridge export ───────────────────────────────────────────────────

const api = { ipc, designService, sharedService, daemonService, monitorService, enqueueConnect };

contextBridge.exposeInMainWorld('telegraph', api);

export type TelegraphPreloadApi = typeof api;
export type TelegraphIpcRenderer = typeof ipc;
export type TelegraphDesignService = typeof designService;
export type TelegraphSharedService = typeof sharedService;
export type TelegraphDaemonService = typeof daemonService;
export type TelegraphMonitorService = typeof monitorService;
