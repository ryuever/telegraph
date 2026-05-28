import { useState, useCallback, useEffect } from 'react';
import { createOrchestratorClient } from '@x-oasis/async-call-rpc-electron/browser';
import { Check, Palette } from 'lucide-react';
import type { StateChangeEvent, ConnectionStats } from '@x-oasis/async-call-rpc/orchestrator';
import { SETTING_PAGELET_SERVICE_PATH, ISettingPageletService } from '@/apps/setting/application/common';
import { TELEGRAPH_THEME_PACKS, type TelegraphThemeId, type TelegraphThemePack, useTelegraphTheme } from '@/packages/ui/theme';

const client = createOrchestratorClient({
  directChannelDescription: 'setting-page↔preload',
  ipcChannelDescription: 'setting-page↔preload:ipc',
});

type SettingServiceProxy = Record<string, (...args: unknown[]) => Promise<string>>;

const settingClient = client.getProxy<SettingServiceProxy>(SETTING_PAGELET_SERVICE_PATH) as unknown as ISettingPageletService;

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

type ConnectionState = 'IDLE' | 'CONNECTING' | 'READY' | 'TRANSIENT_FAILURE' | 'DISCONNECTING' | 'CLOSED';

type SettingWindowPage = 'settings' | 'dev';

const SETTING_WINDOW_PAGE_STORAGE_KEY = 'telegraph.settingWindowPage';
const SETTING_WINDOW_PAGE_BROADCAST_CHANNEL = 'telegraph-setting-window-page';
const DEFAULT_SETTING_WINDOW_PAGE: SettingWindowPage = 'settings';

let logIdCounter = 0;

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isSettingWindowPage(value: string | null | undefined): value is SettingWindowPage {
  return value === 'settings' || value === 'dev';
}

function loadInitialSettingWindowPage(): SettingWindowPage {
  try {
    const page = globalThis.localStorage.getItem(SETTING_WINDOW_PAGE_STORAGE_KEY);
    return isSettingWindowPage(page) ? page : DEFAULT_SETTING_WINDOW_PAGE;
  } catch {
    return DEFAULT_SETTING_WINDOW_PAGE;
  }
}

function readSettingWindowPageMessage(value: unknown): SettingWindowPage | null {
  if (typeof value !== 'object' || value === null || !('page' in value)) return null;
  const page = (value as { page?: unknown }).page;
  return typeof page === 'string' && isSettingWindowPage(page) ? page : null;
}

function SettingApp() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('IDLE');
  const [statusInfo, setStatusInfo] = useState<StatusInfo | null>(null);
  const [activePage, setActivePage] = useState<SettingWindowPage>(loadInitialSettingWindowPage);
  const { themeId, themePack, setThemeId } = useTelegraphTheme();

  const isReady = connectionState === 'READY';

  const addLog = useCallback((method: string, result: unknown, latencyMs: number, error?: string) => {
    setLogs((prev) => [
      {
        id: ++logIdCounter,
        method,
        result: typeof result === 'object' && result !== null ? JSON.stringify(result) : String(result),
        latencyMs,
        error,
        timestamp: Date.now(),
      },
      ...prev.slice(0, 49),
    ]);
  }, []);

  useEffect(() => {
    const subs: { unsubscribe: () => void }[] = [];

    subs.push(
      client.onStateChange((event: StateChangeEvent) => {
        setConnectionState(event.currentState);
      }),
    );
    subs.push(
      client.onReady(() => {
        setConnectionState('READY');
      }),
    );
    subs.push(
      client.onDisconnected(() => {
        setConnectionState('CLOSED');
      }),
    );
    subs.push(
      client.onReconnecting(() => {
        setConnectionState('TRANSIENT_FAILURE');
      }),
    );
    subs.push(
      client.onReconnected(() => {
        setConnectionState('READY');
      }),
    );
    subs.push(
      client.onReconnectFailed(() => {
        setConnectionState('CLOSED');
      }),
    );
    subs.push(
      client.onClosed(() => {
        setConnectionState('CLOSED');
      }),
    );

    client
      .connect()
      .then(() => {
        setConnectionState('READY');
      })
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
      subs.forEach((s) => {
        s.unsubscribe();
      });
      clearInterval(pollStatus);
    };
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === SETTING_WINDOW_PAGE_STORAGE_KEY && isSettingWindowPage(event.newValue)) {
        setActivePage(event.newValue);
      }
    };
    window.addEventListener('storage', handleStorage);

    if (typeof BroadcastChannel === 'undefined') {
      return () => {
        window.removeEventListener('storage', handleStorage);
      };
    }

    const channel = new BroadcastChannel(SETTING_WINDOW_PAGE_BROADCAST_CHANNEL);
    channel.onmessage = (event: MessageEvent<unknown>) => {
      const nextPage = readSettingWindowPageMessage(event.data);
      if (nextPage) setActivePage(nextPage);
    };
    return () => {
      window.removeEventListener('storage', handleStorage);
      channel.close();
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

  const handleThemeChange = useCallback(
    (nextThemeId: TelegraphThemeId) => {
      setThemeId(nextThemeId);
    },
    [setThemeId],
  );

  const callMethod = useCallback(
    async (method: string, ...args: unknown[]) => {
      if (!isReady) return;
      setLoading(method);
      const start = performance.now();
      try {
        const serviceProxy = settingClient as unknown as Record<string, (...args: unknown[]) => Promise<string>>;
        const result = await serviceProxy[method](...args);
        addLog(method, result, Math.round(performance.now() - start));
        return result;
      } catch (err: unknown) {
        addLog(method, null, Math.round(performance.now() - start), getErrorMessage(err));
      } finally {
        setLoading(null);
      }
    },
    [isReady, addLog],
  );

  const stateColor: Record<string, string> = {
    IDLE: 'var(--muted-foreground)',
    CONNECTING: 'var(--chart-4)',
    READY: 'var(--accent-mint)',
    TRANSIENT_FAILURE: 'var(--destructive)',
    DISCONNECTING: 'var(--accent-lilac)',
    CLOSED: 'var(--foreground)',
  };
  const sc = stateColor[connectionState] || 'var(--muted-foreground)';

  const stats = statusInfo?.stats;
  const activePageTitle = activePage === 'settings' ? 'Setting' : 'Dev';
  const activePageDescription = activePage === 'settings' ? 'Theme and personal preferences' : 'Pagelet diagnostics and RPC tools';

  return (
    <div
      style={{
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        backgroundColor: 'var(--background)',
        color: 'var(--foreground)',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          backgroundColor: 'var(--card)',
          borderBottom: '1px solid var(--border)',
          padding: '16px 24px',
          color: 'var(--foreground)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{activePageTitle}</div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--muted-foreground)',
              marginTop: 2,
            }}
          >
            {activePageDescription}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {activePage === 'dev' && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 12px',
                borderRadius: 8,
                backgroundColor: 'var(--accent)',
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
          )}
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
        {activePage === 'settings' ? (
          <ThemeSection currentThemeId={themeId} currentThemeLabel={themePack.label} onThemeChange={handleThemeChange} />
        ) : (
          <>
              <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
                <div
                  style={{
                    flex: 1,
                    backgroundColor: 'var(--card)',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    padding: 14,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--muted-foreground)',
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
                    <span style={{ fontWeight: 600, color: sc, fontSize: 13 }}>{connectionState}</span>
                  </div>
                  {statusInfo && (
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: 11,
                        color: 'var(--muted-foreground)',
                        display: 'grid',
                        gridTemplateColumns: 'auto 1fr',
                        gap: '2px 8px',
                      }}
                    >
                      <span>From:</span>
                      <span
                        style={{
                          fontFamily: 'monospace',
                          color: 'var(--foreground)',
                        }}
                      >
                        {statusInfo.fromId}
                      </span>
                      <span>To:</span>
                      <span
                        style={{
                          fontFamily: 'monospace',
                          color: 'var(--foreground)',
                        }}
                      >
                        {statusInfo.toId}
                      </span>
                    </div>
                  )}
                </div>

                <div
                  style={{
                    flex: 1,
                    backgroundColor: 'var(--card)',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    padding: 14,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--muted-foreground)',
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
                      {
                        l: 'Reconnects',
                        v: String(stats?.totalReconnects ?? 0),
                      },
                      {
                        l: 'Rate',
                        v: stats && stats.totalRpcCalls > 0 ? `${((stats.successfulCalls / stats.totalRpcCalls) * 100).toFixed(0)}%` : '-',
                      },
                    ].map((s) => (
                      <div
                        key={s.l}
                        style={{
                          backgroundColor: 'var(--muted)',
                          borderRadius: 4,
                          padding: '4px 6px',
                        }}
                      >
                        <div
                          style={{
                            fontSize: 9,
                            color: 'var(--muted-foreground)',
                          }}
                        >
                          {s.l}
                        </div>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            fontFamily: 'monospace',
                            color: 'var(--foreground)',
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
                    backgroundColor: 'var(--card)',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
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
                      color: 'var(--muted-foreground)',
                      textTransform: 'uppercase',
                      marginBottom: 2,
                    }}
                  >
                    Actions
                  </div>
                  <button
                    onClick={() => {
                      void handleConnect();
                    }}
                    disabled={isReady}
                    style={{
                      padding: '5px 14px',
                      fontSize: 12,
                      fontWeight: 600,
                      border: 'none',
                      borderRadius: 6,
                      backgroundColor: isReady ? 'var(--muted)' : 'var(--primary)',
                      color: isReady ? 'var(--muted-foreground)' : 'var(--primary-foreground)',
                      cursor: isReady ? 'not-allowed' : 'pointer',
                    }}
                  >
                    Connect
                  </button>
                  <button
                    onClick={() => {
                      void handleDisconnect();
                    }}
                    disabled={!isReady}
                    style={{
                      padding: '5px 14px',
                      fontSize: 12,
                      fontWeight: 600,
                      border: 'none',
                      borderRadius: 6,
                      backgroundColor: isReady ? 'var(--destructive)' : 'var(--muted)',
                      color: isReady ? 'var(--destructive-foreground)' : 'var(--muted-foreground)',
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
                      border: isReady ? '1px solid var(--chart-4)' : '1px solid var(--border)',
                      borderRadius: 6,
                      backgroundColor: isReady ? 'var(--surface-tint)' : 'var(--muted)',
                      color: isReady ? 'var(--foreground)' : 'var(--muted-foreground)',
                      cursor: isReady ? 'pointer' : 'not-allowed',
                    }}
                  >
                    Sim Lost
                  </button>
                </div>
              </div>

              <div
                style={{
                  backgroundColor: 'var(--card)',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  padding: 16,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    marginBottom: 12,
                    color: 'var(--foreground)',
                  }}
                >
                  Shared Process (via Setting Pagelet)
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <ActionBtn
                    label="Get Config"
                    loading={loading === 'callSharedGetConfig'}
                    disabled={!isReady}
                    onClick={() => {
                      void callMethod('callSharedGetConfig', 'theme');
                    }}
                  />
                  <ActionBtn
                    label="Set Config"
                    loading={loading === 'callSharedSetConfig'}
                    disabled={!isReady}
                    onClick={() => {
                      void callMethod('callSharedSetConfig', 'theme', themeId);
                    }}
                  />
                  <ActionBtn
                    label="Echo Shared"
                    loading={loading === 'callSharedEcho'}
                    disabled={!isReady}
                    onClick={() => {
                      void callMethod('callSharedEcho', 'hello from setting');
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  backgroundColor: 'var(--card)',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  padding: 16,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    marginBottom: 12,
                    color: 'var(--foreground)',
                  }}
                >
                  Daemon Process (via Setting Pagelet)
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <ActionBtn
                    label="System Status"
                    loading={loading === 'callDaemonSystemStatus'}
                    disabled={!isReady}
                    onClick={() => {
                      void callMethod('callDaemonSystemStatus');
                    }}
                  />
                  <ActionBtn
                    label="Echo Daemon"
                    loading={loading === 'callDaemonEcho'}
                    disabled={!isReady}
                    onClick={() => {
                      void callMethod('callDaemonEcho', 'hello from setting');
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  backgroundColor: 'var(--card)',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  padding: 16,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    marginBottom: 12,
                    color: 'var(--foreground)',
                  }}
                >
                  Main Process (via Setting Pagelet)
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <ActionBtn
                    label="Main Ping"
                    loading={loading === 'callMainPing'}
                    disabled={!isReady}
                    onClick={() => {
                      void callMethod('callMainPing', 'hello from setting');
                    }}
                  />
                  <ActionBtn
                    label="Pagelet Info"
                    loading={loading === 'info'}
                    disabled={!isReady}
                    onClick={() => {
                      void callMethod('info');
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  backgroundColor: 'var(--surface-soft)',
                  border: '1px solid var(--border)',
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
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--muted-foreground)',
                      fontWeight: 600,
                    }}
                  >
                    Call Log ({logs.length})
                  </span>
                  <button
                    onClick={() => {
                      setLogs([]);
                    }}
                    style={{
                      fontSize: 10,
                      border: '1px solid var(--border)',
                      borderRadius: 3,
                      backgroundColor: 'transparent',
                      color: 'var(--muted-foreground)',
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
                      color: 'var(--muted-foreground)',
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
                      color: 'var(--foreground)',
                      padding: '3px 0',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <span
                      style={{
                        color: l.error ? 'var(--destructive)' : 'var(--accent-mint)',
                        flexShrink: 0,
                      }}
                    >
                      {l.error ? '✗' : '✓'}
                    </span>
                    <span
                      style={{
                        color: 'var(--primary)',
                        width: 180,
                        flexShrink: 0,
                      }}
                    >
                      {l.method}()
                    </span>
                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: l.error ? 'var(--destructive)' : 'var(--muted-foreground)',
                      }}
                    >
                      {l.error || l.result}
                    </span>
                    <span
                      style={{
                        color: 'var(--muted-foreground)',
                        flexShrink: 0,
                      }}
                    >
                      {l.latencyMs}ms
                    </span>
                  </div>
                ))}
              </div>
          </>
        )}
      </div>
    </div>
  );
}

function ThemeSection({ currentThemeId, currentThemeLabel, onThemeChange }: { currentThemeId: TelegraphThemeId; currentThemeLabel: string; onThemeChange: (themeId: TelegraphThemeId) => void }) {
  return (
    <section
      style={{
        backgroundColor: 'var(--card)',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        padding: 16,
        flexShrink: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--primary)',
              backgroundColor: 'var(--primary)',
              boxShadow: 'var(--shadow-primary-soft)',
            }}
          >
            <Palette size={15} color="var(--primary-foreground)" />
          </span>
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--foreground)',
              }}
            >
              Theme
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--muted-foreground)',
                marginTop: 2,
              }}
            >
              {currentThemeLabel}
            </div>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            border: '1px solid var(--border)',
            backgroundColor: 'var(--surface-soft)',
            borderRadius: 999,
            color: 'var(--muted-foreground)',
            fontSize: 11,
            padding: '5px 9px',
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              backgroundColor: 'var(--primary)',
              boxShadow: 'var(--shadow-primary-soft)',
            }}
          />
          Synced
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
          gap: 10,
        }}
      >
        {TELEGRAPH_THEME_PACKS.map((pack) => (
          <ThemeOption key={pack.id} pack={pack} selected={pack.id === currentThemeId} onSelect={onThemeChange} />
        ))}
      </div>
    </section>
  );
}

function ThemeOption({ pack, selected, onSelect }: { pack: TelegraphThemePack; selected: boolean; onSelect: (themeId: TelegraphThemeId) => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`Use ${pack.label} theme`}
      onClick={() => {
        onSelect(pack.id);
      }}
      style={{
        display: 'flex',
        minHeight: 96,
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'space-between',
        gap: 10,
        textAlign: 'left',
        borderRadius: 'var(--radius)',
        border: selected ? '1px solid var(--primary)' : '1px solid var(--border)',
        backgroundColor: selected ? 'var(--accent)' : 'var(--card)',
        color: 'var(--foreground)',
        padding: 11,
        cursor: 'pointer',
        boxShadow: selected ? 'var(--shadow-primary-soft)' : 'none',
      }}
    >
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ minWidth: 0 }}>
          <span
            style={{
              display: 'block',
              fontSize: 12,
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {pack.label}
          </span>
          <span
            style={{
              display: 'block',
              color: 'var(--muted-foreground)',
              fontSize: 10,
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {pack.source}
          </span>
        </span>
        {selected && (
          <span
            style={{
              width: 20,
              height: 20,
              borderRadius: 999,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              backgroundColor: 'var(--primary)',
              color: 'var(--primary-foreground)',
            }}
          >
            <Check size={13} />
          </span>
        )}
      </span>

      <span
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${String(pack.swatches.length)}, minmax(0, 1fr))`,
          gap: 4,
        }}
      >
        {pack.swatches.map((swatch, index) => (
          <span
            key={`${pack.id}-${swatch}-${String(index)}`}
            style={{
              height: 22,
              borderRadius: 5,
              backgroundColor: swatch,
              border: '1px solid var(--border)',
            }}
          />
        ))}
      </span>
      <span
        style={{
          color: 'var(--muted-foreground)',
          fontSize: 10.5,
          lineHeight: 1.35,
        }}
      >
        {pack.description}
      </span>
    </button>
  );
}

function isStatusInfo(value: unknown): value is StatusInfo {
  return typeof value === 'object' && value !== null && 'fromId' in value && 'toId' in value;
}

function ActionBtn({ label, loading, disabled, onClick }: { label: string; loading: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      style={{
        padding: '6px 14px',
        fontSize: 12,
        fontWeight: 600,
        border: '1px solid var(--border)',
        borderRadius: 6,
        backgroundColor: loading ? 'var(--muted)' : disabled ? 'var(--muted)' : 'var(--card)',
        color: loading ? 'var(--muted-foreground)' : disabled ? 'var(--muted-foreground)' : 'var(--foreground)',
        cursor: loading || disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {loading ? '...' : label}
    </button>
  );
}

export default SettingApp;
