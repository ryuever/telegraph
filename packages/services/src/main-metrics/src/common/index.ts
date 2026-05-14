export const MAIN_METRICS_SERVICE_PATH = 'main-metrics';

export interface AppMetric {
  pid: number;
  name: string | null;
  type: string;
  cpu: {
    percentCPUUsage: number;
  };
  memory: {
    workingSetSize: number;
  };
}

/**
 * Plain JSON shape mirroring `InspectorSnapshot` from
 * `@x-oasis/async-call-rpc-electron`. Duplicated here so daemon (a node
 * utility process) can consume it without pulling the electron-only
 * sub-path into its bundle.
 *
 * Health-snapshot fields (`lastChannelReadyAt`, `lastReadinessProbeAt`,
 * `consecutiveProbeFailures`) come from x-oasis §3.D supervisor
 * diagnostics — see the upstream `InspectorSnapshot` JSDoc for semantics.
 * For `restartMode: 'spawn'` supervisors `lastReadinessProbeAt` is always
 * null and `consecutiveProbeFailures` is always 0 (no readiness probe runs).
 *
 * Lives here (not in apps/daemon/diagnostics/common) because
 * `IMainMetricsService.getSupervisorSnapshots` returns this type, and
 * `packages/services` cannot import from `apps/*`. The daemon's
 * diagnostics common re-exports this for app-side consumers.
 */
export interface SupervisorInspectorSnapshot {
  participantId: string;
  state: string;
  currentPid: number | null;
  restartCount: number;
  orchestratorCount: number;
  restartHistory: ReadonlyArray<{
    triggeredAt: number;
    prevPid: number | null;
    exitCode: number | null;
    reason: string;
    restartCount: number;
    newPid?: number;
    succeededAt?: number;
    failedAt?: number;
  }>;
  lastChannelReadyAt: number | null;
  lastReadinessProbeAt: number | null;
  consecutiveProbeFailures: number;
}

export interface IMainMetricsService {
  getAppMetrics(): AppMetric[];
  getMainPid(): number;
  getUtilityPidNames(): Record<number, string>;
  /**
   * Pull the latest UtilityProcessSupervisor inspector snapshots
   * (one per supervised utility process). The daemon's `Diagnostics`
   * folds the result into the next `MonitorSnapshot` so the Monitor
   * pagelet's Supervisors tab can render them.
   *
   * Returns `[]` until `setSupervisorProvider` has been called by
   * `AppApplication.start()`.
   */
  getSupervisorSnapshots(): SupervisorInspectorSnapshot[];
  /**
   * Inject a closure that aggregates inspector snapshots from the
   * three supervised process families (daemon / shared / pagelet).
   * Called once by AppApplication.start() — packages/services cannot
   * import apps/* directly so the assembly happens at the main app's
   * top-level seam.
   */
  setSupervisorProvider(
    provider: () => SupervisorInspectorSnapshot[]
  ): void;
}

export type { IPidNameRegistry } from '../electron-main/PidNameRegistry';
export { PidNameRegistryId, PidNameRegistry } from '../electron-main/PidNameRegistry';

export { MainMetricsServiceId } from '../electron-main/MainMetricsService';
