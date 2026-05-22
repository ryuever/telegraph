import { Container, Registry } from '@x-oasis/di'
import { REMOTE_CONTROL_PARTICIPANT_ID } from '@/apps/remote-control/application/common'
import { RENDERER_PARTICIPANT_ID } from '@/packages/services/pagelet-host/common'
import { PageletWorkerConfigId } from '@/packages/services/pagelet-host/node/PageletWorker'
import { createLogger } from '@/packages/services/log/node/logger'
import {
  RemoteControlWorker,
  RemoteControlWorkerId,
} from './RemoteControlWorker'

const logger = createLogger('remote-control')

const container = new Container()
container.load(
  new Registry((bind) => {
    bind(PageletWorkerConfigId).toConstantValue({
      selfId: REMOTE_CONTROL_PARTICIPANT_ID,
      rendererParticipantId: RENDERER_PARTICIPANT_ID,
    })
    bind(RemoteControlWorkerId).to(RemoteControlWorker)
  }),
)

const worker = container.get(RemoteControlWorkerId) as RemoteControlWorker
worker
  .boot()
  .catch((err: unknown) => { logger.error('[remote-control-worker] boot failed:', err) })
