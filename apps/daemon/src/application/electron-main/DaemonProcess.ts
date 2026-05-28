import { inject, injectable } from '@x-oasis/di';
import {
  UtilityProcessSupervisor,
  type SpawnInfo,
  type ChannelReadyInfo,
} from '@x-oasis/async-call-rpc-electron';
import {
  ExponentialBackoffPolicy,
} from '@x-oasis/async-call-rpc/orchestrator';
import {
  serviceHost,
} from '@x-oasis/async-call-rpc';
import { join } from 'path';

import type {
  IPidNameRegistry,
  SupervisorInspectorSnapshot,
} from '@/packages/services/main-metrics/common';
import { PidNameRegistryId } from '@/packages/services/main-metrics/common';
import { DAEMON_PARTICIPANT_ID } from '@/apps/daemon/application/common';
import type { IDaemonProcess } from '@/apps/daemon/application/common';
import { DaemonProcessId } from '@/apps/daemon/application/common';
import type { IMainCpServer } from '@/packages/services/pagelet-host/electron-main/IMainCpServer';
import { MainCpServerId } from '@/packages/services/pagelet-host/electron-main/IMainCpServer';
import { LogServiceId } from '@/packages/services/log/common/LogService';
import type { ILogger } from '@/packages/services/log/common/types';

export type { IDaemonProcess };
export { DaemonProcessId };

@injectable()
export class DaemonProcess implements IDaemonProcess {
  private supervisor: UtilityProcessSupervisor | null = null;
  private lastPid: number | null = null;
  private readonly stateChangeListeners = new Set<() => void>();
  /**
   * Listeners registered before {@link spawn} completes. We need to
   * buffer them because {@link UtilityProcessSupervisor} is constructed
   * lazily inside `spawn()`, but {@link AppApplication} wires up
   * subscriptions during DI module composition (potentially before
   * spawn). After `spawn()` runs, new listeners are forwarded directly
   * to the supervisor.
   */
  private readonly pendingStateChangeListeners = new Set<() => void>();

  constructor(
    @inject(MainCpServerId) private readonly cpServer: IMainCpServer,
    @inject(PidNameRegistryId) private readonly pidNameRegistry: IPidNameRegistry,
    @inject(LogServiceId) private readonly logger: ILogger
  ) {}

  async spawn(): Promise<void> {
    this.supervisor = this.createSupervisor();
    await this.supervisor.start();
    this.logger.info('[DaemonProcess] spawned');
  }

  private createSupervisor(): UtilityProcessSupervisor {
    const supervisor = new UtilityProcessSupervisor({
      orchestrator: this.cpServer.getOrchestrator(),
      participantId: DAEMON_PARTICIPANT_ID,
      entry: join(__dirname, '../preload/daemon-worker.js'),
      role: 'utility',
      // Without restartPolicy the supervisor transitions straight to
      // `failed` on any unexpected child exit
      // (UtilityProcessSupervisor.ts:762-764). Use ExponentialBackoff
      // with conservative settings — daemon hosts diagnostics & metrics
      // aggregation, a hard-broken entry should give up after 10 tries
      // and 5 minutes rather than restart-loop forever.
      restartPolicy: new ExponentialBackoffPolicy({
        initialDelayMs: 1_000,
        maxDelayMs: 30_000,
        maxRetries: 10,
      }),
      onSpawn: ({ pid, isRestart }: SpawnInfo) => {
        if (isRestart && this.lastPid !== null) {
          this.pidNameRegistry.unregister(this.lastPid);
        }
        this.pidNameRegistry.register(pid, 'Daemon');
        this.lastPid = pid;
      },
      onChannelReady: ({ channel }: ChannelReadyInfo) => {
        channel.setServiceHost(serviceHost);
      },
      logger: (level: string, msg: string) =>
        { this.logger.info(`[DaemonProcess:${level}] ${msg}`); },
    });
    // Drain any subscribers registered before spawn().
    for (const listener of this.pendingStateChangeListeners) {
      this.stateChangeListeners.add(listener);
    }
    this.pendingStateChangeListeners.clear();
    supervisor.subscribeStateChange(() => {
      this.notifyStateChange();
    });
    return supervisor;
  }

  private notifyStateChange(): void {
    for (const listener of this.stateChangeListeners) {
      listener();
    }
  }

  subscribeStateChange(listener: () => void): () => void {
    if (this.supervisor) {
      this.stateChangeListeners.add(listener);
      return () => {
        this.stateChangeListeners.delete(listener);
      };
    }
    // Buffer for later; spawn() will rebind these to the supervisor.
    // NOTE: the returned disposer only removes the listener from the
    // pending set. Once spawn() drains the buffer, the supervisor
    // holds an independent registration that this disposer will not
    // unbind. AppApplication subscribes for the entire process
    // lifetime (no unsubscribe), so this limitation is acceptable
    // here. Revisit if a transient subscriber appears.
    this.pendingStateChangeListeners.add(listener);
    return () => {
      this.pendingStateChangeListeners.delete(listener);
    };
  }

  stop(): void {
    if (!this.supervisor) {
      throw new Error('[DaemonProcess] daemon is not supervised');
    }
    this.supervisor.stop();
    if (this.lastPid !== null) {
      this.pidNameRegistry.unregister(this.lastPid);
      this.lastPid = null;
    }
    this.notifyStateChange();
  }

  async resume(): Promise<void> {
    if (this.supervisor && ['running', 'starting', 'restarting'].includes(this.supervisor.state)) {
      return;
    }
    this.supervisor = this.createSupervisor();
    await this.supervisor.start();
    this.notifyStateChange();
  }

  async restart(reason?: string): Promise<void> {
    if (!this.supervisor) {
      throw new Error('[DaemonProcess] daemon is not supervised');
    }
    await this.supervisor.restart(reason);
    this.notifyStateChange();
  }

  getInspectorSnapshot(): SupervisorInspectorSnapshot | null {
    // The supervisor's InspectorSnapshot type is structurally identical
    // to SupervisorInspectorSnapshot (we mirror it intentionally to
    // keep daemon's bundle electron-free); cast through unknown.
    return (
      (this.supervisor?.getInspectorSnapshot() as
        | SupervisorInspectorSnapshot
        | undefined) ?? null
    );
  }
}
