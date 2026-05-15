import { Container, Registry } from '@x-oasis/di';
import {
  DesignPageletWorker,
  DesignPageletWorkerId,
} from './DesignPageletWorker';
import { PageletWorkerConfigId } from '@/packages/services/pagelet-host/node/PageletWorker';
import {
  DESIGN_PARTICIPANT_ID,
  RENDERER_PARTICIPANT_ID,
} from '@/packages/services/pagelet-host/common';
import { createLogger } from '@/packages/services/log/node/logger';

const logger = createLogger('design');

const container = new Container();
container.load(
  new Registry((bind) => {
    bind(PageletWorkerConfigId).toConstantValue({
      selfId: DESIGN_PARTICIPANT_ID,
      rendererParticipantId: RENDERER_PARTICIPANT_ID,
    });
    bind(DesignPageletWorkerId).to(DesignPageletWorker);
  })
);

const worker = container.get(DesignPageletWorkerId) as DesignPageletWorker;
worker
  .boot()
  .catch((err: unknown) => { logger.error('[design-worker] boot failed:', err); });
