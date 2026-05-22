import { inject, injectable } from '@x-oasis/di'
import type { IPageletProcess } from '@/packages/services/pagelet-host/electron-main/PageletProcess'
import { PageletProcessId } from '@/packages/services/pagelet-host/electron-main/PageletProcess'
import type { IRemoteControlApplication } from '@/apps/remote-control/application/common'
import { RemoteControlApplicationId, REMOTE_CONTROL_PARTICIPANT_ID } from '@/apps/remote-control/application/common'

export const REMOTE_CONTROL_WORKER_FILE = 'remote-control-worker.js'

export type { IRemoteControlApplication }
export { RemoteControlApplicationId }

@injectable()
export class RemoteControlApplication implements IRemoteControlApplication {
  constructor(
    @inject(PageletProcessId) private readonly pageletProcess: IPageletProcess,
  ) {}

  async start(): Promise<void> {
    await this.pageletProcess.spawn(
      REMOTE_CONTROL_PARTICIPANT_ID,
      REMOTE_CONTROL_WORKER_FILE,
      { displayName: 'Remote Control' },
    )
  }
}
