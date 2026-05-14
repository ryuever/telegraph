import { createId, inject, injectable } from '@x-oasis/di';
import {
  ElectronUtilityProcessChannel,
  UtilityProcessSupervisor,
  type SpawnInfo,
  type ChannelReadyInfo,
} from '@x-oasis/async-call-rpc-electron';
import { serviceHost } from '@x-oasis/async-call-rpc';
import { join } from 'path';

import type { IMainCpServer } from '@/apps/main/application/electron-main/MainCpServer';
import { MainCpServerId } from '@/apps/main/application/electron-main/MainCpServer';
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
  private supervisors = new Map<string, UtilityProcessSupervisor>();
  private channels = new Map<string, ElectronUtilityProcessChannel>();
  private lastPids = new Map<string, number>();

  constructor(
    @inject(MainCpServerId) private readonly cpServer: IMainCpServer,
    @inject(PidNameRegistryId) private readonly pidNameRegistry: IPidNameRegistry
  ) {}

  async spawn(
    pageletId: string,
    workerFileName: string,
    options: PageletSpawnOptions = {}
  ): Promise<void> {
    if (this.supervisors.has(pageletId)) {
      throw new Error(
        `[PageletProcess] pagelet "${pageletId}" already spawned`
      );
    }

    // The default main orchestrator + any additional orchestrators declared
    // by MainCpServer.getAdditionalOrchestratorsFor() (e.g. the setting
    // pagelet, which also belongs to the setting window's orchestrator).
    // UtilityProcessSupervisor accepts an array and registers / replaces /
    // unregisters in lock-step on every restart, which would be impossible
    // to coordinate by hand.
    const orchestrators = [
      this.cpServer.getOrchestrator(),
      ...this.cpServer.getAdditionalOrchestratorsFor(pageletId),
    ];

    const displayName =
      options.displayName ??
      pageletId.charAt(0).toUpperCase() + pageletId.slice(1);

    const supervisor = new UtilityProcessSupervisor({
      orchestrator: orchestrators,
      participantId: pageletId,
      entry: join(__dirname, `../preload/${workerFileName}`),
      role: 'utility',
      onSpawn: ({ pid, isRestart }: SpawnInfo) => {
        const lastPid = this.lastPids.get(pageletId);
        if (isRestart && lastPid !== undefined) {
          this.pidNameRegistry.unregister(lastPid);
        }
        this.pidNameRegistry.register(pid, displayName);
        this.lastPids.set(pageletId, pid);
      },
      onChannelReady: ({ channel }: ChannelReadyInfo) => {
        channel.setServiceHost(serviceHost);
        this.channels.set(pageletId, channel);
      },
      logger: (level: string, msg: string) =>
        console.log(`[PageletProcess:${pageletId}:${level}] ${msg}`),
    });

    this.supervisors.set(pageletId, supervisor);
    await supervisor.start();
    console.log(`[PageletProcess] spawned ${pageletId}`);
  }

  kill(pageletId: string): void {
    const supervisor = this.supervisors.get(pageletId);
    if (!supervisor) return;
    void supervisor.stop();
    this.supervisors.delete(pageletId);
    this.channels.delete(pageletId);
    const lastPid = this.lastPids.get(pageletId);
    if (lastPid !== undefined) {
      this.pidNameRegistry.unregister(lastPid);
      this.lastPids.delete(pageletId);
    }
  }

  getChannel(pageletId: string): ElectronUtilityProcessChannel | undefined {
    return this.channels.get(pageletId);
  }
}
