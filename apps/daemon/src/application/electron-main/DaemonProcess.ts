import { createId, inject, injectable } from '@x-oasis/di';
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

import type { IMainCpServer } from '@/apps/main/application/electron-main/MainCpServer';
import { MainCpServerId } from '@/apps/main/application/electron-main/MainCpServer';
import type {
  IPidNameRegistry,
  SupervisorInspectorSnapshot,
} from '@/packages/services/main-metrics/common';
import { PidNameRegistryId } from '@/packages/services/main-metrics/common';
import { DAEMON_PARTICIPANT_ID } from '@/apps/daemon/application/common';

export interface IDaemonProcess {
  spawn(): Promise<void>;
  getInspectorSnapshot(): SupervisorInspectorSnapshot | null;
  /**
   * Subscribe to supervisor state transitions (e.g.
   * `running` → `restarting` → `running`). Used by AppApplication to
   * trigger an immediate `triggerSupervisorSnapshotsChanged` push so
   * UI sees transient states even when the transition lasts well
   * under the baseline polling interval.
   *
   * The listener payload is intentionally void — consumers just need
   * a notification, the up-to-date snapshot is fetched via
   * `getInspectorSnapshot()` (or the aggregator).
   */
  subscribeStateChange(listener: () => void): () => void;
}

export const DaemonProcessId = createId('DaemonProcess');

@injectable()
export class DaemonProcess implements IDaemonProcess {
  private supervisor: UtilityProcessSupervisor | null = null;
  private lastPid: number | null = null;
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
    @inject(PidNameRegistryId) private readonly pidNameRegistry: IPidNameRegistry
  ) {}

  async spawn(): Promise<void> {
    this.supervisor = new UtilityProcessSupervisor({
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
        console.log(`[DaemonProcess:${level}] ${msg}`),
    });
    // Drain any subscribers registered before spawn().
    for (const listener of this.pendingStateChangeListeners) {
      this.supervisor.subscribeStateChange(() => listener());
    }
    this.pendingStateChangeListeners.clear();
    await this.supervisor.start();
    console.log('[DaemonProcess] spawned');
  }

  subscribeStateChange(listener: () => void): () => void {
    if (this.supervisor) {
      // Adapt: x-oasis emits a StateChangeEvent payload; consumers
      // here only need a notification.
      return this.supervisor.subscribeStateChange(() => {
        listener();
      });
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
