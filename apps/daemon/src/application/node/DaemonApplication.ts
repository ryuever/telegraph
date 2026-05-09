import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import { createId, injectable } from '@x-oasis/di';

import type {
  IDaemonService,
  MonitorSnapshot,
  PidTreeJson,
  ProcessRow,
} from '@telegraph/services/connection-orchestrator/common/types';

const execAsync = promisify(exec);

@injectable()
export class DaemonApplication implements IDaemonService {
  private pageletStatus: string[] = [];

  // eslint-disable-next-line @typescript-eslint/require-await
  async ping(now: number): Promise<{ pong: number; serverTime: number }> {
    return {
      pong: now,
      serverTime: Date.now(),
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getProcessStatus(): Promise<{ shared: string; pagelets: string[] }> {
    return {
      shared: 'running',
      pagelets: this.pageletStatus,
    };
  }

  async getSnapshot(): Promise<MonitorSnapshot> {
    return this.collectSnapshot();
  }

  registerPagelet(id: string): void {
    if (!this.pageletStatus.includes(id)) {
      this.pageletStatus.push(id);
    }
  }

  unregisterPagelet(id: string): void {
    const idx = this.pageletStatus.indexOf(id);
    if (idx !== -1) {
      this.pageletStatus.splice(idx, 1);
    }
  }

  private async collectSnapshot(): Promise<MonitorSnapshot> {
    const timestamp = Date.now();
    const platform = process.platform;

    let processes: ProcessRow[] = [];
    let pidTree: PidTreeJson | null = null;
    let totals = { cpu: 0, memory: 0 };

    if (platform === 'darwin') {
      const result = await this.collectMacProcesses();
      processes = result.processes;
      pidTree = result.pidTree;
      totals = result.totals;
    } else if (platform === 'linux') {
      const result = await this.collectLinuxProcesses();
      processes = result.processes;
      pidTree = result.pidTree;
      totals = result.totals;
    }

    return { timestamp, totals, processes, pidTree };
  }

  private async collectMacProcesses(): Promise<{
    processes: ProcessRow[];
    pidTree: PidTreeJson | null;
    totals: { cpu: number; memory: number };
  }> {
    try {
      const { stdout } = await execAsync('ps -ax -o pid,ppid,%cpu,%mem,comm | head -50');
      const lines = stdout.trim().split('\n').slice(1);
      const processes: ProcessRow[] = lines
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          return {
            pid: parseInt(parts[0], 10),
            ppid: parseInt(parts[1], 10),
            cpu: parseFloat(parts[2]) || 0,
            memory: parseFloat(parts[3]) || 0,
            name: parts[4] || '',
            type: 'process',
          };
        })
        .filter((p) => !isNaN(p.pid));

      const totals = { cpu: 0, memory: 0 };
      for (const p of processes) {
        totals.cpu += p.cpu;
        totals.memory += p.memory;
      }

      const pidTree = this.buildPidTree(processes);
      return { processes, pidTree, totals };
    } catch {
      return { processes: [], pidTree: null, totals: { cpu: 0, memory: 0 } };
    }
  }

  private async collectLinuxProcesses(): Promise<{
    processes: ProcessRow[];
    pidTree: PidTreeJson | null;
    totals: { cpu: number; memory: number };
  }> {
    try {
      const { stdout } = await execAsync('ps -eo pid,ppid,%cpu,%mem,comm --no-headers | head -50');
      const lines = stdout.trim().split('\n');
      const processes: ProcessRow[] = lines
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          return {
            pid: parseInt(parts[0], 10),
            ppid: parseInt(parts[1], 10),
            cpu: parseFloat(parts[2]) || 0,
            memory: parseFloat(parts[3]) || 0,
            name: parts[4] || '',
            type: 'process',
          };
        })
        .filter((p) => !isNaN(p.pid));

      const totals = { cpu: 0, memory: 0 };
      for (const p of processes) {
        totals.cpu += p.cpu;
        totals.memory += p.memory;
      }

      const pidTree = this.buildPidTree(processes);
      return { processes, pidTree, totals };
    } catch {
      return { processes: [], pidTree: null, totals: { cpu: 0, memory: 0 } };
    }
  }

  private buildPidTree(processes: ProcessRow[]): PidTreeJson | null {
    const map = new Map<number, PidTreeJson>();

    for (const p of processes) {
      map.set(p.pid, {
        pid: p.pid.toString(),
        ppid: p.ppid.toString(),
        cpu: p.cpu.toString(),
        mem: p.memory.toString(),
        command: p.name || '',
        children: [],
      });
    }

    let root: PidTreeJson | null = null;

    map.forEach((node) => {
      const ppid = parseInt(node.ppid, 10);
      if (ppid === 0 || !map.has(ppid)) {
        if (!root) root = node;
        else if (node.children.length > 0 || map.size < 10) {
          root.children.push(node);
        }
      } else {
        const parent = map.get(ppid);
        if (parent) {
          parent.children.push(node);
        }
      }
    });

    return root;
  }
}

export const DaemonApplicationId = createId('DaemonApplication');
