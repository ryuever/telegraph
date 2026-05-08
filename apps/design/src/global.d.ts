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
  };
}
