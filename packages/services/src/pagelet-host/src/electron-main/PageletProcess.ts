import { createId, inject, injectable } from '@x-oasis/di';
import { utilityProcess } from 'electron';
import { ElectronUtilityProcessChannel } from '@x-oasis/async-call-rpc-electron';
import { serviceHost } from '@x-oasis/async-call-rpc';
import { join } from 'path';

import type {
  IMainCpServer,
} from '@/apps/main/application/electron-main/MainCpServer';
import {
  MainCpServerId,
} from '@/apps/main/application/electron-main/MainCpServer';
import type { IPidNameRegistry } from '@/packages/services/main-metrics/common';
import { PidNameRegistryId } from '@/packages/services/main-metrics/common';

/**
 * Optional spawn-time metadata for a pagelet utility process.
 *
 * Today only `displayName` is consumed (by the metrics PidNameRegistry).
 * `additionalOrchestrators` is reserved as the explicit alternative to the
 * `MainCpServer.getAdditionalOrchestratorsFor()` host-side hook — see the
 * follow-up note in `codebase-wiki/discussion/20260514-x-oasis-capability-gaps-v2.md`
 * §"PageletProcess manifest".
 */
export interface PageletSpawnOptions {
  /** Human-readable name reported to PidNameRegistry. Falls back to capitalised pageletId. */
  displayName?: string;
}

export interface IPageletProcess {
  spawn(
    pageletId: string,
    workerFileName: string,
    options?: PageletSpawnOptions
  ): Promise<void>;
  kill(pageletId: string): void;
  getChannel(pageletId: string): ElectronUtilityProcessChannel | undefined;
}

export const PageletProcessId = createId('PageletProcess');

@injectable()
export class PageletProcess implements IPageletProcess {
  private processes = new Map<string, Electron.UtilityProcess>();
  private channels = new Map<string, ElectronUtilityProcessChannel>();

  constructor(
    @inject(MainCpServerId) private readonly cpServer: IMainCpServer,
    @inject(PidNameRegistryId) private readonly pidNameRegistry: IPidNameRegistry
  ) {}

  async spawn(
    pageletId: string,
    workerFileName: string,
    options: PageletSpawnOptions = {}
  ): Promise<void> {
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

    // Register on the default main orchestrator + any additional orchestrators
    // declared by MainCpServer.getAdditionalOrchestratorsFor(). This replaces
    // the prior `if (pageletId === 'setting')` hardcode in this file.
    const orchestrators = [
      this.cpServer.getOrchestrator(),
      ...this.cpServer.getAdditionalOrchestratorsFor(pageletId),
    ];
    for (const orch of orchestrators) {
      orch.registerParticipant(pageletId, channel, 'utility');
    }

    const displayName =
      options.displayName ??
      pageletId.charAt(0).toUpperCase() + pageletId.slice(1);
    this.pidNameRegistry.register(proc, displayName);

    console.log(`[PageletProcess] spawned ${pageletId}`);
  }

  kill(pageletId: string): void {
    this.processes.get(pageletId)?.kill();
  }

  getChannel(pageletId: string): ElectronUtilityProcessChannel | undefined {
    return this.channels.get(pageletId);
  }
}
