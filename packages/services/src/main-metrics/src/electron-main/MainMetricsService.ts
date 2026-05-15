import { createId, inject, injectable } from '@x-oasis/di';
import { app } from 'electron';

import type { IPidNameRegistry } from './PidNameRegistry';
import { PidNameRegistryId } from './PidNameRegistry';
import type {
  AppMetric,
  IMainMetricsService,
  SupervisorInspectorSnapshot,
} from '../common/index';
import { LogServiceId } from '@/packages/services/log/common/LogService';
import type { ILogger } from '@/packages/services/log/common/types';

export const MainMetricsServiceId = createId('MainMetricsService');

function queryPsForPids(
  pids: number[]
): Map<number, { cpu: number; mem: number }> {
  const result = new Map<number, { cpu: number; mem: number }>();
  // Drop nullish / non-positive pids — PidNameRegistry occasionally
  // hands us entries whose pid is still undefined (registered before
  // the OS pid was known) and `ps -p undefined` floods stderr.
  // Mirrors the upstream fix in x-oasis example (commit 9146f33a).
  const validPids = pids.filter(
    (p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0
  );
  if (validPids.length === 0) return result;
  try {
    const cp = require('child_process');
    const pidArgs = validPids.map((p) => `-p ${p}`).join(' ');
    const out = cp.execSync(`ps ${pidArgs} -o pid=,pcpu=,pmem=`, {
      encoding: 'utf-8',
      timeout: 3000,
    });
    for (const line of out.trim().split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 3) {
        const pid = Number(parts[0]);
        const cpu = parseFloat(parts[1]);
        const mem = parseFloat(parts[2]);
        if (!isNaN(pid)) {
          result.set(pid, { cpu, mem });
        }
      }
    }
  } catch {}
  return result;
}

/**
 * Baseline push interval for `onSupervisorSnapshotsChanged` — catches
 * field mutations that don't go through `_transition` (e.g. `currentPid`
 * changing mid-`running` after `_performRestartCore` completes; the
 * supervisor stays in `running` so no stateChange fires, but the PID
 * needs to surface to the UI).
 */
const SUPERVISOR_BASELINE_PUSH_INTERVAL_MS = 1_000;

@injectable()
export class MainMetricsService implements IMainMetricsService {
  /**
   * Closure injected by AppApplication.start() that aggregates
   * inspector snapshots from DaemonProcess + SharedProcess +
   * PageletProcess. We can't inject those services directly because
   * packages/services lives below apps/* in the dependency graph;
   * AppApplication is the only seam where all three are visible.
   * Until injection happens, getSupervisorSnapshots returns [].
   */
  private supervisorProvider: (() => SupervisorInspectorSnapshot[]) | null =
    null;

  /**
   * Active subscribers of `onSupervisorSnapshotsChanged`. Each call
   * to `triggerSupervisorSnapshotsChanged` (event-driven) and each
   * baseline tick fans out to every subscriber.
   */
  private supervisorSnapshotsListeners = new Set<
    (snapshots: SupervisorInspectorSnapshot[]) => void
  >();

  /**
   * Baseline `setInterval` handle. Lazily started when the first
   * subscriber attaches; cleared when the last subscriber detaches
   * (avoids unnecessary 1Hz aggregation on a quiet system).
   */
  private supervisorBaselineTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @inject(PidNameRegistryId)
    private readonly pidNameRegistry: IPidNameRegistry,
    @inject(LogServiceId) private readonly logger: ILogger
  ) {}

  setSupervisorProvider(
    provider: () => SupervisorInspectorSnapshot[]
  ): void {
    this.supervisorProvider = provider;
  }

  getSupervisorSnapshots(): SupervisorInspectorSnapshot[] {
    if (!this.supervisorProvider) return [];
    try {
      return this.supervisorProvider();
    } catch (e) {
      this.logger.error('[MainMetricsService] supervisorProvider threw', e);
      return [];
    }
  }

  onSupervisorSnapshotsChanged(
    callback: (snapshots: SupervisorInspectorSnapshot[]) => void
  ): () => void {
    this.supervisorSnapshotsListeners.add(callback);
    this.startSupervisorBaselineTimer();
    // Send an initial snapshot immediately so the consumer doesn't
    // have to wait up to one baseline interval to render the first
    // frame (matters when the renderer mounts the Supervisors panel
    // mid-session).
    try {
      callback(this.getSupervisorSnapshots());
    } catch (e) {
      this.logger.error(
        '[MainMetricsService] onSupervisorSnapshotsChanged initial push threw',
        e
      );
    }
    return () => {
      this.supervisorSnapshotsListeners.delete(callback);
      if (this.supervisorSnapshotsListeners.size === 0) {
        this.stopSupervisorBaselineTimer();
      }
    };
  }

  triggerSupervisorSnapshotsChanged(): void {
    if (this.supervisorSnapshotsListeners.size === 0) return;
    const snapshots = this.getSupervisorSnapshots();
    for (const cb of this.supervisorSnapshotsListeners) {
      try {
        cb(snapshots);
      } catch (e) {
        this.logger.error(
          '[MainMetricsService] supervisorSnapshotsListener threw',
          e
        );
      }
    }
  }

  private startSupervisorBaselineTimer(): void {
    if (this.supervisorBaselineTimer) return;
    this.supervisorBaselineTimer = setInterval(() => {
      this.triggerSupervisorSnapshotsChanged();
    }, SUPERVISOR_BASELINE_PUSH_INTERVAL_MS);
  }

  private stopSupervisorBaselineTimer(): void {
    if (this.supervisorBaselineTimer) {
      clearInterval(this.supervisorBaselineTimer);
      this.supervisorBaselineTimer = null;
    }
  }

  getAppMetrics(): AppMetric[] {
    const electronMetrics = app.getAppMetrics();
    const knownPids = new Set(electronMetrics.map((m) => m.pid));
    // Filter out entries whose pid is still pending — they will appear
    // in a later tick once the spawned process reports its pid.
    const registryEntries = this.pidNameRegistry
      .getAll()
      .filter(
        (e): e is { pid: number; name: string } =>
          typeof e.pid === 'number' && Number.isFinite(e.pid) && e.pid > 0
      );
    const utilityByName = new Map<number, string>();
    for (const entry of registryEntries) {
      utilityByName.set(entry.pid, entry.name);
    }

    const result = electronMetrics.map((m) => {
      const registeredName = utilityByName.get(m.pid);
      let name: string;
      if (registeredName) {
        name = registeredName;
      } else if (m.type === 'Browser') {
        name = 'Main Process';
      } else if (m.type === 'Tab') {
        name = 'Renderer';
      } else {
        name = m.type;
      }
      return {
        pid: m.pid,
        name,
        type: m.type,
        cpu: { percentCPUUsage: m.cpu.percentCPUUsage },
        memory: { workingSetSize: m.memory.workingSetSize },
      };
    });

    const utilityEntries = registryEntries.filter(
      (e) => !knownPids.has(e.pid)
    );

    if (utilityEntries.length > 0) {
      const utilityPids = utilityEntries.map((e) => e.pid);
      const psData = queryPsForPids(utilityPids);
      for (const entry of utilityEntries) {
        const ps = psData.get(entry.pid);
        result.push({
          pid: entry.pid,
          name: entry.name,
          type: 'Utility',
          cpu: { percentCPUUsage: ps?.cpu ?? 0 },
          memory: { workingSetSize: ps ? ps.mem * 1024 : 0 },
        });
      }
    }

    return result;
  }

  getMainPid(): number {
    return process.pid;
  }

  getUtilityPidNames(): Record<number, string> {
    const result: Record<number, string> = {};
    for (const entry of this.pidNameRegistry.getAll()) {
      if (
        typeof entry.pid === 'number' &&
        Number.isFinite(entry.pid) &&
        entry.pid > 0
      ) {
        result[entry.pid] = entry.name;
      }
    }
    return result;
  }
}
