import { createId, injectable } from '@x-oasis/di';

export interface IPidNameRegistry {
  register(proc: Electron.UtilityProcess, name: string): void;
  getAll(): Array<{ pid: number; name: string }>;
}

export const PidNameRegistryId = createId('PidNameRegistry');

@injectable()
export class PidNameRegistry implements IPidNameRegistry {
  private processes = new Map<Electron.UtilityProcess, string>();

  register(proc: Electron.UtilityProcess, name: string): void {
    this.processes.set(proc, name);
  }

  getAll(): Array<{ pid: number; name: string }> {
    const result: Array<{ pid: number; name: string }> = [];
    for (const [proc, name] of this.processes) {
      if (proc.pid != null) {
        result.push({ pid: proc.pid, name });
      }
    }
    return result;
  }
}
