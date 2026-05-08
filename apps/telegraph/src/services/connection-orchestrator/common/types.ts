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
 * Phase 3 — design utility participant id.
 *
 * Stable wire identifier shared by `DesignPageletProcess` (main side) and
 * `DesignBootstrap` (utility side). Both sides MUST agree on this exact
 * string when calling `orchestrator.registerParticipant(...)`.
 */
export const DESIGN_PARTICIPANT_ID = 'pagelet:design';

/**
 * Phase 3 — design service RPC path.
 *
 * Mounted on the design utility's `RPCServiceHost` and called by the renderer
 * (Phase 4) over the activated direct channel.
 */
export const DESIGN_SERVICE_PATH = '/services/design';

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
