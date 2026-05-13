interface PidTreeJson {
  pid: string;
  ppid: string;
  cpu: string;
  mem: string;
  command: string;
  children: PidTreeJson[];
}

declare interface Window {
  telegraph: {
    ipc: {
      send(channel: string, ...args: unknown[]): void;
      postMessage(channel: string, message: unknown, transfer?: MessagePort[]): void;
      on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
      removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
      removeAllListeners(channel: string): void;
    };
    monitorService: {
      ping(now: number): Promise<{ pong: number; serverTime: number }>;
    };
    sharedService: {
      ping(now: number): Promise<{ pong: number; serverTime: number }>;
      getAppInfo(): Promise<{ name: string; version: string }>;
    };
    daemonService: {
      ping(now: number): Promise<{ pong: number; serverTime: number }>;
      getProcessStatus(): Promise<{ shared: string; pagelets: string[] }>;
      getSnapshot(): Promise<{
        timestamp: number;
        totals: { cpu: number; memory: number };
        processes: Array<{
          pid: number;
          ppid: number;
          name?: string;
          type: string;
          cpu: number;
          memory: number;
        }>;
        pidTree: PidTreeJson | null;
      }>;
    };
    enqueueConnect(participantId: string): void;
  };
}
