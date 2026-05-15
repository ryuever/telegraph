import { useState, useCallback, useEffect, useRef } from 'react';

/**
 * Subscribe handle returned by every `on*` event hook on the
 * orchestrator client. `unsubscribe()` is called on unmount to break
 * the orchestrator → renderer push channel reference.
 */
export interface Subscription {
  unsubscribe: () => void;
}

/**
 * Inspector connection statistics — mirrors x-oasis StatsView shape.
 * Re-declared here (instead of imported from @x-oasis) to keep
 * @/packages/ui import-free of orchestrator internals.
 */
export interface ConnectionStats {
  totalRpcCalls: number;
  successfulCalls: number;
  failedCalls: number;
  avgLatencyMs: number;
  totalReconnects: number;
}

/**
 * Inspector status view — single connection between two participants.
 * Mirrors x-oasis StatusView; `stats` is null while the orchestrator
 * has no completed RPCs to summarize yet.
 */
export interface ConnectionStatus {
  fromId: string;
  toId: string;
  state: string;
  stats?: ConnectionStats | null;
  lastStateChangedAt?: number;
  error?: string;
  isReady?: boolean;
}

/**
 * Event payload pushed by the orchestrator on every connection state
 * transition. The hook never reads fields off it directly — it always
 * re-fetches `getStatus()` for a consistent snapshot — so we keep the
 * type as `unknown` instead of the per-event x-oasis classes
 * (StateChangeEvent, ReadyEvent, …) and let consumers narrow as
 * needed. This keeps the OrchestratorAPI shape compatible with
 * different orchestrator-client implementations without leaking
 * x-oasis types into @/packages/ui.
 */
export type OrchestratorEvent = unknown;

export interface OrchestratorAPI {
  connect(): Promise<unknown>;
  disconnect(): Promise<void>;
  simulateLost(): void;
  /**
   * `unknown` instead of `ConnectionStatus | null` because callers
   * typically re-export an x-oasis client whose declared return type
   * is `unknown`. The hook narrows the result internally before
   * touching React state.
   */
  getStatus(): Promise<unknown>;
  killUtility(): void;
  /**
   * Each on* method returns a Subscription whose unsubscribe() must
   * be called on cleanup, otherwise the orchestrator keeps fanning
   * events to a dead React tree. The hand-rolled types in
   * apps/main/.../rpc-clients.ts return `{ unsubscribe }` already;
   * the IOrchestratorService server-side type erroneously declares
   * void due to a x-oasis ServiceHandlersOf limitation, but the
   * runtime value is the same `{ unsubscribe }` object.
   */
  onStateChange(callback: (event: OrchestratorEvent) => void): Subscription;
  onReady(callback: (event: OrchestratorEvent) => void): Subscription;
  onDisconnected(callback: (event: OrchestratorEvent) => void): Subscription;
  onReconnecting(callback: (event: OrchestratorEvent) => void): Subscription;
  onReconnected(callback: (event: OrchestratorEvent) => void): Subscription;
  onReconnectFailed(callback: (event: OrchestratorEvent) => void): Subscription;
  onClosed(callback: (event: OrchestratorEvent) => void): Subscription;
}

interface ParticipantInfo {
  id: string;
  type: string;
}

interface DashboardState {
  connectionStatus: ConnectionStatus | null;
  stats: ConnectionStats | null;
}

interface UseOrchestratorDashboardConfig {
  participants: ParticipantInfo[];
  api: OrchestratorAPI;
  sendRpc: (message: string) => Promise<string>;
}

function useOrchestratorDashboard(
  config: UseOrchestratorDashboardConfig
): DashboardState & {
  onConnect: () => void;
  onDisconnect: () => void;
  onSimulateLost: () => void;
} {
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus | null>(null);
  const [stats, setStats] = useState<ConnectionStats | null>(null);
  const apiRef = useRef(config.api);

  useEffect(() => {
    apiRef.current = config.api;
  }, [config.api]);

  useEffect(() => {
    const api = apiRef.current;
    let cancelled = false;

    /**
     * Fetch a fresh status snapshot and push both the top-level
     * status and its embedded stats into React state. Guarded by
     * `cancelled` so a slow round-trip after unmount doesn't trigger
     * a state update on a dead component.
     */
    const refresh = (): void => {
      void api.getStatus().then((raw) => {
        if (cancelled) return;
        const status = raw as ConnectionStatus | null;
        if (status) {
          setConnectionStatus(status);
          if (status.stats) setStats(status.stats);
        }
      });
    };

    // Subscribe to every state-transition event and refresh on each.
    // Collect the unsubscribe handles so cleanup actually disposes
    // them — the previous version pushed nothing into `unsubscribers`
    // and silently leaked subscriptions across remounts (potentially
    // multiplying the renderer's event handlers each navigation).
    const subs: Subscription[] = [
      api.onStateChange(refresh),
      api.onReady(refresh),
      api.onDisconnected(refresh),
      api.onReconnecting(refresh),
      api.onReconnected(refresh),
      api.onReconnectFailed(refresh),
      api.onClosed(refresh),
    ];

    // Initial snapshot — the on* events only fire on transitions, so
    // without this kick the panel stays empty until the first state
    // change after mount.
    refresh();

    return () => {
      cancelled = true;
      for (const sub of subs) {
        try {
          sub.unsubscribe();
        } catch (err) {
          console.warn(
            `[useOrchestratorDashboard] unsubscribe threw: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }
    };
    // Intentionally one-shot: api is captured via apiRef so it doesn't
    // need to be a dep, and re-subscribing on every render would defeat
    // the purpose of the cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onConnect = useCallback(() => {
    void apiRef.current.connect();
  }, []);

  const onDisconnect = useCallback(() => {
    void apiRef.current.disconnect();
  }, []);

  const onSimulateLost = useCallback(() => {
    apiRef.current.simulateLost();
  }, []);

  return {
    connectionStatus,
    stats,
    onConnect,
    onDisconnect,
    onSimulateLost,
  };
}

export default useOrchestratorDashboard;
