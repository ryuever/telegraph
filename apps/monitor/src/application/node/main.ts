import { Container, Registry } from '@x-oasis/di';
import {
  MonitorPageletWorker,
  MonitorPageletWorkerId,
} from './MonitorPageletWorker';
import { PageletWorkerConfigId } from '@telegraph/pagelet-host/node/PageletWorker';
import {
  MONITOR_PARTICIPANT_ID,
  RENDERER_PARTICIPANT_ID,
} from '@telegraph/pagelet-host/common';

const container = new Container();
container.load(
  new Registry((bind) => {
    bind(PageletWorkerConfigId).toConstantValue({
      selfId: MONITOR_PARTICIPANT_ID,
      rendererParticipantId: RENDERER_PARTICIPANT_ID,
    });
    bind(MonitorPageletWorkerId).to(MonitorPageletWorker);
  })
);

const worker = container.get(MonitorPageletWorkerId) as MonitorPageletWorker;
worker
  .boot()
  .catch((err) => console.error('[monitor-worker] boot failed:', err));
