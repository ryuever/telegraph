import { Container, Registry } from '@x-oasis/di';
import {
  DesignPageletWorker,
  DesignPageletWorkerId,
} from './DesignPageletWorker';
import { PageletWorkerConfigId } from '@telegraph/pagelet-host/node/PageletWorker';
import {
  DESIGN_PARTICIPANT_ID,
  RENDERER_PARTICIPANT_ID,
} from '@telegraph/pagelet-host/common';

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
  .catch((err) => console.error('[design-worker] boot failed:', err));
