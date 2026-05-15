import { useState, useCallback, useEffect } from 'react';
import { createOrchestratorClient } from '@x-oasis/async-call-rpc-electron/browser';
import type {
  StateChangeEvent,
  ConnectionStats,
} from '@x-oasis/async-call-rpc';
import {
  SETTING_PAGELET_SERVICE_PATH,
  ISettingPageletService,
} from '@/apps/setting/application/common';

const client = createOrchestratorClient({
  directChannelDescription: 'setting-page↔preload',
  ipcChannelDescription: 'setting-page↔preload:ipc',
});

type SettingServiceProxy = Record<string, (...args: unknown[]) => Promise<string>>;

const settingClient = client.getProxy<SettingServiceProxy>(
  SETTING_PAGELET_SERVICE_PATH
) as unknown as ISettingPageletService;

interface LogEntry {
  id: number;
  method: string;
  result: string;
  latencyMs: number;
  error?: string;
  timestamp: number;
}

interface StatusInfo {
  fromId: string;
  toId: string;
  stats?: ConnectionStats;
}

type ConnectionState =
  | 'IDLE'
  | 'CONNECTING'
  | 'READY'
  | 'TRANSIENT_FAILURE'
  | 'DISCONNECTING'
  | 'CLOSED';

let logIdCounter = 0;

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function SettingApp() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('IDLE');
  const [statusInfo, setStatusInfo] = useState<StatusInfo | null>(null);

  const isReady = connectionState === 'READY';

  const addLog = useCallback(
    (method: string, result: unknown, latencyMs: number, error?: string) => {
      setLogs((prev) => [
        {
          id: ++logIdCounter,
          method,
          result:
            typeof result === 'object' && result !== null
              ? JSON.stringify(result)
              : String(result),
          latencyMs,
          error,
          timestamp: Date.now(),
        },
        ...prev.slice(0, 49),
      ]);
    },
    []
  );

  useEffect(() => {
    const subs: { unsubscribe: () => void }[] = [];

    subs.push(
      client.onStateChange((event: StateChangeEvent) => {
        setConnectionState(event.currentState);
      })
    );
    subs.push(
      client.onReady(() => {
        setConnectionState('READY');
      })
    );
    subs.push(
      client.onDisconnected(() => {
        setConnectionState('CLOSED');
      })
    );
    subs.push(
      client.onReconnecting(() => {
        setConnectionState('TRANSIENT_FAILURE');
      })
    );
    subs.push(
      client.onReconnected(() => {
        setConnectionState('READY');
      })
    );
    subs.push(
      client.onReconnectFailed(() => {
        setConnectionState('CLOSED');
      })
    );
    subs.push(
      client.onClosed(() => {
        setConnectionState('CLOSED');
      })
    );

    client
      .connect()
      .then(() => { setConnectionState('READY'); })
      .catch((err: unknown) => {
        setConnectionState('IDLE');
        addLog('connect', null, 0, getErrorMessage(err));
      });

    const pollStatus = setInterval(() => {
      client
        .getStatus()
        .then((info: unknown) => {
          if (isStatusInfo(info)) setStatusInfo(info);
        })
        .catch(() => {});
    }, 2000);

    return () => {
      subs.forEach((s) => { s.unsubscribe(); });
      clearInterval(pollStatus);
    };
  }, []);

  const handleConnect = useCallback(async () => {
    setConnectionState('CONNECTING');
    try {
      await client.connect();
      setConnectionState('READY');
    } catch (err: unknown) {
      setConnectionState('IDLE');
      addLog('connect', null, 0, getErrorMessage(err));
    }
  }, [addLog]);

  const handleDisconnect = useCallback(async () => {
    setConnectionState('DISCONNECTING');
    try {
      await client.disconnect();
      setConnectionState('CLOSED');
    } catch (err: unknown) {
      addLog('disconnect', null, 0, getErrorMessage(err));
    }
  }, [addLog]);

  const handleSimulateLost = useCallback(() => {
    client.simulateLost();
  }, []);

  const callMethod = useCallback(
    async (method: string, ...args: unknown[]) => {
      if (!isReady) return;
      setLoading(method);
      const start = performance.now();
      try {
        const serviceProxy = settingClient as unknown as Record<
          string,
          (...args: unknown[]) => Promise<string>
        >;
        const result = await serviceProxy[method](...args);
        addLog(method, result, Math.round(performance.now() - start));
        return result;
      } catch (err: unknown) {
        addLog(
          method,
          null,
          Math.round(performance.now() - start),
          getErrorMessage(err)
        );
      } finally {
        setLoading(null);
      }
    },
    [isReady, addLog]
  );

  const stateColor: Record<string, string> = {
    IDLE: '#6b7280',
    CONNECTING: '#f59e0b',
    READY: '#10b981',
    TRANSIENT_FAILURE: '#ef4444',
    DISCONNECTING: '#8b5cf6',
    CLOSED: '#374151',
  };
  const sc = stateColor[connectionState] || '#6b7280';

  const stats = statusInfo?.stats;

  return (
    <div
      style={{
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        backgroundColor: '#f8fafc',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          background: 'linear-gradient(135deg, #7c3aed 0%, #a78bfa 100%)',
          padding: '16px 24px',
          color: '#fff',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>Settings Window</div>
          <div
            style={{
              fontSize: 11,
              color: 'rgba(255,255,255,0.7)',
              marginTop: 2,
            }}
          >
            All calls via setting-pagelet → shared / daemon / main
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 12px',
              borderRadius: 20,
              backgroundColor: 'rgba(255,255,255,0.15)',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: sc,
                display: 'inline-block',
                boxShadow: isReady ? `0 0 6px ${sc}` : 'none',
              }}
            />
            <span style={{ fontSize: 11 }}>{connectionState}</span>
          </div>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
          <div
            style={{
              flex: 1,
              backgroundColor: '#fff',
              borderRadius: 10,
              border: '1px solid #e2e8f0',
              padding: 14,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#94a3b8',
                textTransform: 'uppercase',
                marginBottom: 8,
              }}
            >
              Connection
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  backgroundColor: sc,
                  display: 'inline-block',
                  boxShadow: isReady ? `0 0 6px ${sc}` : 'none',
                }}
              />
              <span style={{ fontWeight: 600, color: sc, fontSize: 13 }}>
                {connectionState}
              </span>
            </div>
            {statusInfo && (
              <div
                style={{
                  marginTop: 8,
                  fontSize: 11,
                  color: '#94a3b8',
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  gap: '2px 8px',
                }}
              >
                <span>From:</span>
                <span style={{ fontFamily: 'monospace', color: '#334155' }}>
                  {statusInfo.fromId}
                </span>
                <span>To:</span>
                <span style={{ fontFamily: 'monospace', color: '#334155' }}>
                  {statusInfo.toId}
                </span>
              </div>
            )}
          </div>

          <div
            style={{
              flex: 1,
              backgroundColor: '#fff',
              borderRadius: 10,
              border: '1px solid #e2e8f0',
              padding: 14,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#94a3b8',
                textTransform: 'uppercase',
                marginBottom: 8,
              }}
            >
              Stats
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: 6,
              }}
            >
              {[
                { l: 'Calls', v: String(stats?.totalRpcCalls ?? 0) },
                { l: 'Success', v: String(stats?.successfulCalls ?? 0) },
                { l: 'Failed', v: String(stats?.failedCalls ?? 0) },
                {
                  l: 'Latency',
                  v: `${(stats?.avgLatencyMs ?? 0).toFixed(0)}ms`,
                },
                { l: 'Reconnects', v: String(stats?.totalReconnects ?? 0) },
                {
                  l: 'Rate',
                  v:
                    stats && stats.totalRpcCalls > 0
                      ? `${(
                          (stats.successfulCalls / stats.totalRpcCalls) *
                          100
                        ).toFixed(0)}%`
                      : '-',
                },
              ].map((s) => (
                <div
                  key={s.l}
                  style={{
                    backgroundColor: '#f8fafc',
                    borderRadius: 4,
                    padding: '4px 6px',
                  }}
                >
                  <div style={{ fontSize: 9, color: '#94a3b8' }}>{s.l}</div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      fontFamily: 'monospace',
                      color: '#334155',
                    }}
                  >
                    {s.v}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              flex: 0,
              backgroundColor: '#fff',
              borderRadius: 10,
              border: '1px solid #e2e8f0',
              padding: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#94a3b8',
                textTransform: 'uppercase',
                marginBottom: 2,
              }}
            >
              Actions
            </div>
            <button
              onClick={() => { void handleConnect(); }}
              disabled={isReady}
              style={{
                padding: '5px 14px',
                fontSize: 12,
                fontWeight: 600,
                border: 'none',
                borderRadius: 6,
                backgroundColor: isReady ? '#d1d5db' : '#3b82f6',
                color: '#fff',
                cursor: isReady ? 'not-allowed' : 'pointer',
              }}
            >
              Connect
            </button>
            <button
              onClick={() => { void handleDisconnect(); }}
              disabled={!isReady}
              style={{
                padding: '5px 14px',
                fontSize: 12,
                fontWeight: 600,
                border: 'none',
                borderRadius: 6,
                backgroundColor: isReady ? '#ef4444' : '#d1d5db',
                color: '#fff',
                cursor: isReady ? 'pointer' : 'not-allowed',
              }}
            >
              Disconnect
            </button>
            <button
              onClick={handleSimulateLost}
              disabled={!isReady}
              style={{
                padding: '5px 14px',
                fontSize: 12,
                fontWeight: 600,
                border: isReady ? '1px solid #f59e0b' : '1px solid #d1d5db',
                borderRadius: 6,
                backgroundColor: isReady ? '#fffbeb' : '#f9fafb',
                color: isReady ? '#b45309' : '#9ca3af',
                cursor: isReady ? 'pointer' : 'not-allowed',
              }}
            >
              Sim Lost
            </button>
          </div>
        </div>

        <div
          style={{
            backgroundColor: '#fff',
            borderRadius: 10,
            border: '1px solid #e2e8f0',
            padding: 16,
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 12,
              color: '#1e293b',
            }}
          >
            Shared Process (via Setting Pagelet)
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <ActionBtn
              label="Get Config"
              loading={loading === 'callSharedGetConfig'}
              disabled={!isReady}
              onClick={() => { void callMethod('callSharedGetConfig', 'theme'); }}
            />
            <ActionBtn
              label="Set Config"
              loading={loading === 'callSharedSetConfig'}
              disabled={!isReady}
              onClick={() => { void callMethod('callSharedSetConfig', 'theme', 'dark'); }}
            />
            <ActionBtn
              label="Echo Shared"
              loading={loading === 'callSharedEcho'}
              disabled={!isReady}
              onClick={() => { void callMethod('callSharedEcho', 'hello from setting'); }}
            />
          </div>
        </div>

        <div
          style={{
            backgroundColor: '#fff',
            borderRadius: 10,
            border: '1px solid #e2e8f0',
            padding: 16,
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 12,
              color: '#1e293b',
            }}
          >
            Daemon Process (via Setting Pagelet)
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <ActionBtn
              label="System Status"
              loading={loading === 'callDaemonSystemStatus'}
              disabled={!isReady}
              onClick={() => { void callMethod('callDaemonSystemStatus'); }}
            />
            <ActionBtn
              label="Echo Daemon"
              loading={loading === 'callDaemonEcho'}
              disabled={!isReady}
              onClick={() => { void callMethod('callDaemonEcho', 'hello from setting'); }}
            />
          </div>
        </div>

        <div
          style={{
            backgroundColor: '#fff',
            borderRadius: 10,
            border: '1px solid #e2e8f0',
            padding: 16,
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              marginBottom: 12,
              color: '#1e293b',
            }}
          >
            Main Process (via Setting Pagelet)
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <ActionBtn
              label="Main Ping"
              loading={loading === 'callMainPing'}
              disabled={!isReady}
              onClick={() => { void callMethod('callMainPing', 'hello from setting'); }}
            />
            <ActionBtn
              label="Pagelet Info"
              loading={loading === 'info'}
              disabled={!isReady}
              onClick={() => { void callMethod('info'); }}
            />
          </div>
        </div>

        <div
          style={{
            backgroundColor: '#111827',
            borderRadius: 8,
            padding: 12,
            flex: 1,
            minHeight: 120,
            overflow: 'auto',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 600 }}>
              Call Log ({logs.length})
            </span>
            <button
              onClick={() => { setLogs([]); }}
              style={{
                fontSize: 10,
                border: '1px solid #374151',
                borderRadius: 3,
                backgroundColor: 'transparent',
                color: '#6b7280',
                cursor: 'pointer',
                padding: '0 6px',
              }}
            >
              Clear
            </button>
          </div>
          {logs.length === 0 && (
            <div
              style={{
                color: '#4b5563',
                textAlign: 'center',
                padding: 12,
                fontSize: 12,
              }}
            >
              Click a button above to make RPC calls...
            </div>
          )}
          {logs.map((l) => (
            <div
              key={l.id}
              style={{
                display: 'flex',
                gap: 6,
                fontSize: 11,
                fontFamily: 'monospace',
                color: '#d1d5db',
                padding: '3px 0',
                borderBottom: '1px solid #1f2937',
              }}
            >
              <span
                style={{
                  color: l.error ? '#ef4444' : '#10b981',
                  flexShrink: 0,
                }}
              >
                {l.error ? '✗' : '✓'}
              </span>
              <span style={{ color: '#a78bfa', width: 180, flexShrink: 0 }}>
                {l.method}()
              </span>
              <span
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  color: l.error ? '#ef4444' : '#94a3b8',
                }}
              >
                {l.error || l.result}
              </span>
              <span style={{ color: '#4b5563', flexShrink: 0 }}>
                {l.latencyMs}ms
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function isStatusInfo(value: unknown): value is StatusInfo {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fromId' in value &&
    'toId' in value
  );
}

function ActionBtn({
  label,
  loading,
  disabled,
  onClick,
}: {
  label: string;
  loading: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      style={{
        padding: '6px 14px',
        fontSize: 12,
        fontWeight: 600,
        border: '1px solid #e2e8f0',
        borderRadius: 6,
        backgroundColor: loading ? '#f1f5f9' : disabled ? '#f9fafb' : '#fff',
        color: loading ? '#94a3b8' : disabled ? '#d1d5db' : '#334155',
        cursor: loading || disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {loading ? '...' : label}
    </button>
  );
}

export default SettingApp;
