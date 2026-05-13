import { createOrchestratorClient } from '@x-oasis/async-call-rpc-electron/browser';
import {
  CONNECTION_PAGELET_SERVICE_PATH,
  IConnectionPageletService,
} from '@telegraph/connection/application/common';
import {
  MONITOR_PAGELET_SERVICE_PATH,
  IMonitorPageletService,
} from '@telegraph/monitor/application/common';

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
