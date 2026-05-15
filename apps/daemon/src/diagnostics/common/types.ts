import type { SupervisorInspectorSnapshot } from '@/packages/services/main-metrics/common';

export interface ProcessRow {
  pid: number;
  name: string | null;
  type: string;
  cpu: number;
  memory: number;
}

export interface PerformanceTotals {
  cpu: number;
  memory: number;
}

export interface PidNodeJson {
  pid: string;
  ppid: string;
  cpu: string;
  mem: string;
  command: string;
  children: PidNodeJson[];
}

/**
 * Resource-level snapshot of every Electron process the daemon can see.
 *
 * Supervisor health used to be embedded here as `supervisorSnapshots`
 * but that path was removed — supervisor data now flows on its own
 * push channel (`IMonitorPageletService.onSupervisorSnapshotsChanged`),
 * sourced directly from `IMainMetricsService` in main. Keeping the two
 * pipelines separate means daemon being down doesn't blind the monitor
 * to supervisor `restarting` transitions, and avoids a 2 s detour
 * through daemon for data that already streams at 1 s from main.
 */
export interface MonitorSnapshot {
  timestamp: number;
  totals: PerformanceTotals;
  processes: ProcessRow[];
  pidTree: PidNodeJson | null;
}

// Re-export so monitor common (and any other app-side consumer)
// doesn't have to know the canonical home is in packages/services.
export type { SupervisorInspectorSnapshot };
