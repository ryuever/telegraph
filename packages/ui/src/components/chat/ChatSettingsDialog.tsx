import React, { useEffect, useMemo, useState } from 'react'
import { cn } from '@telegraph/ui/lib/utils'
import {
  MINIMAX_OPENAI_BASE_URL,
  MINIMAX_OPENAI_COMPAT_PROVIDER_ID,
} from '@telegraph/agent'
import {
  CATALOG,
  type ChatModelSettings,
  type EnvModelConfig,
  type ModelConnectionStatus,
  loadEnvModels,
  mergeEnvModelsIntoSettings,
  getDefaultModelFromEnv,
  testModelConnection,
  getProviderOptions,
  getModelOptions,
} from './model-settings'

interface Props {
  open: boolean
  settings: ChatModelSettings
  onClose: () => void
  onSave: (next: ChatModelSettings) => void
}

export function ChatSettingsDialog({ open, settings, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<ChatModelSettings>(settings)
  const [envModels, setEnvModels] = useState<EnvModelConfig[]>([])
  const [connectionStatus, setConnectionStatus] = useState<Map<string, ModelConnectionStatus>>(new Map())
  const [isLoading, setIsLoading] = useState(false)
  const [isTesting, setIsTesting] = useState(false)

  // Load env models on mount
  useEffect(() => {
    if (open) {
      setIsLoading(true)
      loadEnvModels().then(models => {
        setEnvModels(models)
        // Merge env models into settings
        const merged = mergeEnvModelsIntoSettings(settings, models)
        setDraft(merged)
        // Test connections for all env models
        testAllConnections(models, merged)
        setIsLoading(false)
      })
    }
  }, [open, settings])

  // Test all model connections
  const testAllConnections = async (models: EnvModelConfig[], currentSettings: ChatModelSettings) => {
    if (models.length === 0) return
    setIsTesting(true)

    const results = new Map<string, ModelConnectionStatus>()
    await Promise.all(
      models.map(async (model) => {
        // Check if there's a saved key for this provider
        const savedKey = currentSettings.byProvider[model.provider]?.apiKey
        const apiKey = savedKey || model.apiKey
        const baseUrl = currentSettings.byProvider[model.provider]?.baseUrl || model.baseUrl

        if (apiKey) {
          const status = await testModelConnection(
            model.provider,
            model.modelId,
            apiKey,
            baseUrl
          )
          results.set(`${model.provider}:${model.modelId}`, status)
        }
      })
    )

    setConnectionStatus(results)
    setIsTesting(false)
  }

  // Retest connection for current provider
  const testCurrentConnection = async () => {
    const current = draft.byProvider[draft.provider]
    if (!current?.apiKey) return

    setIsTesting(true)
    const status = await testModelConnection(
      draft.provider,
      draft.modelId,
      current.apiKey,
      current.baseUrl
    )
    setConnectionStatus(prev => new Map(prev).set(`${draft.provider}:${draft.modelId}`, status))
    setIsTesting(false)
    return status
  }

  const provider = draft.provider
  const per = draft.byProvider[provider] ?? { apiKey: '', baseUrl: '' }

  const providerOptions = useMemo(() => getProviderOptions(), [])
  const modelOptions = useMemo(() => getModelOptions(provider), [provider])

  // Get connection status for current selection
  const currentStatus = connectionStatus.get(`${provider}:${draft.modelId}`)

  // Get available models from env (those with working connections)
  const availableEnvModels = useMemo(() => {
    return envModels.filter(m => {
      const status = connectionStatus.get(`${m.provider}:${m.modelId}`)
      return status?.connected
    })
  }, [envModels, connectionStatus])

  if (!open) return null

  const setProvider = (next: string) => {
    const firstModel = CATALOG.find(m => m.provider === next)
    const envModel = envModels.find(m => m.provider === next)

    setDraft(d => ({
      ...d,
      provider: next,
      modelId: firstModel?.id ?? d.modelId,
      byProvider: {
        ...d.byProvider,
        [next]: d.byProvider[next] ?? {
          apiKey: envModel?.apiKey ?? '',
          baseUrl: next === MINIMAX_OPENAI_COMPAT_PROVIDER_ID
            ? (envModel?.baseUrl ?? MINIMAX_OPENAI_BASE_URL)
            : envModel?.baseUrl,
        },
      },
    }))
  }

  const setModel = (id: string) => setDraft(d => ({ ...d, modelId: id }))

  const setApiKey = (key: string) =>
    setDraft(d => ({
      ...d,
      byProvider: { ...d.byProvider, [provider]: { ...per, apiKey: key } },
    }))

  const setBaseUrl = (url: string) =>
    setDraft(d => ({
      ...d,
      byProvider: { ...d.byProvider, [provider]: { ...per, baseUrl: url || undefined } },
    }))

  const save = () => {
    onSave(draft)
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <h2 className="text-[13.5px] font-semibold tracking-tight text-zinc-100">
              Chat model settings
            </h2>
            {isTesting && (
              <span className="text-[10px] text-zinc-500 animate-pulse">
                测试中...
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* Available models from .env */}
          {availableEnvModels.length > 0 && (
            <div className="rounded-lg border border-green-900/30 bg-green-950/20 p-3">
              <div className="mb-2 flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-green-500" />
                <span className="text-[11px] font-medium text-green-400">
                  已配置的模型 (来自 .env)
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {availableEnvModels.map(model => {
                  const status = connectionStatus.get(`${model.provider}:${model.modelId}`)
                  const isSelected = draft.provider === model.provider && draft.modelId === model.modelId
                  return (
                    <button
                      key={`${model.provider}:${model.modelId}`}
                      onClick={() => {
                        setProvider(model.provider)
                        setModel(model.modelId)
                      }}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] transition-colors',
                        isSelected
                          ? 'bg-green-600 text-white'
                          : 'bg-green-900/30 text-green-300 hover:bg-green-900/50'
                      )}
                    >
                      <span className={cn('h-1.5 w-1.5 rounded-full', status?.connected ? 'bg-green-400' : 'bg-zinc-500')} />
                      {model.label || `${model.provider} · ${model.modelId}`}
                      {status?.latency && (
                        <span className="text-[10px] opacity-70">({status.latency}ms)</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Provider selection */}
          <Field label="Provider">
            <select
              value={provider}
              onChange={e => setProvider(e.target.value)}
              className={selectClass}
            >
              {providerOptions.map(p => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>

          {/* Model selection */}
          <Field label="Model">
            <div className="flex items-center gap-2">
              <select
                value={draft.modelId}
                onChange={e => setModel(e.target.value)}
                className={cn(selectClass, 'flex-1')}
              >
                {modelOptions.map(m => {
                  const status = connectionStatus.get(`${m.provider}:${m.id}`)
                  return (
                    <option key={m.id} value={m.id}>
                      {m.label} {status?.connected ? '✓' : status?.error ? '✗' : ''}
                    </option>
                  )
                })}
              </select>
              {/* Connection status indicator */}
              {currentStatus && (
                <div className={cn(
                  'flex h-9 items-center gap-1.5 rounded-md px-3 text-[11px]',
                  currentStatus.connected
                    ? 'bg-green-950/50 text-green-400'
                    : 'bg-red-950/50 text-red-400'
                )}>
                  <div className={cn('h-2 w-2 rounded-full', currentStatus.connected ? 'bg-green-500' : 'bg-red-500')} />
                  {currentStatus.connected
                    ? `已连接 (${currentStatus.latency}ms)`
                    : '未连接'
                  }
                </div>
              )}
            </div>
            {currentStatus?.error && (
              <div className="mt-1.5 text-[11px] text-red-400">
                错误: {currentStatus.error}
              </div>
            )}
          </Field>

          {/* API key */}
          <Field label="API key">
            <div className="flex gap-2">
              <input
                type="password"
                value={per.apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={envModels.find(m => m.provider === provider)?.apiKey ? '使用 .env 中的配置' : 'sk-…'}
                className={cn(inputClass, 'flex-1')}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={testCurrentConnection}
                disabled={!per.apiKey || isTesting}
                className={cn(
                  'rounded-md px-3 text-[11px] font-medium transition-colors',
                  !per.apiKey || isTesting
                    ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                    : 'bg-zinc-700 text-zinc-200 hover:bg-zinc-600'
                )}
              >
                测试连接
              </button>
            </div>
            {envModels.find(m => m.provider === provider) && (
              <div className="mt-1.5 text-[11px] text-zinc-500">
                留空以使用 .env 文件中的 API Key
              </div>
            )}
          </Field>

          {/* Base URL for OpenAI compat */}
          {provider === MINIMAX_OPENAI_COMPAT_PROVIDER_ID && (
            <Field
              label="Base URL"
              hint={`Default: ${MINIMAX_OPENAI_BASE_URL}`}
            >
              <input
                type="text"
                value={per.baseUrl ?? ''}
                onChange={e => setBaseUrl(e.target.value)}
                placeholder={MINIMAX_OPENAI_BASE_URL}
                className={inputClass}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 px-5 py-3">
          <div className="flex items-center gap-2">
            {envModels.length > 0 ? (
              <span className="text-[11px] text-zinc-500">
                从 .env 加载了 {envModels.length} 个配置
              </span>
            ) : (
              <span className="text-[11px] text-zinc-600">
                未找到 .env 配置文件
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-[12.5px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              className="rounded-md bg-zinc-100 px-3 py-1.5 text-[12.5px] font-medium text-zinc-900 hover:bg-white"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">
          {label}
        </span>
        {hint && <span className="text-[10.5px] text-zinc-600">{hint}</span>}
      </div>
      {children}
    </label>
  )
}

const inputClass = cn(
  'block w-full rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5',
  'text-[12.5px] text-zinc-100 outline-none transition-colors',
  'placeholder:text-zinc-600 focus:border-zinc-600 focus:bg-zinc-900'
)

const selectClass = cn(inputClass, 'pr-8')
