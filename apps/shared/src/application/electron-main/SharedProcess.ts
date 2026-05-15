import { inject, injectable } from '@x-oasis/di';
import {
  UtilityProcessSupervisor,
  type SpawnInfo,
  type ChannelReadyInfo,
} from '@x-oasis/async-call-rpc-electron';
import {
  ExponentialBackoffPolicy,
  serviceHost,
} from '@x-oasis/async-call-rpc';
import { join } from 'path';

import type { IMainCpServer } from '@/packages/services/pagelet-host/electron-main/IMainCpServer';
import { MainCpServerId } from '@/packages/services/pagelet-host/electron-main/IMainCpServer';
import type {
  IPidNameRegistry,
  SupervisorInspectorSnapshot,
} from '@/packages/services/main-metrics/common';
import { PidNameRegistryId } from '@/packages/services/main-metrics/common';
import { LogServiceId } from '@/packages/services/log/common/LogService';
import type { ILogger } from '@/packages/services/log/common/types';
import { SHARED_PARTICIPANT_ID } from '@/apps/shared/application/common';
import type { ISharedProcess } from '@/apps/shared/application/common';
import { SharedProcessId } from '@/apps/shared/application/common';

export type { ISharedProcess };
export { SharedProcessId };

@injectable()
export class SharedProcess implements ISharedProcess {
  private supervisor: UtilityProcessSupervisor | null = null;
  private lastPid: number | null = null;
  private readonly pendingStateChangeListeners = new Set<() => void>();

  constructor(
    @inject(MainCpServerId) private readonly cpServer: IMainCpServer,
    @inject(PidNameRegistryId) private readonly pidNameRegistry: IPidNameRegistry,
    @inject(LogServiceId) private readonly logger: ILogger
  ) {}

  async spawn(): Promise<void> {
    this.supervisor = new UtilityProcessSupervisor({
      orchestrator: this.cpServer.getOrchestrator(),
      participantId: SHARED_PARTICIPANT_ID,
      entry: join(__dirname, '../preload/shared-worker.js'),
      role: 'utility',
      // See DaemonProcess for the rationale; shared process hosts
      // global singleton services so the conservative policy applies
      // identically.
      restartPolicy: new ExponentialBackoffPolicy({
        initialDelayMs: 1_000,
        maxDelayMs: 30_000,
        maxRetries: 10,
      }),
      onSpawn: ({ pid, isRestart }: SpawnInfo) => {
        if (isRestart && this.lastPid !== null) {
          this.pidNameRegistry.unregister(this.lastPid);
        }
        this.pidNameRegistry.register(pid, 'Shared');
        this.lastPid = pid;
      },
      onChannelReady: ({ channel }: ChannelReadyInfo) => {
        channel.setServiceHost(serviceHost);
      },
      logger: (level: string, msg: string) =>
        this.logger.info(`[SharedProcess:${level}] ${msg}`),
    });
    for (const listener of this.pendingStateChangeListeners) {
      this.supervisor.subscribeStateChange(() => listener());
    }
    this.pendingStateChangeListeners.clear();
    await this.supervisor.start();
    this.logger.info('[SharedProcess] spawned');
  }

  subscribeStateChange(listener: () => void): () => void {
    if (this.supervisor) {
      return this.supervisor.subscribeStateChange(() => {
        listener();
      });
    }
    // See DaemonProcess.subscribeStateChange for the buffer/disposer
    // caveat — same trade-off applies here.
    this.pendingStateChangeListeners.add(listener);
    return () => {
      this.pendingStateChangeListeners.delete(listener);
    };
  }

  getInspectorSnapshot(): SupervisorInspectorSnapshot | null {
    return (
      (this.supervisor?.getInspectorSnapshot() as
        | SupervisorInspectorSnapshot
        | undefined) ?? null
    );
  }
}
