import { createOrchestratorClient } from '@x-oasis/async-call-rpc-electron/browser';
import { clientHost } from '@x-oasis/async-call-rpc';
import {
  CONNECTION_PAGELET_SERVICE_PATH,
  IConnectionPageletService,
} from '@telegraph/connection/application/common';
import {
  MONITOR_PAGELET_SERVICE_PATH,
  IMonitorPageletService,
} from '@telegraph/monitor/application/common';
import {
  DESIGN_PAGELET_SERVICE_PATH,
  IDesignPageletService,
} from '@telegraph/design/application/common';
import {
  CHAT_PAGELET_SERVICE_PATH,
  IChatPageletService,
} from '@telegraph/chat/application/common';
import {
  MAIN_WINDOW_SERVICE_PATH,
  type IMainWindowService,
} from '@telegraph/pagelet-host/common';

export const client = createOrchestratorClient({
  directChannelDescription: 'renderer↔preload',
  ipcChannelDescription: 'renderer↔preload:ipc',
});

export const connectionPageletClient = client.getProxy(
  CONNECTION_PAGELET_SERVICE_PATH
) as unknown as IConnectionPageletService;

export const monitorPageletClient = client.getProxy(
  MONITOR_PAGELET_SERVICE_PATH
) as unknown as IMonitorPageletService;

export const designPageletClient = client.getProxy(
  DESIGN_PAGELET_SERVICE_PATH
) as unknown as IDesignPageletService;

export const chatPageletClient = client.getProxy(
  CHAT_PAGELET_SERVICE_PATH
) as unknown as IChatPageletService;

export const mainWindowClient = clientHost
  .registerClient(MAIN_WINDOW_SERVICE_PATH, { channel: client.ipcChannel })
  .createProxy() as unknown as IMainWindowService;
