import { createId, inject, injectable } from '@x-oasis/di';
import { utilityProcess } from 'electron';
import { ElectronUtilityProcessChannel } from '@x-oasis/async-call-rpc-electron';
import { serviceHost } from '@x-oasis/async-call-rpc';
import { join } from 'path';

import type { IMainCpServer } from '@telegraph/main/application/electron-main/MainCpServer';
import { MainCpServerId } from '@telegraph/main/application/electron-main/MainCpServer';
import type { IPidNameRegistry } from '@telegraph/main-metrics/common';
import { PidNameRegistryId } from '@telegraph/main-metrics/common';
import { SHARED_PARTICIPANT_ID } from '@telegraph/shared/application/common';

export interface ISharedProcess {
  spawn(): Promise<void>;
}

export const SharedProcessId = createId('SharedProcess');

@injectable()
export class SharedProcess implements ISharedProcess {
  constructor(
    @inject(MainCpServerId) private readonly cpServer: IMainCpServer,
    @inject(PidNameRegistryId) private readonly pidNameRegistry: IPidNameRegistry
  ) {}

  async spawn(): Promise<void> {
    const proc = utilityProcess.fork(
      join(__dirname, '../preload/shared-worker.js')
    );
    const channel = new ElectronUtilityProcessChannel({
      process: proc,
      description: 'main→shared IPC channel',
    });
    channel.setServiceHost(serviceHost);

    this.cpServer
      .getOrchestrator()
      .registerParticipant(SHARED_PARTICIPANT_ID, channel, 'utility');

    this.pidNameRegistry.register(proc, 'Shared');

    console.log('[SharedProcess] spawned');
  }
}
