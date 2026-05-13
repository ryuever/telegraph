import { useState, useCallback, useEffect, useRef } from 'react';

export interface OrchestratorAPI {
  connect(): Promise<any>;
  disconnect(): Promise<void>;
  simulateLost(): void;
  getStatus(): Promise<any>;
  killUtility(): void;
  onStateChange(callback: (event: any) => void): void;
  onReady(callback: (event: any) => void): void;
  onDisconnected(callback: (event: any) => void): void;
  onReconnecting(callback: (event: any) => void): void;
  onReconnected(callback: (event: any) => void): void;
  onReconnectFailed(callback: (event: any) => void): void;
  onClosed(callback: (event: any) => void): void;
}

interface ParticipantInfo {
  id: string;
  type: string;
}

interface ConnectionStatus {
  fromId: string;
  toId: string;
  state: string;
}

interface ConnectionStats {
  totalRpcCalls: number;
  successfulCalls: number;
  failedCalls: number;
  avgLatencyMs: number;
  totalReconnects: number;
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
    const unsubscribers: (() => void)[] = [];

    const subscribe = (
      method: (cb: (e: any) => void) => void,
      handler: (e: any) => void
    ) => {
      method(handler);
    };

    subscribe(api.onStateChange, () => {
      api.getStatus().then((s) => {
        if (s) setConnectionStatus(s);
      });
    });
    subscribe(api.onReady, () => {
      api.getStatus().then((s) => {
        if (s) setConnectionStatus(s);
      });
    });
    subscribe(api.onDisconnected, () => {
      api.getStatus().then((s) => {
        if (s) setConnectionStatus(s);
      });
    });
    subscribe(api.onReconnecting, () => {
      api.getStatus().then((s) => {
        if (s) setConnectionStatus(s);
      });
    });
    subscribe(api.onReconnected, () => {
      api.getStatus().then((s) => {
        if (s) setConnectionStatus(s);
      });
    });
    subscribe(api.onReconnectFailed, () => {
      api.getStatus().then((s) => {
        if (s) setConnectionStatus(s);
      });
    });
    subscribe(api.onClosed, () => {
      api.getStatus().then((s) => {
        if (s) setConnectionStatus(s);
      });
    });

    api.getStatus().then((s) => {
      if (s) setConnectionStatus(s);
    });

    return () => {
      unsubscribers.forEach((u) => u());
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      apiRef.current.getStatus().then((s) => {
        if (s) {
          setConnectionStatus(s);
          if (s.stats) setStats(s.stats);
        }
      });
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const onConnect = useCallback(() => {
    apiRef.current.connect();
  }, []);

  const onDisconnect = useCallback(() => {
    apiRef.current.disconnect();
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
