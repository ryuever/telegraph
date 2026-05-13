const processes = new Map<Electron.UtilityProcess, string>();

export const pidNameRegistry = {
  register(proc: Electron.UtilityProcess, name: string): void {
    processes.set(proc, name);
  },
  getAll(): Array<{ pid: number; name: string }> {
    const result: Array<{ pid: number; name: string }> = [];
    for (const [proc, name] of processes) {
      if (proc.pid != null) {
        result.push({ pid: proc.pid, name });
      }
    }
    return result;
  },
};
