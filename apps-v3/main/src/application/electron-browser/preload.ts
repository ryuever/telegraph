import { ipcRenderer, contextBridge } from 'electron';
import { createPageBridge } from '@x-oasis/async-call-rpc-electron';
import { clientHost } from '@x-oasis/async-call-rpc';

import { ORCHESTRATOR_CP_CHANNEL_NAME } from '@telegraph/main/application/common/cp-config';
import {
  CONNECTION_PARTICIPANT_ID,
  MONITOR_PARTICIPANT_ID,
  DESIGN_PARTICIPANT_ID,
  CHAT_PARTICIPANT_ID,
} from '@telegraph/pagelet-host/common';
import { CONNECTION_PAGELET_SERVICE_PATH } from '@telegraph/connection/application/common';
import { MONITOR_PAGELET_SERVICE_PATH } from '@telegraph/monitor/application/common';
import { DESIGN_PAGELET_SERVICE_PATH } from '@telegraph/design/application/common';
import { CHAT_PAGELET_SERVICE_PATH } from '@telegraph/chat/application/common';

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

contextBridge.exposeInMainWorld('electronAPI', {
  openSettingWindow: () => ipcRenderer.invoke('open-setting-window'),
  onSwitchPage: (callback: (pageId: string) => void) => {
    ipcRenderer.on('switch-page', (_event, pageId: string) => {
      callback(pageId);
    });
  },
});
