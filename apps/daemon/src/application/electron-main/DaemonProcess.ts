import { createId, inject, injectable } from '@x-oasis/di';
import { utilityProcess } from 'electron';
import { ElectronUtilityProcessChannel } from '@x-oasis/async-call-rpc-electron';
import { serviceHost } from '@x-oasis/async-call-rpc';
import { join } from 'path';

import type { IMainCpServer } from '@/apps/main/application/electron-main/MainCpServer';
import { MainCpServerId } from '@/apps/main/application/electron-main/MainCpServer';
import type { IPidNameRegistry } from '@/packages/services/main-metrics/common';
import { PidNameRegistryId } from '@/packages/services/main-metrics/common';
import { DAEMON_PARTICIPANT_ID } from '@/apps/daemon/application/common';

export interface IDaemonProcess {
  spawn(): Promise<void>;
}

export const DaemonProcessId = createId('DaemonProcess');

@injectable()
export class DaemonProcess implements IDaemonProcess {
  constructor(
    @inject(MainCpServerId) private readonly cpServer: IMainCpServer,
    @inject(PidNameRegistryId) private readonly pidNameRegistry: IPidNameRegistry
  ) {}

  async spawn(): Promise<void> {
    const proc = utilityProcess.fork(
      join(__dirname, '../preload/daemon-worker.js')
    );
    const channel = new ElectronUtilityProcessChannel({
      process: proc,
      description: 'main→daemon IPC channel',
    });
    channel.setServiceHost(serviceHost);

    this.cpServer
      .getOrchestrator()
      .registerParticipant(DAEMON_PARTICIPANT_ID, channel, 'utility');

    this.pidNameRegistry.register(proc, 'Daemon');

    console.log('[DaemonProcess] spawned');
  }
}
