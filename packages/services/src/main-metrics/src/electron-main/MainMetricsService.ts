import { createId, inject, injectable } from '@x-oasis/di';
import { app } from 'electron';

import type { IPidNameRegistry } from './PidNameRegistry';
import { PidNameRegistryId } from './PidNameRegistry';
import type { AppMetric, IMainMetricsService } from '../common/index';

export const MainMetricsServiceId = createId('MainMetricsService');

function queryPsForPids(
  pids: number[]
): Map<number, { cpu: number; mem: number }> {
  const result = new Map<number, { cpu: number; mem: number }>();
  if (pids.length === 0) return result;
  try {
    const cp = require('child_process');
    const pidArgs = pids.map((p) => `-p ${p}`).join(' ');
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

@injectable()
export class MainMetricsService implements IMainMetricsService {
  constructor(
    @inject(PidNameRegistryId)
    private readonly pidNameRegistry: IPidNameRegistry
  ) {}

  getAppMetrics(): AppMetric[] {
    const electronMetrics = app.getAppMetrics();
    const knownPids = new Set(electronMetrics.map((m) => m.pid));
    const utilityByName = new Map<number, string>();
    for (const entry of this.pidNameRegistry.getAll()) {
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

    const utilityEntries = this.pidNameRegistry
      .getAll()
      .filter((e) => !knownPids.has(e.pid));

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
      result[entry.pid] = entry.name;
    }
    return result;
  }
}
