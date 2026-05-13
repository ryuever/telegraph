// Ambient renderer globals injected by apps/telegraph's preload bridge.
//
// Only the surface consumed by design's browser-side code is declared here.
// The authoritative definition lives in apps/telegraph/src/types.d.ts (via
// TelegraphPreloadApi), but design's tsconfig deliberately excludes the full
// telegraph renderer tree to avoid incompatible lib requirements. We duplicate
// the narrow subset we need instead.
declare interface Window {
  telegraph: {
    /** Proxied IPC surface for inspector RPC (getTopology, requestConnect). */
    ipc: {
      send(channel: string, ...args: unknown[]): void;
      postMessage(channel: string, message: unknown, transfer?: MessagePort[]): void;
      on(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
      removeListener(channel: string, listener: (event: unknown, ...args: unknown[]) => void): void;
      removeAllListeners(channel: string): void;
    };
    /** Design direct-channel surface (ping lives here; port stays in preload). */
    designService: {
      ping(now: number): Promise<{ pong: number; serverTime: number }>;
    };
    /** Shared direct-channel surface. */
    sharedService: {
      ping(now: number): Promise<{ pong: number; serverTime: number }>;
      getAppInfo(): Promise<{ name: string; version: string }>;
    };
    /** Daemon direct-channel surface. */
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
        pidTree: {
          pid: string;
          ppid: string;
          cpu: string;
          mem: string;
          command: string;
          children: any[];
        } | null;
      }>;
    };
    /** Monitor direct-channel surface. */
    monitorService: {
      ping(now: number): Promise<{ pong: number; serverTime: number }>;
    };
    /** Notify preload which participant the next activated port belongs to. */
    enqueueConnect(participantId: string): void;
  };
}
