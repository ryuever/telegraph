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
}

export interface IDiagnosticsService {
  getPerformanceSnapshot(): Promise<MonitorSnapshot>;
  onPerformanceUpdate(
    callback: (snapshot: MonitorSnapshot) => void
  ): () => void;
}
