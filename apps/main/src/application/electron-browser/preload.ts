import { ipcRenderer } from 'electron';
import { createPageBridge } from '@x-oasis/async-call-rpc-electron';
import { clientHost } from '@x-oasis/async-call-rpc';

import { ORCHESTRATOR_CP_CHANNEL_NAME } from '@/apps/main/application/common/cp-config';
import {
  CONNECTION_PARTICIPANT_ID,
  MONITOR_PARTICIPANT_ID,
  DESIGN_PARTICIPANT_ID,
  CHAT_PARTICIPANT_ID,
  MAIN_WINDOW_SERVICE_PATH,
} from '@/packages/services/pagelet-host/common';
import { CONNECTION_PAGELET_SERVICE_PATH } from '@/apps/connection/application/common';
import { MONITOR_PAGELET_SERVICE_PATH } from '@/apps/monitor/application/common';
import { DESIGN_PAGELET_SERVICE_PATH } from '@/apps/design/application/common';
import { CHAT_PAGELET_SERVICE_PATH } from '@/apps/chat/application/common';

const channelName = ORCHESTRATOR_CP_CHANNEL_NAME;

const bridge = createPageBridge({
  ipcRenderer,
  channelName,
  description: `${channelName} bridge`,
  serviceRoutes: {
    [CONNECTION_PAGELET_SERVICE_PATH]: CONNECTION_PARTICIPANT_ID,
    [MONITOR_PAGELET_SERVICE_PATH]: MONITOR_PARTICIPANT_ID,
    [DESIGN_PAGELET_SERVICE_PATH]: DESIGN_PARTICIPANT_ID,
    [CHAT_PAGELET_SERVICE_PATH]: CHAT_PARTICIPANT_ID,
  },
  defaultPeerId: CONNECTION_PARTICIPANT_ID,
});

clientHost
  .registerClient(CONNECTION_PAGELET_SERVICE_PATH, { channel: bridge.channel })
  .createProxy();

clientHost
  .registerClient(MAIN_WINDOW_SERVICE_PATH, { channel: bridge.ipcChannel })
  .createProxy();
