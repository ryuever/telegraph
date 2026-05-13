import { ipcRenderer } from 'electron';
import { createPageBridge } from '@x-oasis/async-call-rpc-electron';
import { clientHost } from '@x-oasis/async-call-rpc';

import { SETTING_PAGELET_SERVICE_PATH } from '@telegraph/setting/application/common';
import { SETTING_PARTICIPANT_ID } from '@telegraph/pagelet-host/common';

const channelName = 'setting-rpc';

const bridge = createPageBridge({
  ipcRenderer,
  channelName,
  description: `${channelName} bridge`,
  serviceRoutes: {
    [SETTING_PAGELET_SERVICE_PATH]: SETTING_PARTICIPANT_ID,
  },
  defaultPeerId: SETTING_PARTICIPANT_ID,
});

clientHost
  .registerClient(SETTING_PAGELET_SERVICE_PATH, { channel: bridge.channel })
  .createProxy();
