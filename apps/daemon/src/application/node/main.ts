import { Container, Registry } from '@x-oasis/di';
import {
  DaemonWorker,
  DaemonWorkerId,
} from '@/apps/daemon/application/node/DaemonWorker';

const container = new Container();
container.load(
  new Registry((bind) => {
    bind(DaemonWorkerId).to(DaemonWorker);
  })
);

const worker = container.get(DaemonWorkerId) as DaemonWorker;
worker.boot();
