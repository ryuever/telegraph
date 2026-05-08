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
