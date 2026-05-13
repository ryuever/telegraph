import { Container, Registry } from '@x-oasis/di';
import { ConnectionWorker, ConnectionWorkerId } from './ConnectionWorker';
import { PageletWorkerConfigId } from '@telegraph/pagelet-host/node/PageletWorker';
import { CONNECTION_PARTICIPANT_ID } from '@telegraph/pagelet-host/common';

const SELF_ID = CONNECTION_PARTICIPANT_ID;
const RENDERER_ID = 'renderer';

const container = new Container();
container.load(
  new Registry((bind) => {
    bind(PageletWorkerConfigId).toConstantValue({
      selfId: SELF_ID,
      rendererParticipantId: RENDERER_ID,
    });
    bind(ConnectionWorkerId).to(ConnectionWorker);
  })
);

const worker = container.get(ConnectionWorkerId) as ConnectionWorker;
worker
  .boot()
  .catch((err) => console.error(`[${SELF_ID}-worker] boot failed:`, err));
