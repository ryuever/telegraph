import { createId, inject, injectable } from '@x-oasis/di';
import { utilityProcess } from 'electron';
import { ElectronUtilityProcessChannel } from '@x-oasis/async-call-rpc-electron';
import { serviceHost } from '@x-oasis/async-call-rpc';
import { join } from 'path';

import type {
  IMainCpServer,
} from '@telegraph/main/application/electron-main/MainCpServer';
import {
  MainCpServerId,
} from '@telegraph/main/application/electron-main/MainCpServer';
import { pidNameRegistry } from '@telegraph/main-metrics/electron-main/pidNameRegistry';

export interface IPageletProcess {
  spawn(pageletId: string, workerFileName: string): Promise<void>;
  kill(pageletId: string): void;
  getChannel(pageletId: string): ElectronUtilityProcessChannel | undefined;
}

export const PageletProcessId = createId('PageletProcess');

const PAGELET_NAMES: Record<string, string> = {
  connection: 'Connection',
  monitor: 'Monitor',
  setting: 'Setting',
  design: 'Design',
};

@injectable()
export class PageletProcess implements IPageletProcess {
  private processes = new Map<string, Electron.UtilityProcess>();
  private channels = new Map<string, ElectronUtilityProcessChannel>();

  constructor(
    @inject(MainCpServerId) private readonly cpServer: IMainCpServer
  ) {}

  async spawn(pageletId: string, workerFileName: string): Promise<void> {
    const proc = utilityProcess.fork(
      join(__dirname, `../preload/${workerFileName}`)
    );
    const channel = new ElectronUtilityProcessChannel({
      process: proc,
      description: `main→${pageletId} IPC channel`,
    });
    channel.setServiceHost(serviceHost);

    this.processes.set(pageletId, proc);
    this.channels.set(pageletId, channel);

    if (pageletId === 'setting') {
      this.cpServer
        .getOrchestrator()
        .registerParticipant(pageletId, channel, 'utility');
      this.cpServer
        .getSettingOrchestrator()
        .registerParticipant(pageletId, channel, 'utility');
    } else {
      this.cpServer
        .getOrchestrator()
        .registerParticipant(pageletId, channel, 'utility');
    }

    pidNameRegistry.register(proc, PAGELET_NAMES[pageletId] || pageletId);

    console.log(`[PageletProcess] spawned ${pageletId}`);
  }

  kill(pageletId: string): void {
    this.processes.get(pageletId)?.kill();
  }

  getChannel(pageletId: string): ElectronUtilityProcessChannel | undefined {
    return this.channels.get(pageletId);
  }
}
