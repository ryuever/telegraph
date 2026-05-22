import { inject, injectable } from '@x-oasis/di'
import type { IPageletProcess } from '@/packages/services/pagelet-host/electron-main/PageletProcess'
import { PageletProcessId } from '@/packages/services/pagelet-host/electron-main/PageletProcess'
import type { ICliGatewayApplication } from '@/apps/cli-gateway/application/common'
import { CliGatewayApplicationId, CLI_GATEWAY_PARTICIPANT_ID } from '@/apps/cli-gateway/application/common'

export const CLI_GATEWAY_WORKER_FILE = 'cli-gateway-worker.js'

export type { ICliGatewayApplication }
export { CliGatewayApplicationId }

@injectable()
export class CliGatewayApplication implements ICliGatewayApplication {
  constructor(
    @inject(PageletProcessId) private readonly pageletProcess: IPageletProcess,
  ) {}

  async start(): Promise<void> {
    await this.pageletProcess.spawn(
      CLI_GATEWAY_PARTICIPANT_ID,
      CLI_GATEWAY_WORKER_FILE,
      { displayName: 'CLI Gateway' },
    )
  }
}
