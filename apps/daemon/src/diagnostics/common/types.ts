import type { SupervisorInspectorSnapshot } from '@/packages/services/main-metrics/common';

export const DIAGNOSTICS_SERVICE_PATH = 'monitor-rpc';

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

export interface MonitorSnapshot {
  timestamp: number;
  totals: PerformanceTotals;
  processes: ProcessRow[];
  pidTree: PidNodeJson | null;
  /**
   * Per-utility-process supervisor health pulled from main via
   * IMainMetricsService.getSupervisorSnapshots(). Empty array until
   * the first MAIN_METRICS roundtrip succeeds.
   */
  supervisorSnapshots: SupervisorInspectorSnapshot[];
}

// Re-export so monitor common (and any other app-side consumer)
// doesn't have to know the canonical home is in packages/services.
export type { SupervisorInspectorSnapshot };

export interface IDiagnosticsService {
  getPerformanceSnapshot(): Promise<MonitorSnapshot>;
  onPerformanceUpdate(
    callback: (snapshot: MonitorSnapshot) => void
  ): () => void;
}
