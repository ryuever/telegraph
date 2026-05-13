import { MonitorSnapshot, ProcessRow } from '../common/types';
import { AppMetric, IMainMetricsService } from '@telegraph/main-metrics/common';

export class Diagnostics {
  private listeners: Set<(snapshot: MonitorSnapshot) => void> = new Set();
  private interval: ReturnType<typeof setInterval> | null = null;
  private metricsProvider: IMainMetricsService | null = null;
  private lastCpuUsage: NodeJS.CpuUsage | null = null;
  private lastCpuTime: number | null = null;

  setMetricsProvider(provider: IMainMetricsService): void {
    this.metricsProvider = provider;
  }

  private async collectSnapshot(): Promise<MonitorSnapshot> {
    const memUsage = process.memoryUsage();
    const now = Date.now();

    let daemonCpu = 0;
    const currentCpu = process.cpuUsage();
    if (this.lastCpuUsage && this.lastCpuTime) {
      const elapsedUs =
        currentCpu.user -
        this.lastCpuUsage.user +
        (currentCpu.system - this.lastCpuUsage.system);
      const elapsedMs = now - this.lastCpuTime;
      daemonCpu = +((elapsedUs / 1000 / elapsedMs) * 100).toFixed(2);
    }
    this.lastCpuUsage = currentCpu;
    this.lastCpuTime = now;

    const daemonSelf: ProcessRow = {
      pid: process.pid,
      name: 'Daemon',
      type: 'Utility',
      cpu: daemonCpu,
      memory: +(memUsage.rss / 1024 / 1024).toFixed(2),
    };

    let appMetrics: AppMetric[] = [];
    if (this.metricsProvider) {
      try {
        appMetrics = await this.metricsProvider.getAppMetrics();
      } catch {}
    }

    const processes: ProcessRow[] = [
      daemonSelf,
      ...appMetrics
        .filter(
          (m) =>
            m.type !== 'GPU' &&
            m.name !== 'Network Service' &&
            m.pid !== process.pid
        )
        .map(
          (m): ProcessRow => ({
            pid: m.pid,
            name: m.name,
            type: m.type,
            cpu: +m.cpu.percentCPUUsage.toFixed(2),
            memory: +(m.memory.workingSetSize / 1024).toFixed(2),
          })
        ),
    ];

    const totalCpu = processes.reduce((s, p) => s + p.cpu, 0);
    const totalMem = processes.reduce((s, p) => s + p.memory, 0);

    return {
      timestamp: Date.now(),
      totals: {
        cpu: +totalCpu.toFixed(2),
        memory: +totalMem.toFixed(2),
      },
      processes,
      pidTree: null,
    };
  }

  private startRoutine(): void {
    if (this.interval) return;
    this.interval = setInterval(() => {
      this.collectSnapshot().then((snapshot) => {
        for (const cb of this.listeners) {
          try {
            cb(snapshot);
          } catch {}
        }
      });
    }, 2000);
  }

  private stopRoutine(): void {
    if (this.interval && this.listeners.size === 0) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async getPerformanceSnapshot(): Promise<MonitorSnapshot> {
    return this.collectSnapshot();
  }

  onPerformanceUpdate(
    callback: (snapshot: MonitorSnapshot) => void
  ): () => void {
    this.listeners.add(callback);
    this.startRoutine();
    return () => {
      this.listeners.delete(callback);
      this.stopRoutine();
    };
  }
}
