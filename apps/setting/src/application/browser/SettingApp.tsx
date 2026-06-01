import { useState, useCallback, useEffect, type CSSProperties } from 'react';
import { createOrchestratorClient } from '@x-oasis/async-call-rpc-electron/browser';
import { Check, Palette } from 'lucide-react';
import type { StateChangeEvent, ConnectionStats } from '@x-oasis/async-call-rpc/orchestrator';
import {
  SETTING_PAGELET_SERVICE_PATH,
  type ISettingPageletService,
  type PiAiProviderDescriptor,
  type PiAiModelDescriptor,
  type PiAiConnectionTestResult,
  type PiAiProviderAuthMode,
} from '@/apps/setting/application/common';
import {
  readRuntimeSettingsFromStorage,
  writeRuntimeSettingsToStorage,
  DEFAULT_RUNTIME_SETTINGS,
} from '@/packages/agent/browser/runtime-settings-storage';
import { TELEGRAPH_THEME_PACKS, type TelegraphThemeId, type TelegraphThemePack, useTelegraphTheme } from '@/packages/ui/theme';

const client = createOrchestratorClient({
  directChannelDescription: 'setting-page↔preload',
  ipcChannelDescription: 'setting-page↔preload:ipc',
});

type SettingServiceProxy = Record<string, (...args: unknown[]) => Promise<unknown>>;

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
type SettingSubPage = 'theme' | 'models';

interface ModelSettingsDraft {
  provider: string;
  modelId: string;
  backend: string;
  baseUrl: string;
  authMode: PiAiProviderAuthMode;
  apiKey: string;
  subscriptionProvider: string;
  subscriptionCredentialsText: string;
}

interface SaveMessage {
  tone: 'idle' | 'success' | 'error';
  text: string;
}

const SETTING_WINDOW_PAGE_STORAGE_KEY = 'telegraph.settingWindowPage';
const SETTING_WINDOW_PAGE_BROADCAST_CHANNEL = 'telegraph-setting-window-page';
const DEFAULT_SETTING_WINDOW_PAGE: SettingWindowPage = 'settings';
const DEFAULT_SETTING_SUB_PAGE: SettingSubPage = 'theme';

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

function loadInitialModelSettings(): ModelSettingsDraft {
  try {
    const settings = readRuntimeSettingsFromStorage(localStorage);
    const provider = settings.provider ?? DEFAULT_RUNTIME_SETTINGS.provider;
    return {
      provider,
      modelId: settings.modelId ?? DEFAULT_RUNTIME_SETTINGS.modelId,
      backend: settings.backend ?? DEFAULT_RUNTIME_SETTINGS.backend,
      baseUrl: settings.baseUrl ?? '',
      authMode: settings.authMode === 'subscription' ? 'subscription' : 'api-key',
      apiKey: settings.apiKey ?? '',
      subscriptionProvider: settings.subscriptionProvider ?? provider,
      subscriptionCredentialsText: formatJson(settings.subscriptionCredentials),
    };
  } catch {
    return {
      provider: DEFAULT_RUNTIME_SETTINGS.provider,
      modelId: DEFAULT_RUNTIME_SETTINGS.modelId,
      backend: DEFAULT_RUNTIME_SETTINGS.backend,
      baseUrl: '',
      authMode: 'api-key',
      apiKey: DEFAULT_RUNTIME_SETTINGS.apiKey,
      subscriptionProvider: DEFAULT_RUNTIME_SETTINGS.provider,
      subscriptionCredentialsText: '',
    };
  }
}

function formatJson(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

function parseSubscriptionCredentials(text: string): {
  refresh: string;
  access: string;
  expires: number;
  [key: string]: unknown;
} | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.refresh !== 'string' ||
      typeof record.access !== 'string' ||
      typeof record.expires !== 'number'
    ) {
      return null;
    }
    return {
      ...record,
      refresh: record.refresh,
      access: record.access,
      expires: record.expires,
    };
  } catch {
    return null;
  }
}

function SettingApp() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('IDLE');
  const [statusInfo, setStatusInfo] = useState<StatusInfo | null>(null);
  const [activePage, setActivePage] = useState<SettingWindowPage>(loadInitialSettingWindowPage);
  const [settingsSubPage, setSettingsSubPage] = useState<SettingSubPage>(DEFAULT_SETTING_SUB_PAGE);
  const [modelDraft, setModelDraft] = useState<ModelSettingsDraft>(loadInitialModelSettings);
  const [providers, setProviders] = useState<PiAiProviderDescriptor[]>([]);
  const [models, setModels] = useState<PiAiModelDescriptor[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [isTestingModel, setIsTestingModel] = useState(false);
  const [modelTestResult, setModelTestResult] = useState<PiAiConnectionTestResult | null>(null);
  const [saveMessage, setSaveMessage] = useState<SaveMessage>({ tone: 'idle', text: '' });
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

  useEffect(() => {
    if (!isReady) return;
    let cancelled = false;
    void settingClient
      .listPiAiProviders()
      .then((items) => {
        if (cancelled) return;
        setProviders(items);
        setModelDraft((prev) => {
          if (items.length === 0) return prev;
          const hasProvider = items.some((item) => item.id === prev.provider);
          const fallbackProvider = items[0]?.id ?? prev.provider;
          return hasProvider ? prev : {
            ...prev,
            provider: fallbackProvider,
            subscriptionProvider: prev.subscriptionProvider || fallbackProvider,
          };
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSaveMessage({ tone: 'error', text: `Load providers failed: ${getErrorMessage(err)}` });
      });
    return () => {
      cancelled = true;
    };
  }, [isReady]);

  useEffect(() => {
    if (!isReady || !modelDraft.provider) {
      setModels([]);
      return;
    }
    let cancelled = false;
    setLoadingModels(true);
    void settingClient
      .listPiAiModels(modelDraft.provider)
      .then((items) => {
        if (cancelled) return;
        setModels(items);
        setModelDraft((prev) => {
          if (items.length === 0) return prev;
          const hasModel = items.some((item) => item.id === prev.modelId);
          return hasModel ? prev : {
            ...prev,
            modelId: items[0]?.id ?? prev.modelId,
          };
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSaveMessage({ tone: 'error', text: `Load models failed: ${getErrorMessage(err)}` });
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isReady, modelDraft.provider]);

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

  const updateModelDraft = useCallback((patch: Partial<ModelSettingsDraft>) => {
    setModelDraft((prev) => ({ ...prev, ...patch }));
    setSaveMessage((prev) => (prev.tone === 'error' ? { tone: 'idle', text: '' } : prev));
  }, []);

  const handleSaveModelSettings = useCallback(() => {
    if (!modelDraft.provider || !modelDraft.modelId) {
      setSaveMessage({ tone: 'error', text: 'Provider and model are required.' });
      return;
    }

    const subscriptionCredentials = parseSubscriptionCredentials(modelDraft.subscriptionCredentialsText);
    if (modelDraft.authMode === 'subscription' && !subscriptionCredentials) {
      setSaveMessage({
        tone: 'error',
        text: 'Subscription credentials must be valid JSON with refresh/access/expires.',
      });
      return;
    }

    try {
      writeRuntimeSettingsToStorage({
        ...readRuntimeSettingsFromStorage(localStorage),
        provider: modelDraft.provider,
        modelId: modelDraft.modelId,
        backend: modelDraft.backend,
        baseUrl: modelDraft.baseUrl.trim() ? modelDraft.baseUrl.trim() : undefined,
        apiKey: modelDraft.apiKey.trim(),
        authMode: modelDraft.authMode,
        subscriptionProvider: modelDraft.authMode === 'subscription'
          ? (modelDraft.subscriptionProvider.trim() || modelDraft.provider)
          : undefined,
        subscriptionCredentials: modelDraft.authMode === 'subscription'
          ? subscriptionCredentials ?? undefined
          : undefined,
      }, localStorage);
      setSaveMessage({
        tone: 'success',
        text: 'Model settings saved. Chat and Design runs will use this configuration.',
      });
    } catch (err: unknown) {
      setSaveMessage({
        tone: 'error',
        text: `Save failed: ${getErrorMessage(err)}`,
      });
    }
  }, [modelDraft]);

  const handleTestModelConnection = useCallback(async () => {
    if (!isReady) return;
    const provider = modelDraft.provider.trim();
    const modelId = modelDraft.modelId.trim();
    if (!provider || !modelId) {
      setModelTestResult({
        ok: false,
        provider,
        modelId,
        authMode: modelDraft.authMode,
        latencyMs: 0,
        error: 'Provider and model are required.',
      });
      return;
    }

    const subscriptionCredentials = parseSubscriptionCredentials(modelDraft.subscriptionCredentialsText);
    if (modelDraft.authMode === 'subscription' && !subscriptionCredentials) {
      setModelTestResult({
        ok: false,
        provider,
        modelId,
        authMode: modelDraft.authMode,
        latencyMs: 0,
        error: 'Subscription credentials must be valid JSON with refresh/access/expires.',
      });
      return;
    }

    setIsTestingModel(true);
    try {
      const result = await settingClient.testPiAiConnection({
        provider,
        modelId,
        authMode: modelDraft.authMode,
        apiKey: modelDraft.authMode === 'api-key' ? modelDraft.apiKey.trim() : undefined,
        subscriptionProvider: modelDraft.authMode === 'subscription'
          ? (modelDraft.subscriptionProvider.trim() || provider)
          : undefined,
        subscriptionCredentials: modelDraft.authMode === 'subscription'
          ? subscriptionCredentials ?? undefined
          : undefined,
      });
      setModelTestResult(result);
      if (result.ok && result.refreshedSubscriptionCredentials && modelDraft.authMode === 'subscription') {
        setModelDraft((prev) => ({
          ...prev,
          apiKey: result.resolvedApiKey ?? prev.apiKey,
          subscriptionCredentialsText: JSON.stringify(result.refreshedSubscriptionCredentials, null, 2),
        }));
      }
    } catch (err: unknown) {
      setModelTestResult({
        ok: false,
        provider,
        modelId,
        authMode: modelDraft.authMode,
        latencyMs: 0,
        error: getErrorMessage(err),
      });
    } finally {
      setIsTestingModel(false);
    }
  }, [isReady, modelDraft]);

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
  const activePageDescription = activePage === 'settings'
    ? 'Theme, model provider mode, and runtime preferences'
    : 'Pagelet diagnostics and RPC tools';

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
      {activePage === 'dev' && (
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
          </div>
        </div>
      )}

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
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(180px, 220px) minmax(0, 1fr)',
              gap: 12,
              alignItems: 'start',
            }}
          >
            <aside
              style={{
                backgroundColor: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {([
                { id: 'theme', label: 'Theme', desc: 'Colors and appearance' },
                { id: 'models', label: 'Models', desc: 'Provider, auth, connectivity' },
              ] as const).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setSettingsSubPage(tab.id);
                  }}
                  style={{
                    border: settingsSubPage === tab.id ? '1px solid var(--primary)' : '1px solid transparent',
                    borderRadius: 8,
                    backgroundColor: settingsSubPage === tab.id ? 'var(--accent)' : 'transparent',
                    color: settingsSubPage === tab.id ? 'var(--foreground)' : 'var(--muted-foreground)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    padding: '8px 9px',
                    transition: 'all 120ms ease',
                  }}
                  aria-current={settingsSubPage === tab.id}
                >
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{tab.label}</div>
                  <div style={{ fontSize: 10.5, marginTop: 1 }}>{tab.desc}</div>
                </button>
              ))}
            </aside>

            <div style={{ minWidth: 0 }}>
              {settingsSubPage === 'theme' ? (
                <ThemeSection
                  currentThemeId={themeId}
                  currentThemeLabel={themePack.label}
                  onThemeChange={handleThemeChange}
                />
              ) : (
                <ModelsSection
                  isReady={isReady}
                  providers={providers}
                  models={models}
                  loadingModels={loadingModels}
                  draft={modelDraft}
                  isTesting={isTestingModel}
                  testResult={modelTestResult}
                  saveMessage={saveMessage}
                  onDraftChange={updateModelDraft}
                  onSave={handleSaveModelSettings}
                  onTest={handleTestModelConnection}
                />
              )}
            </div>
          </div>
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

function ModelsSection({
  isReady,
  providers,
  models,
  loadingModels,
  draft,
  isTesting,
  testResult,
  saveMessage,
  onDraftChange,
  onSave,
  onTest,
}: {
  isReady: boolean;
  providers: PiAiProviderDescriptor[];
  models: PiAiModelDescriptor[];
  loadingModels: boolean;
  draft: ModelSettingsDraft;
  isTesting: boolean;
  testResult: PiAiConnectionTestResult | null;
  saveMessage: SaveMessage;
  onDraftChange: (patch: Partial<ModelSettingsDraft>) => void;
  onSave: () => void;
  onTest: () => Promise<void>;
}) {
  const providersForMode = providers.filter((provider) =>
    draft.authMode === 'subscription' ? provider.supportsSubscription : provider.supportsApiKey,
  );
  const currentProvider = providers.find((provider) => provider.id === draft.provider);
  const hasSubscriptionConfig = parseSubscriptionCredentials(draft.subscriptionCredentialsText) !== null;
  const inputStyle: CSSProperties = {
    width: '100%',
    borderRadius: 8,
    border: '1px solid var(--border)',
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
    padding: '8px 10px',
    fontSize: 12,
  };

  return (
    <section
      style={{
        backgroundColor: 'var(--card)',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>Models</div>
          <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 2 }}>
            Configure pi-ai provider auth mode (api-key / subscription OAuth) and validate connectivity.
          </div>
        </div>
        <div
          style={{
            borderRadius: 999,
            border: '1px solid var(--border)',
            backgroundColor: isReady ? 'var(--accent)' : 'var(--muted)',
            color: isReady ? 'var(--foreground)' : 'var(--muted-foreground)',
            fontSize: 11,
            padding: '5px 10px',
            fontWeight: 600,
          }}
        >
          {isReady ? 'Setting Pagelet Ready' : 'Connecting...'}
        </div>
      </div>

      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 12,
          backgroundColor: 'var(--surface-soft)',
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted-foreground)', marginBottom: 8 }}>
          Select authentication method:
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {([
            { id: 'subscription', label: 'Use a subscription' },
            { id: 'api-key', label: 'Use an API key' },
          ] as const).map((mode) => {
            const selected = draft.authMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => {
                  const nextAuthMode = mode.id;
                  const providersForNextMode = providers.filter((provider) =>
                    nextAuthMode === 'subscription' ? provider.supportsSubscription : provider.supportsApiKey,
                  );
                  const fallbackProvider = providersForNextMode[0]?.id ?? draft.provider;
                  onDraftChange({
                    authMode: nextAuthMode,
                    provider: nextAuthMode === draft.authMode ? draft.provider : fallbackProvider,
                    subscriptionProvider: nextAuthMode === 'subscription'
                      ? (draft.subscriptionProvider || draft.provider)
                      : draft.subscriptionProvider,
                  });
                }}
                style={{
                  border: selected ? '1px solid var(--primary)' : '1px solid var(--border)',
                  backgroundColor: selected ? 'var(--accent)' : 'var(--card)',
                  color: selected ? 'var(--foreground)' : 'var(--muted-foreground)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  textAlign: 'left',
                  fontWeight: selected ? 700 : 500,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {selected ? '→ ' : ''}{mode.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 12,
          backgroundColor: 'var(--surface-soft)',
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted-foreground)', marginBottom: 8 }}>
          Select provider to configure:
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {providersForMode.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--muted-foreground)', padding: '4px 6px' }}>
              {draft.authMode === 'subscription'
                ? 'No subscription providers available.'
                : 'No API key providers available.'}
            </div>
          ) : (
            providersForMode.map((provider) => {
              const selected = draft.provider === provider.id;
              const status = providerStatusLabel({
                provider,
                selected,
                draft,
                hasSubscriptionConfig,
              });
              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => {
                    onDraftChange({
                      provider: provider.id,
                      subscriptionProvider: draft.authMode === 'subscription'
                        ? provider.id
                        : draft.subscriptionProvider,
                    });
                  }}
                  style={{
                    border: selected ? '1px solid var(--primary)' : '1px solid transparent',
                    backgroundColor: selected ? 'var(--card)' : 'transparent',
                    color: selected ? 'var(--foreground)' : 'var(--muted-foreground)',
                    borderRadius: 8,
                    padding: '7px 9px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <span>{selected ? '→ ' : ''}{provider.displayName}</span>
                  <span style={{ fontSize: 11, opacity: 0.9 }}>{status}</span>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 10,
        }}
      >
        <label style={{ display: 'block' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted-foreground)', marginBottom: 6 }}>
            Model {loadingModels ? '(loading...)' : ''}
          </div>
          <select
            value={draft.modelId}
            onChange={(event) => {
              onDraftChange({ modelId: event.target.value });
            }}
            style={inputStyle}
          >
            {models.length === 0 ? (
              <option value="">No models for provider</option>
            ) : (
              models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))
            )}
          </select>
        </label>

        <label style={{ display: 'block' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted-foreground)', marginBottom: 6 }}>Backend</div>
          <select
            value={draft.backend}
            onChange={(event) => {
              onDraftChange({ backend: event.target.value });
            }}
            style={inputStyle}
          >
            <option value="pi-ai">pi-ai</option>
            <option value="pi-embedded">pi-embedded</option>
          </select>
        </label>
      </div>

      <label style={{ display: 'block' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted-foreground)', marginBottom: 6 }}>Base URL (optional)</div>
        <input
          type="text"
          value={draft.baseUrl}
          placeholder="https://api.example.com/v1"
          onChange={(event) => {
            onDraftChange({ baseUrl: event.target.value });
          }}
          style={inputStyle}
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      {draft.authMode === 'api-key' ? (
        <label style={{ display: 'block' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted-foreground)', marginBottom: 6 }}>API Key</div>
          <input
            type="password"
            value={draft.apiKey}
            placeholder="sk-..."
            onChange={(event) => {
              onDraftChange({ apiKey: event.target.value });
            }}
            style={inputStyle}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
      ) : (
        <>
          <label style={{ display: 'block' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted-foreground)', marginBottom: 6 }}>
              Subscription Provider
            </div>
            <select
              value={draft.subscriptionProvider}
              onChange={(event) => {
                onDraftChange({ subscriptionProvider: event.target.value });
              }}
              style={inputStyle}
            >
              {providers.filter((provider) => provider.supportsSubscription).length === 0 ? (
                <option value={draft.provider}>{draft.provider}</option>
              ) : (
                providers
                  .filter((provider) => provider.supportsSubscription)
                  .map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.displayName}
                  </option>
                ))
              )}
            </select>
          </label>
          <label style={{ display: 'block' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted-foreground)', marginBottom: 6 }}>
              Subscription Credentials (JSON)
            </div>
            <textarea
              value={draft.subscriptionCredentialsText}
              onChange={(event) => {
                onDraftChange({ subscriptionCredentialsText: event.target.value });
              }}
              placeholder={'{\n  "refresh": "...",\n  "access": "...",\n  "expires": 0\n}'}
              style={{
                ...inputStyle,
                minHeight: 140,
                resize: 'vertical',
                fontFamily: 'monospace',
              }}
              spellCheck={false}
            />
          </label>
        </>
      )}

      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 10,
          fontSize: 11,
          color: 'var(--muted-foreground)',
          backgroundColor: 'var(--surface-soft)',
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '4px 8px',
        }}
      >
        <span>Provider mode:</span>
        <span style={{ color: 'var(--foreground)', fontFamily: 'monospace' }}>
          {draft.authMode}
        </span>
        <span>Current provider:</span>
        <span style={{ color: 'var(--foreground)', fontFamily: 'monospace' }}>
          {(currentProvider?.displayName ?? draft.provider) || '-'}
        </span>
        <span>Model count:</span>
        <span>{currentProvider ? String(currentProvider.modelCount) : '-'}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => {
            onTest().catch(() => {});
          }}
          disabled={!isReady || isTesting}
          style={{
            border: 'none',
            borderRadius: 8,
            padding: '7px 14px',
            fontWeight: 600,
            fontSize: 12,
            cursor: !isReady || isTesting ? 'not-allowed' : 'pointer',
            backgroundColor: !isReady || isTesting ? 'var(--muted)' : 'var(--primary)',
            color: !isReady || isTesting ? 'var(--muted-foreground)' : 'var(--primary-foreground)',
          }}
        >
          {isTesting ? 'Testing...' : 'Test Connection'}
        </button>
        <button
          type="button"
          onClick={onSave}
          style={{
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '7px 14px',
            fontWeight: 600,
            fontSize: 12,
            cursor: 'pointer',
            backgroundColor: 'var(--card)',
            color: 'var(--foreground)',
          }}
        >
          Save Settings
        </button>
      </div>

      {testResult && (
        <div
          style={{
            border: `1px solid ${testResult.ok ? 'var(--accent-mint)' : 'var(--destructive)'}`,
            borderRadius: 8,
            backgroundColor: testResult.ok ? 'color-mix(in srgb, var(--accent-mint) 12%, var(--card))' : 'color-mix(in srgb, var(--destructive) 14%, var(--card))',
            color: 'var(--foreground)',
            padding: 10,
            fontSize: 11,
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: '4px 8px',
          }}
        >
          <span>Status:</span>
          <span style={{ fontWeight: 700 }}>{testResult.ok ? 'Connected' : 'Failed'}</span>
          <span>Latency:</span>
          <span>{`${String(testResult.latencyMs)}ms`}</span>
          <span>Mode:</span>
          <span>{testResult.authMode}</span>
          {!testResult.ok && (
            <>
              <span>Error:</span>
              <span style={{ color: 'var(--destructive)' }}>{testResult.error ?? 'Unknown error'}</span>
            </>
          )}
        </div>
      )}

      {saveMessage.tone !== 'idle' && (
        <div
          style={{
            borderRadius: 8,
            padding: '8px 10px',
            fontSize: 11,
            border: `1px solid ${saveMessage.tone === 'error' ? 'var(--destructive)' : 'var(--accent-mint)'}`,
            color: saveMessage.tone === 'error' ? 'var(--destructive)' : 'var(--foreground)',
            backgroundColor: saveMessage.tone === 'error'
              ? 'color-mix(in srgb, var(--destructive) 13%, var(--card))'
              : 'color-mix(in srgb, var(--accent-mint) 10%, var(--card))',
          }}
        >
          {saveMessage.text}
        </div>
      )}
    </section>
  );
}

function providerStatusLabel({
  provider,
  selected,
  draft,
  hasSubscriptionConfig,
}: {
  provider: PiAiProviderDescriptor;
  selected: boolean;
  draft: ModelSettingsDraft;
  hasSubscriptionConfig: boolean;
}): string {
  if (draft.authMode === 'subscription') {
    if (selected && hasSubscriptionConfig) return 'configured';
    return 'unconfigured';
  }

  if (selected && draft.apiKey.trim()) return 'configured';
  if (provider.environmentKeyName) return `env: ${provider.environmentKeyName}`;
  return 'unconfigured';
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
