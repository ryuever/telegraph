import { createId, injectable } from '@x-oasis/di';

export interface IPidNameRegistry {
  /** Register or update the human-readable name for a live utility-process pid. */
  register(pid: number, name: string): void;
  /**
   * Drop the entry for `pid`. No-op if `pid` is not registered.
   *
   * Callers MUST invoke this when a process exits (e.g. from
   * `UtilityProcessSupervisor.onSpawn` on restart, or from `kill()` paths)
   * so the registry does not accumulate dead-pid entries.
   */
  unregister(pid: number): void;
  /** Snapshot of all currently-registered pid → name pairs. */
  getAll(): Array<{ pid: number; name: string }>;
}

export const PidNameRegistryId = createId('PidNameRegistry');

/**
 * Pid-keyed registry of utility-process display names, consumed by
 * MainMetricsService to attach friendly names to `app.getAppMetrics()` rows.
 *
 * Intentionally pid-keyed (not UtilityProcess-keyed) so the
 * `UtilityProcessSupervisor` — which owns the `Electron.UtilityProcess`
 * instance and only hands the consumer a pid via `onSpawn` — can drive
 * registration and eviction across crash/restart cycles.
 */
@injectable()
export class PidNameRegistry implements IPidNameRegistry {
  private byPid = new Map<number, string>();

  register(pid: number, name: string): void {
    this.byPid.set(pid, name);
  }

  unregister(pid: number): void {
    this.byPid.delete(pid);
  }

  getAll(): Array<{ pid: number; name: string }> {
    const result: Array<{ pid: number; name: string }> = [];
    for (const [pid, name] of this.byPid) {
      result.push({ pid, name });
    }
    return result;
  }
}
