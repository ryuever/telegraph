import { createId } from '@x-oasis/di';

import type {
  MonitorSnapshot,
  SupervisorInspectorSnapshot,
} from '@/apps/daemon/diagnostics/common';
import type {
  ProcessControlAction,
  ProcessControlResult,
} from '@/packages/services/pagelet-host/common';

export type {
  ProcessRow,
  PerformanceTotals,
  MonitorSnapshot,
  SupervisorInspectorSnapshot,
} from '@/apps/daemon/diagnostics/common';
export type {
  ProcessControlAction,
  ProcessControlResult,
} from '@/packages/services/pagelet-host/common';

export const MONITOR_PAGELET_SERVICE_PATH = 'monitor-pagelet-api';

export interface IMonitorPageletService {
  info(): Promise<string>;
  getSnapshot(): Promise<MonitorSnapshot>;
  onPerformanceUpdate(callback: (snapshot: MonitorSnapshot) => void): () => void;
  /**
   * Independent push channel for supervisor inspector snapshots. The
   * monitor pagelet forwards this from main's
   * `IMainMetricsService.onSupervisorSnapshotsChanged`. Lives outside
   * the daemon-driven `MonitorSnapshot` pipeline so it survives daemon
   * itself being killed (the daemon supervisor cannot push its own
   * `restarting` transitions because the push source is dead during
   * that window).
   *
   * Returns a disposer.
   */
  onSupervisorSnapshotsChanged(
    callback: (snapshots: SupervisorInspectorSnapshot[]) => void
  ): () => void;
  controlSupervisor(
    participantId: string,
    action: ProcessControlAction
  ): Promise<ProcessControlResult>;
}

export interface IMonitorApplication {
  start(): Promise<void>;
}

export const MonitorApplicationId = createId('MonitorApplication');
