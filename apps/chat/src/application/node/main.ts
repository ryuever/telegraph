import { Container, Registry } from '@x-oasis/di';
import {
  ChatPageletWorker,
  ChatPageletWorkerId,
} from './ChatPageletWorker';
import { PageletWorkerConfigId } from '@/packages/services/pagelet-host/node/PageletWorker';
import {
  CHAT_PARTICIPANT_ID,
  RENDERER_PARTICIPANT_ID,
} from '@/packages/services/pagelet-host/common';

const container = new Container();
container.load(
  new Registry((bind) => {
    bind(PageletWorkerConfigId).toConstantValue({
      selfId: CHAT_PARTICIPANT_ID,
      rendererParticipantId: RENDERER_PARTICIPANT_ID,
    });
    bind(ChatPageletWorkerId).to(ChatPageletWorker);
  })
);

const worker = container.get(ChatPageletWorkerId) as ChatPageletWorker;
worker
  .boot()
  .catch((err) => console.error('[chat-worker] boot failed:', err));
