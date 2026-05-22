import { Container, Registry } from '@x-oasis/di'
import {
  CLI_GATEWAY_PARTICIPANT_ID,
} from '@/apps/cli-gateway/application/common'
import {
  RENDERER_PARTICIPANT_ID,
} from '@/packages/services/pagelet-host/common'
import { PageletWorkerConfigId } from '@/packages/services/pagelet-host/node/PageletWorker'
import { createLogger } from '@/packages/services/log/node/logger'
import {
  CliGatewayWorker,
  CliGatewayWorkerId,
} from './CliGatewayWorker'

const logger = createLogger('cli-gateway')

const container = new Container()
container.load(
  new Registry((bind) => {
    bind(PageletWorkerConfigId).toConstantValue({
      selfId: CLI_GATEWAY_PARTICIPANT_ID,
      rendererParticipantId: RENDERER_PARTICIPANT_ID,
    })
    bind(CliGatewayWorkerId).to(CliGatewayWorker)
  }),
)

const worker = container.get(CliGatewayWorkerId) as CliGatewayWorker
worker
  .boot()
  .catch((err: unknown) => { logger.error('[cli-gateway-worker] boot failed:', err) })
