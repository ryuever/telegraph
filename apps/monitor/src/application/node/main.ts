import { Container, Registry } from '@x-oasis/di';
import {
  MonitorPageletWorker,
  MonitorPageletWorkerId,
} from './MonitorPageletWorker';
import { PageletWorkerConfigId } from '@/packages/services/pagelet-host/node/PageletWorker';
import {
  MONITOR_PARTICIPANT_ID,
  RENDERER_PARTICIPANT_ID,
} from '@/packages/services/pagelet-host/common';
import { createLogger } from '@/packages/services/log/node/logger';

const logger = createLogger('monitor');

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
  .catch((err) => logger.error('[monitor-worker] boot failed:', err));
