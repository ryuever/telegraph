export type {
  ProcessRow,
  PerformanceTotals,
  MonitorSnapshot,
  IDiagnosticsService,
  SupervisorInspectorSnapshot,
} from '@/apps/daemon/diagnostics/common';

export const MONITOR_PAGELET_SERVICE_PATH = 'monitor-pagelet-api';

export interface IMonitorPageletService {
  info(): Promise<string>;
  getSnapshot(): Promise<any>;
  onPerformanceUpdate(callback: (snapshot: any) => void): () => void;
}
