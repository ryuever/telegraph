import { createId, inject, injectable } from '@x-oasis/di';
import {
  ElectronUtilityProcessChannel,
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

import type { IMainCpServer } from '@/packages/services/pagelet-host/electron-main/IMainCpServer';
import { MainCpServerId } from '@/packages/services/pagelet-host/electron-main/IMainCpServer';
import type {
  IPidNameRegistry,
  SupervisorInspectorSnapshot,
} from '@/packages/services/main-metrics/common';
import { PidNameRegistryId } from '@/packages/services/main-metrics/common';
import { LogServiceId } from '@/packages/services/log/common/LogService';
import type { ILogger } from '@/packages/services/log/common/types';

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
  stop(pageletId: string): void;
  resume(pageletId: string): Promise<void>;
  restart(pageletId: string, reason?: string): Promise<void>;
  getChannel(pageletId: string): ElectronUtilityProcessChannel | undefined;
  /**
   * Inspector snapshot for every currently-supervised pagelet (one per
   * pageletId). Killed pagelets drop out as soon as `kill()` deletes
   * their supervisor entry.
   */
  getInspectorSnapshots(): SupervisorInspectorSnapshot[];
  /**
   * Subscribe to state transitions of *any* currently-supervised
   * pagelet, AND to the spawn/kill of pagelets themselves (the set of
   * supervisors changing is itself a state-change event from the
   * outside-in inspector POV).
   *
   * The listener is fan-out: every existing supervisor's transitions
   * notify it, and each future `spawn()` will also wire it onto the
   * new supervisor. Returns a disposer that removes it from the
   * application-level set; previously-attached supervisor
   * registrations remain (they will be discarded when the supervisor
   * itself is stopped). See {@link IDaemonProcess.subscribeStateChange}
   * for the same caveat in the single-supervisor case.
   */
  subscribeStateChange(listener: () => void): () => void;
}

export const PageletProcessId = createId('PageletProcess');

@injectable()
export class PageletProcess implements IPageletProcess {
  private supervisors = new Map<string, UtilityProcessSupervisor>();
  private channels = new Map<string, ElectronUtilityProcessChannel>();
  private lastPids = new Map<string, number>();
  private spawnSpecs = new Map<
    string,
    { workerFileName: string; options: PageletSpawnOptions }
  >();
  /**
   * Application-level state-change subscribers. Wired onto every
   * existing supervisor and onto each future supervisor created by
   * {@link spawn}. Also notified whenever a pagelet is spawned or
   * killed (the supervisor set itself is part of the snapshot).
   */
  private readonly stateChangeListeners = new Set<() => void>();

  private notifyStateChange(): void {
    for (const listener of this.stateChangeListeners) {
      try {
        listener();
      } catch (err) {
        this.logger.error('[PageletProcess] stateChange listener threw', err);
      }
    }
  }

  constructor(
    @inject(MainCpServerId) private readonly cpServer: IMainCpServer,
    @inject(PidNameRegistryId) private readonly pidNameRegistry: IPidNameRegistry,
    @inject(LogServiceId) private readonly logger: ILogger
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
    this.spawnSpecs.set(pageletId, { workerFileName, options });
    const supervisor = this.createSupervisor(pageletId, workerFileName, options);
    this.supervisors.set(pageletId, supervisor);
    supervisor.subscribeStateChange(() => {
      this.notifyStateChange();
    });
    await supervisor.start();
    this.logger.info(`[PageletProcess] spawned ${pageletId}`);
    // The set of supervisors changed — the inspector view of "who
    // exists" mutated, so push to subscribers as well.
    this.notifyStateChange();
  }

  private createSupervisor(
    pageletId: string,
    workerFileName: string,
    options: PageletSpawnOptions
  ): UtilityProcessSupervisor {
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

    return new UtilityProcessSupervisor({
      orchestrator: orchestrators,
      participantId: pageletId,
      entry: join(__dirname, `../preload/${workerFileName}`),
      role: 'utility',
      // Pagelet processes are user-facing and lazily spawned, so a
      // crash should attempt several quick restarts (user might still
      // be on the tab) before giving up. ExponentialBackoffPolicy with
      // tighter initial delay than daemon/shared (which are critical
      // singletons that can wait a beat).
      restartPolicy: new ExponentialBackoffPolicy({
        initialDelayMs: 500,
        maxDelayMs: 10_000,
        maxRetries: 10,
      }),
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
        { this.logger.info(`[PageletProcess:${pageletId}:${level}] ${msg}`); },
    });
  }

  kill(pageletId: string): void {
    const supervisor = this.supervisors.get(pageletId);
    if (!supervisor) return;
    supervisor.stop();
    this.supervisors.delete(pageletId);
    this.channels.delete(pageletId);
    const lastPid = this.lastPids.get(pageletId);
    if (lastPid !== undefined) {
      this.pidNameRegistry.unregister(lastPid);
      this.lastPids.delete(pageletId);
    }
    // Set of supervisors changed; notify so monitor drops the card.
    this.notifyStateChange();
  }

  stop(pageletId: string): void {
    const supervisor = this.supervisors.get(pageletId);
    if (!supervisor) {
      throw new Error(`[PageletProcess] pagelet "${pageletId}" is not supervised`);
    }
    supervisor.stop();
    this.channels.delete(pageletId);
    const lastPid = this.lastPids.get(pageletId);
    if (lastPid !== undefined) {
      this.pidNameRegistry.unregister(lastPid);
      this.lastPids.delete(pageletId);
    }
    this.notifyStateChange();
  }

  async resume(pageletId: string): Promise<void> {
    const existing = this.supervisors.get(pageletId);
    if (existing && ['running', 'starting', 'restarting'].includes(existing.state)) {
      return;
    }
    const spec = this.spawnSpecs.get(pageletId);
    if (!spec) {
      throw new Error(`[PageletProcess] no spawn spec recorded for "${pageletId}"`);
    }
    this.supervisors.delete(pageletId);
    this.channels.delete(pageletId);
    const supervisor = this.createSupervisor(
      pageletId,
      spec.workerFileName,
      spec.options
    );
    this.supervisors.set(pageletId, supervisor);
    supervisor.subscribeStateChange(() => {
      this.notifyStateChange();
    });
    await supervisor.start();
    this.notifyStateChange();
  }

  async restart(pageletId: string, reason?: string): Promise<void> {
    const supervisor = this.supervisors.get(pageletId);
    if (!supervisor) {
      throw new Error(`[PageletProcess] pagelet "${pageletId}" is not supervised`);
    }
    await supervisor.restart(reason);
    this.notifyStateChange();
  }

  subscribeStateChange(listener: () => void): () => void {
    // Each underlying supervisor is wired to {@link notifyStateChange}
    // exactly once at spawn time, so this method is a pure
    // application-level fan-out registration. Adding/removing
    // listeners here is O(1) and never touches the supervisors.
    this.stateChangeListeners.add(listener);
    return () => {
      this.stateChangeListeners.delete(listener);
    };
  }

  getChannel(pageletId: string): ElectronUtilityProcessChannel | undefined {
    return this.channels.get(pageletId);
  }

  getInspectorSnapshots(): SupervisorInspectorSnapshot[] {
    const out: SupervisorInspectorSnapshot[] = [];
    for (const supervisor of this.supervisors.values()) {
      const snap = supervisor.getInspectorSnapshot() as
        | SupervisorInspectorSnapshot
        | undefined;
      if (snap) out.push(snap);
    }
    return out;
  }
}
