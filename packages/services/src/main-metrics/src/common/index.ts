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

export interface IMainMetricsService {
  getAppMetrics(): AppMetric[];
  getMainPid(): number;
  getUtilityPidNames(): Record<number, string>;
}

export type { IPidNameRegistry } from '../electron-main/PidNameRegistry';
export { PidNameRegistryId, PidNameRegistry } from '../electron-main/PidNameRegistry';

export { MainMetricsServiceId } from '../electron-main/MainMetricsService';
