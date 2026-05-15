import { useState, useCallback, useMemo } from 'react';
import useOrchestratorDashboard, {
  OrchestratorAPI,
} from '@/packages/ui/useOrchestratorDashboard';
import { client } from '@/apps/main/application/browser/rpc-clients';
import { getConnectionPageletClient } from '@/apps/connection/application/browser/getClient';
import { PageConfig } from '@/apps/main/application/common/cp-config';
import { CONNECTION_PARTICIPANT_ID } from '@/packages/services/pagelet-host/common';
import { Button } from '@/packages/ui/components/ui/button';

type TabId = 'pagelet' | 'shared' | 'daemon' | 'main';

interface MethodDef {
  name: string;
  description: string;
  params?: { key: string; label: string; defaultValue: string }[];
  invoke: (params: Record<string, string>) => Promise<any>;
}

interface TabDef {
  id: TabId;
  label: string;
  color: string;
  methods: MethodDef[];
}

interface CallResult {
  method: string;
  tabId: TabId;
  params: Record<string, string>;
  value: any;
  latencyMs: number;
  timestamp: number;
  error?: string;
}

interface PageViewProps {
  page: PageConfig;
}

function createPageApi(): OrchestratorAPI {
  return {
    connect: () => client.connect(),
    disconnect: () => client.disconnect() as Promise<void>,
    simulateLost: () => client.simulateLost(),
    getStatus: () => client.getStatus(),
    killUtility: () => client.killUtility(),
    onStateChange: client.onStateChange.bind(client),
    onReady: client.onReady.bind(client),
    onDisconnected: client.onDisconnected.bind(client),
    onReconnecting: client.onReconnecting.bind(client),
    onReconnected: client.onReconnected.bind(client),
    onReconnectFailed: client.onReconnectFailed.bind(client),
    onClosed: client.onClosed.bind(client),
  };
}

function PageView({ page }: PageViewProps): JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>('pagelet');
  const [results, setResults] = useState<CallResult[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  const pageApi = useMemo(() => createPageApi(), []);
  const pageletId = CONNECTION_PARTICIPANT_ID;

  const TABS: TabDef[] = [
    {
      id: 'pagelet',
      label: 'Pagelet',
      color: page.color,
      methods: [
        {
          name: 'info',
          description: `Get ${pageletId} process info`,
          invoke: () => getConnectionPageletClient().info(),
        },
      ],
    },
    {
      id: 'shared',
      label: 'Shared',
      color: '#8b5cf6',
      methods: [
        {
          name: 'echo',
          description: 'Echo a message through shared process',
          params: [{ key: 'msg', label: 'Message', defaultValue: 'hello' }],
          invoke: (p) => getConnectionPageletClient().callSharedEcho(p.msg),
        },
        {
          name: 'getConfig',
          description: 'Get config value by key',
          params: [{ key: 'key', label: 'Config Key', defaultValue: 'theme' }],
          invoke: (p) => getConnectionPageletClient().callSharedGetConfig(p.key),
        },
        {
          name: 'setConfig',
          description: 'Set config value',
          params: [
            { key: 'key', label: 'Key', defaultValue: 'theme' },
            { key: 'value', label: 'Value', defaultValue: 'light' },
          ],
          invoke: (p) =>
            getConnectionPageletClient().callSharedSetConfig(p.key, p.value),
        },
      ],
    },
    {
      id: 'daemon',
      label: 'Daemon',
      color: '#f59e0b',
      methods: [
        {
          name: 'echo',
          description: 'Echo a message through daemon process',
          params: [{ key: 'msg', label: 'Message', defaultValue: 'hello' }],
          invoke: (p) => getConnectionPageletClient().callDaemonEcho(p.msg),
        },
        {
          name: 'systemStatus',
          description: 'Get daemon system status',
          invoke: () => getConnectionPageletClient().callDaemonSystemStatus(),
        },
      ],
    },
    {
      id: 'main',
      label: 'Main',
      color: '#10b981',
      methods: [
        {
          name: 'mainPing',
          description: 'Ping the main process',
          params: [{ key: 'msg', label: 'Message', defaultValue: 'hello' }],
          invoke: (p) => getConnectionPageletClient().callMainPing(p.msg),
        },
      ],
    },
  ];

  const currentTab = TABS.find((t) => t.id === activeTab)!;

  const dashboard = useOrchestratorDashboard({
    participants: [
      { id: 'renderer', type: 'renderer' },
      { id: pageletId, type: 'utility' },
      { id: 'shared', type: 'utility' },
      { id: 'daemon', type: 'utility' },
    ],
    api: pageApi,
    sendRpc: async (message: string) =>
      getConnectionPageletClient().callSharedEcho(message),
  });

  const state = dashboard.connectionStatus?.state || 'IDLE';
  const isReady = state === 'READY';

  const handleCall = useCallback(
    (method: MethodDef) => {
      if (!isReady) return;
      const params: Record<string, string> = {};
      method.params?.forEach((p) => {
        params[p.key] =
          paramValues[`${method.name}_${p.key}`] || p.defaultValue;
      });
      const start = performance.now();
      setLoading(method.name);
      method
        .invoke(params)
        .then((value) => {
          setResults((prev) => [
            {
              method: method.name,
              tabId: activeTab,
              params,
              value,
              latencyMs: Math.round(performance.now() - start),
              timestamp: Date.now(),
            },
            ...prev,
          ]);
        })
        .catch((err: any) => {
          setResults((prev) => [
            {
              method: method.name,
              tabId: activeTab,
              params,
              value: null,
              latencyMs: Math.round(performance.now() - start),
              timestamp: Date.now(),
              error: err.message,
            },
            ...prev,
          ]);
        })
        .finally(() => setLoading(null));
    },
    [isReady, paramValues, activeTab]
  );

  const latestForMethod = (methodName: string): CallResult | undefined =>
    results.find((r) => r.method === methodName);

  const stateColor =
    state === 'READY'
      ? '#10b981'
      : state === 'CONNECTING' || state === 'TRANSIENT_FAILURE'
      ? '#f59e0b'
      : '#6b7280';
  const cs = dashboard.connectionStatus;
  const stats = dashboard.stats;

  return (
    <>
      <div
        style={{
          background: `linear-gradient(135deg, ${page.color}dd 0%, ${page.color}99 100%)`,
          padding: '12px 24px',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          flexShrink: 0,
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.3 }}>
            {page.label}
            <span
              style={{
                fontSize: 11,
                fontWeight: 400,
                color: 'rgba(255,255,255,0.7)',
                marginLeft: 12,
              }}
            >
              DI Architecture Example
            </span>
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'rgba(255,255,255,0.8)',
              marginTop: 1,
            }}
          >
            renderer ↔ {pageletId} ↔ shared / daemon / main
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 12px',
            borderRadius: 20,
            backgroundColor: 'rgba(255,255,255,0.2)',
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: stateColor,
              display: 'inline-block',
            }}
          />
          <span style={{ fontSize: 11, color: '#fff' }}>{state}</span>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 12,
          padding: '12px 16px',
          flexShrink: 0,
        }}
      >
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
            Connection: renderer ↔ {pageletId}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                backgroundColor: stateColor,
                display: 'inline-block',
                boxShadow: isReady ? `0 0 6px ${stateColor}` : 'none',
              }}
            />
            <span style={{ fontWeight: 600, color: stateColor, fontSize: 13 }}>
              {state}
            </span>
          </div>
          {cs && (
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
                {cs.fromId}
              </span>
              <span>To:</span>
              <span style={{ fontFamily: 'monospace', color: '#334155' }}>
                {cs.toId}
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
              { l: 'Calls', v: stats?.totalRpcCalls ?? 0 },
              { l: 'Success', v: stats?.successfulCalls ?? 0 },
              { l: 'Failed', v: stats?.failedCalls ?? 0 },
              { l: 'Latency', v: `${(stats?.avgLatencyMs ?? 0).toFixed(0)}ms` },
              { l: 'Reconnects', v: stats?.totalReconnects ?? 0 },
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
          <Button
            onClick={dashboard.onConnect}
            disabled={isReady}
            size="sm"
            className="w-full"
          >
            Connect
          </Button>
          <Button
            onClick={dashboard.onDisconnect}
            disabled={!isReady}
            variant="destructive"
            size="sm"
            className="w-full"
          >
            Disconnect
          </Button>
          <Button
            onClick={dashboard.onSimulateLost}
            disabled={!isReady}
            variant="outline"
            size="sm"
            className="w-full"
          >
            Sim Lost
          </Button>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 2,
          backgroundColor: '#fff',
          borderRadius: 10,
          padding: 4,
          margin: '0 16px',
          border: '1px solid #e2e8f0',
          flexShrink: 0,
        }}
      >
        {TABS.map((tab) => (
          <Button
            key={tab.id}
            variant="ghost"
            onClick={() => setActiveTab(tab.id)}
            className="flex-1"
            style={{
              fontWeight: activeTab === tab.id ? 600 : 400,
              backgroundColor:
                activeTab === tab.id ? `${tab.color}15` : 'transparent',
              color: activeTab === tab.id ? tab.color : '#64748b',
              transition: 'all 0.15s ease',
            }}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          overflow: 'auto',
        }}
      >
        <div
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}
        >
          {currentTab.methods.map((method) => {
            const latest = latestForMethod(method.name);
            return (
              <div
                key={method.name}
                style={{
                  backgroundColor: '#fff',
                  borderRadius: 10,
                  border: '1px solid #e2e8f0',
                  padding: 16,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 3,
                        backgroundColor: currentTab.color,
                        display: 'inline-block',
                      }}
                    />
                    <span
                      style={{
                        fontFamily: 'monospace',
                        fontSize: 14,
                        fontWeight: 600,
                        color: '#1e293b',
                      }}
                    >
                      {method.name}()
                    </span>
                  </div>
                  <Button
                    onClick={() => handleCall(method)}
                    disabled={!isReady || loading === method.name}
                    size="sm"
                    style={{
                      backgroundColor:
                        isReady && loading !== method.name
                          ? currentTab.color
                          : undefined,
                    }}
                  >
                    {loading === method.name ? '...' : 'Call'}
                  </Button>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: '#94a3b8',
                    marginBottom: method.params ? 10 : 0,
                  }}
                >
                  {method.description}
                </div>
                {method.params && (
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap',
                      marginBottom: latest ? 10 : 0,
                    }}
                  >
                    {method.params.map((p) => (
                      <div
                        key={p.key}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            color: '#64748b',
                            fontWeight: 500,
                          }}
                        >
                          {p.label}
                        </span>
                        <input
                          type="text"
                          value={
                            paramValues[`${method.name}_${p.key}`] ??
                            p.defaultValue
                          }
                          onChange={(e) =>
                            setParamValues((prev) => ({
                              ...prev,
                              [`${method.name}_${p.key}`]: e.target.value,
                            }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleCall(method);
                          }}
                          disabled={!isReady}
                          style={{
                            padding: '3px 8px',
                            fontSize: 12,
                            fontFamily: 'monospace',
                            border: '1px solid #e2e8f0',
                            borderRadius: 4,
                            width: 140,
                            backgroundColor: isReady ? '#fff' : '#f9fafb',
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}
                {latest && (
                  <div
                    style={{
                      padding: '6px 10px',
                      fontSize: 12,
                      fontFamily: 'monospace',
                      backgroundColor: latest.error ? '#fef2f2' : '#f0fdf4',
                      border: `1px solid ${
                        latest.error ? '#fecaca' : '#bbf7d0'
                      }`,
                      borderRadius: 6,
                      color: latest.error ? '#991b1b' : '#166534',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {latest.error
                        ? latest.error
                        : typeof latest.value === 'object'
                        ? JSON.stringify(latest.value)
                        : String(latest.value)}
                    </span>
                    <span
                      style={{ fontSize: 10, color: '#94a3b8', flexShrink: 0 }}
                    >
                      {latest.latencyMs}ms
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export default PageView;
