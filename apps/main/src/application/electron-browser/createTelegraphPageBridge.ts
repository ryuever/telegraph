import { contextBridge } from 'electron';
import {
  IPCRendererChannel,
  type ContextBridgeAPI,
  type IpcRenderer,
} from '@x-oasis/async-call-rpc-electron/electron-browser/core';
import { registerOrchestratorHandler } from '@x-oasis/async-call-rpc-electron/electron-browser/orchestrator';
import { RPCMessageChannel } from '@x-oasis/async-call-rpc-web/core';
import { ORCHESTRATOR_SERVICE_PATH } from '@x-oasis/async-call-rpc/core';

const BRIDGE_KEY = '__rpc_bridge__' as const;
const IPC_BRIDGE_KEY = '__rpc_ipc_bridge__' as const;

interface IpcLikeMessage {
  data?: unknown;
  ports?: MessagePort[];
}

interface ActivationHandlerContext {
  port: MessagePort;
  connectionId?: string;
  role?: 'initiator' | 'receiver';
}

interface CreateTelegraphPageBridgeOptions {
  ipcRenderer: IpcRenderer;
  channelName: string;
  description?: string;
  serviceRoutes?: Record<string, string>;
  defaultPeerId?: string;
}

export function createTelegraphPageBridge(
  options: CreateTelegraphPageBridgeOptions
): {
  channel: RPCMessageChannel;
  ipcChannel: IPCRendererChannel;
} {
  const {
    ipcRenderer,
    channelName,
    description,
    serviceRoutes,
    defaultPeerId,
  } = options;

  const ipcChannel = new IPCRendererChannel({
    channelName,
    ipcRenderer,
    projectName: channelName,
  });

  const realChannel = new RPCMessageChannel({
    description: description ?? `page-bridge:${channelName}`,
  });

  const messageHandlers = new Set<(data: unknown) => void>();
  const ipcMessageHandlers = new Set<(data: unknown) => void>();
  const peerPortMap = new Map<string, MessagePort>();
  const servicePortMap = new Map<string, MessagePort>();
  const pendingByService = new Map<string, unknown[]>();
  const pendingDefault: unknown[] = [];

  let firstPort: MessagePort | null = null;

  const flushService = (servicePath: string, port: MessagePort): void => {
    const pending = pendingByService.get(servicePath);
    if (!pending) return;
    pendingByService.delete(servicePath);
    for (const data of pending) {
      port.postMessage(data);
    }
  };

  const flushDefault = (port: MessagePort): void => {
    const pending = pendingDefault.splice(0);
    for (const data of pending) {
      port.postMessage(data);
    }
  };

  const rememberPeerPort = (
    peerId: string | undefined,
    port: MessagePort
  ): void => {
    if (!peerId) return;
    peerPortMap.set(peerId, port);
    if (!serviceRoutes) return;
    for (const [servicePath, routePeerId] of Object.entries(serviceRoutes)) {
      if (routePeerId !== peerId) continue;
      servicePortMap.set(servicePath, port);
      flushService(servicePath, port);
    }
  };

  registerOrchestratorHandler(ipcChannel, (ctx: ActivationHandlerContext | MessagePort) => {
    const port = isActivationHandlerContext(ctx) ? ctx.port : ctx;

    const resolvedPeerId =
      isActivationHandlerContext(ctx) && typeof ctx.connectionId === 'string'
        ? resolvePeerId(ctx.connectionId)
        : undefined;

    rememberPeerPort(resolvedPeerId, port);

    const handler = (ev: MessageEvent): void => {
      const data = ev.data as unknown;
      const servicePath = getServicePath(data);
      if (servicePath) {
        servicePortMap.set(servicePath, port);
        flushService(servicePath, port);
      }
      messageHandlers.forEach((cb) => {
        cb(data);
      });
    };
    port.addEventListener('message', handler);
    port.start();

    const resolvedAsDefault =
      !defaultPeerId || (resolvedPeerId && resolvedPeerId === defaultPeerId);

    if (resolvedAsDefault) {
      firstPort = port;
      realChannel.bindPort(port, { rebind: true });
      flushDefault(port);
    }
  });

  const getDefaultPort = (): MessagePort | null => {
    if (defaultPeerId) {
      return peerPortMap.get(defaultPeerId) ?? null;
    }
    return firstPort;
  };

  const queueForService = (servicePath: string, data: unknown): void => {
    let pending = pendingByService.get(servicePath);
    if (!pending) {
      pending = [];
      pendingByService.set(servicePath, pending);
    }
    pending.push(data);
  };

  const bridge: ContextBridgeAPI = {
    _send: (data: unknown) => {
      const servicePath = getServicePath(data);
      const targetPort = servicePath ? servicePortMap.get(servicePath) : null;
      if (targetPort) {
        targetPort.postMessage(data);
        return;
      }

      if (servicePath && serviceRoutes?.[servicePath]) {
        queueForService(servicePath, data);
        return;
      }

      const defaultPort = getDefaultPort();
      if (defaultPort) {
        defaultPort.postMessage(data);
      } else {
        pendingDefault.push(data);
      }
    },
    _onMessage: (cb: (data: unknown) => void) => {
      messageHandlers.add(cb);
    },
    _offMessage: () => {
      messageHandlers.clear();
    },
  };

  const ipcBridge: ContextBridgeAPI = {
    _send: (data: unknown) => {
      ipcChannel.send(data);
    },
    _onMessage: (cb: (data: unknown) => void) => {
      ipcMessageHandlers.add(cb);
    },
    _offMessage: () => {
      ipcMessageHandlers.clear();
    },
  };

  ipcChannel.on((rawMessage: unknown) => {
    const message = isIpcLikeMessage(rawMessage) ? rawMessage : null;
    const data = message?.data ?? rawMessage;
    const ports = message?.ports ?? [];
    if (ports.length > 0) return;
    if (getServicePath(data) === ORCHESTRATOR_SERVICE_PATH) return;
    ipcMessageHandlers.forEach((cb) => {
      cb(data);
    });
  });

  contextBridge.exposeInMainWorld(BRIDGE_KEY, {
    _send: bridge._send,
    _onMessage: bridge._onMessage,
    _offMessage: bridge._offMessage,
  });
  contextBridge.exposeInMainWorld(IPC_BRIDGE_KEY, {
    _send: ipcBridge._send,
    _onMessage: ipcBridge._onMessage,
    _offMessage: ipcBridge._offMessage,
  });

  return { channel: realChannel, ipcChannel };
}

function getServicePath(data: unknown): string | undefined {
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(data) || !Array.isArray(data[0])) return undefined;
  const header = data[0];
  return typeof header[2] === 'string' ? header[2] : undefined;
}

function isActivationHandlerContext(
  value: ActivationHandlerContext | MessagePort
): value is ActivationHandlerContext {
  return 'port' in value;
}

function isIpcLikeMessage(value: unknown): value is IpcLikeMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('data' in value || 'ports' in value)
  );
}

function resolvePeerId(connectionId: string): string | undefined {
  const parts = connectionId.split('--');
  if (parts.length !== 2) return undefined;
  return parts[0] === 'renderer' ? parts[1] : parts[0];
}
