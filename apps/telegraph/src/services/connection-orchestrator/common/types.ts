// Phase 2 — cross-process types for the orchestrator inspector RPC.
//
// The renderer talks to `OrchestratorInspectorService` through a
// `ProxyRPCClient<IOrchestratorInspectorService>` over the cp channel, so the
// interface here defines the contract both sides share. Keep it serialisable —
// no functions, no class instances, no x-oasis internals.

/** Subset of `ParticipantType` from `@x-oasis/async-call-rpc`. */
export type ParticipantTypeWire = 'renderer' | 'utility' | 'worker' | 'process' | 'node';

/** Connection lifecycle states, mirrors `ConnectionState` enum from x-oasis. */
export type ConnectionStateWire =
  | 'IDLE'
  | 'CONNECTING'
  | 'READY'
  | 'DISCONNECTED'
  | 'RECONNECTING'
  | 'CLOSED'
  | 'FAILED';

export interface ParticipantSnapshot {
  id: string;
  type: ParticipantTypeWire;
  registeredAt: number;
}

export interface ConnectionSnapshot {
  connectionId: string;
  fromId: string;
  toId: string;
  state: ConnectionStateWire;
  lastStateChangedAt: number;
  errorMessage?: string;
}

export interface TopologySnapshot {
  participants: ParticipantSnapshot[];
  connections: ConnectionSnapshot[];
  capturedAt: number;
}

export interface RequestConnectResult {
  /** When fulfilled, the connection has reached READY (or thrown). */
  connectionId: string;
  state: ConnectionStateWire;
}

/**
 * Inspector service contract.
 *
 * Phase 2 only `getTopology()` is wired; `requestConnect` is declared so
 * Phase 3/4 can land DesignPanel against the same interface without touching
 * the contract again.
 */
export interface IOrchestratorInspectorService {
  getTopology(): Promise<TopologySnapshot>;
  requestConnect(fromId: string, toId: string): Promise<RequestConnectResult>;
}

/**
 * Phase 4 — shared utility participant id.
 *
 * Stable wire identifier shared by `SharedProcess` (main side) and
 * the shared utility process bootstrap (utility side).
 */
export const SHARED_PARTICIPANT_ID = 'utility:shared';

/**
 * Phase 4 — daemon utility participant id.
 *
 * Stable wire identifier shared by `DaemonProcess` (main side) and
 * the daemon utility process bootstrap (utility side).
 */
export const DAEMON_PARTICIPANT_ID = 'utility:daemon';

/**
 * Phase 3 — design utility participant id.
 *
 * Stable wire identifier shared by `DesignPageletProcess` (main side) and
 * `DesignBootstrap` (utility side). Both sides MUST agree on this exact
 * string when calling `orchestrator.registerParticipant(...)`.
 */
export const DESIGN_PARTICIPANT_ID = 'pagelet:design';

/**
 * Phase 4 — Daemon service path.
 *
 * Mounted on the daemon utility's `RPCServiceHost`. The daemon itself
 * generally initiates connections to pagelets for monitoring; this path
 * is reserved if pagelets need to call daemon services.
 */
export const DAEMON_SERVICE_PATH = '/services/daemon';

/**
 * Phase 3 — design service RPC path.
 *
 * Mounted on the design utility's `RPCServiceHost` and called by the renderer
 * (Phase 4) over the activated direct channel.
 */
export const DESIGN_SERVICE_PATH = '/services/design';

/**
 * Phase 4 — Shared service path.
 *
 * Mounted on the shared utility's `RPCServiceHost` and called by pagelet
 * processes over their activated direct channels.
 */
export const SHARED_SERVICE_PATH = '/services/shared';

/**
 * Shared service contract — the surface the shared utility process exposes.
 * Provides common services like app info, login, session management.
 *
 * Wire-friendly: arguments and return values must serialise across
 * `postMessage`. Keep functions pure-data in / pure-data out.
 */
export interface ISharedService {
  /**
   * Round-trip liveness check. Echoes `now` so the caller can compute RTT.
   * Returns `{ pong: now, serverTime }`.
   */
  ping(now: number): Promise<{ pong: number; serverTime: number }>;
  /**
   * Get application information.
   */
  getAppInfo(): Promise<{ name: string; version: string }>;
}

/**
 * Daemon service contract — the surface the daemon utility process exposes.
 * Provides process monitoring, metrics collection, and lifecycle management.
 *
 * Wire-friendly: arguments and return values must serialise across
 * `postMessage`. Keep functions pure-data in / pure-data out.
 */
export interface ProcessRow {
  pid: number;
  ppid: number;
  name?: string;
  type: string;
  cpu: number;
  memory: number;
}

export interface PidTreeJson {
  pid: string;
  ppid: string;
  cpu: string;
  mem: string;
  command: string;
  children: PidTreeJson[];
}

export interface MonitorSnapshot {
  timestamp: number;
  totals: { cpu: number; memory: number };
  processes: ProcessRow[];
  pidTree: PidTreeJson | null;
}

export interface IDaemonService {
  /**
   * Round-trip liveness check. Echoes `now` so the caller can compute RTT.
   * Returns `{ pong: now, serverTime }`.
   */
  ping(now: number): Promise<{ pong: number; serverTime: number }>;
  /**
   * Get status of the daemon and all monitored processes.
   */
  getProcessStatus(): Promise<{ shared: string; pagelets: string[] }>;
  /**
   * Get a full monitor snapshot with per-process CPU/memory, totals, and pid tree.
   */
  getSnapshot(): Promise<MonitorSnapshot>;
}

/**
 * Design service contract — the surface the design utility process exposes
 * to its callers. Phase 3 only `ping()` is wired; Phase 4+ adds real design
 * pagelet operations (load project, render, etc).
 *
 * Wire-friendly: arguments and return values must serialise across
 * `postMessage`. Keep functions pure-data in / pure-data out.
 */
export interface IDesignService {
  /**
   * Round-trip liveness check. Echoes `now` so the caller can compute RTT.
   * Returns `{ pong: now, serverTime }`.
   */
  ping(now: number): Promise<{ pong: number; serverTime: number }>;
}

/**
 * Monitor pagelet participant id.
 *
 * Stable wire identifier shared by `MonitorPageletProcess` (main side) and
 * `MonitorBootstrap` (utility side). Both sides MUST agree on this exact
 * string when calling `orchestrator.registerParticipant(...)`.
 */
export const MONITOR_PARTICIPANT_ID = 'pagelet:monitor';

/**
 * Monitor service path.
 *
 * Mounted on the monitor utility's `RPCServiceHost` and called by the renderer
 * over the activated direct channel.
 */
export const MONITOR_SERVICE_PATH = '/services/monitor';

/**
 * Monitor service contract — the surface the monitor pagelet exposes to the renderer.
 *
 * Wire-friendly: arguments and return values must serialise across
 * `postMessage`. Keep functions pure-data in / pure-data out.
 */
export interface IMonitorService {
  /**
   * Round-trip liveness check. Echoes `now` so the caller can compute RTT.
   * Returns `{ pong: now, serverTime }`.
   */
  ping(now: number): Promise<{ pong: number; serverTime: number }>;
}
