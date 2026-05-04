import {
  DEFAULT_MODEL_CATALOG,
  MINIMAX_CN_PROVIDER_ID,
  MINIMAX_OPENAI_BASE_URL,
  MINIMAX_OPENAI_COMPAT_PROVIDER_ID,
  MINIMAX_PROVIDER_ID,
  type AgentRuntimeSettings,
  type ModelDescriptor,
} from '@telegraph/agent'

export type { AgentRuntimeSettings, ModelDescriptor }

const STORAGE_KEY = 'telegraph.chat.modelSettings.v1'

export interface PerProviderSettings {
  apiKey: string
  /** Only honored by `minimax-openai-compat`; pi-ai's first-class providers carry their own baseUrl. */
  baseUrl?: string
}

export interface ChatModelSettings {
  provider: string
  modelId: string
  /** Per-provider creds keyed by provider id, so switching providers keeps each one's setup. */
  byProvider: Record<string, PerProviderSettings>
}

export interface EnvModelConfig {
  provider: string
  modelId: string
  apiKey: string
  baseUrl?: string
  label?: string
  isAvailable: boolean
}

export interface ModelConnectionStatus {
  provider: string
  modelId: string
  connected: boolean
  latency?: number
  error?: string
}

export const DEFAULT_SETTINGS: ChatModelSettings = {
  provider: MINIMAX_CN_PROVIDER_ID,
  modelId: 'MiniMax-M2.7',
  byProvider: {},
}

/**
 * Load available models from .env via main process
 */
export async function loadEnvModels(): Promise<EnvModelConfig[]> {
  if (typeof window === 'undefined') return []
  try {
    return await window.telegraph.modelConfig.getAvailableModels()
  } catch (err) {
    console.error('[ModelSettings] Failed to load env models:', err)
    return []
  }
}

/**
 * Test connection to a specific model
 */
export async function testModelConnection(
  provider: string,
  modelId: string,
  apiKey: string,
  baseUrl?: string
): Promise<ModelConnectionStatus> {
  if (typeof window === 'undefined') {
    return { provider, modelId, connected: false, error: 'Not in browser' }
  }
  try {
    const result = await window.telegraph.modelConfig.testModel({
      provider,
      modelId,
      apiKey,
      baseUrl,
    })
    return {
      provider: result.provider,
      modelId: result.modelId,
      connected: result.success,
      latency: result.latency,
      error: result.error,
    }
  } catch (err) {
    return {
      provider,
      modelId,
      connected: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Merge env models into settings - adds env models to byProvider if not already set
 */
export function mergeEnvModelsIntoSettings(
  settings: ChatModelSettings,
  envModels: EnvModelConfig[]
): ChatModelSettings {
  const byProvider = { ...settings.byProvider }

  for (const envModel of envModels) {
    // Only set if this provider doesn't already have a key set
    if (!byProvider[envModel.provider]?.apiKey) {
      byProvider[envModel.provider] = {
        apiKey: envModel.apiKey,
        baseUrl: envModel.baseUrl,
      }
    }
  }

  return {
    ...settings,
    byProvider,
  }
}

/**
 * Get the first available model from env config as default
 */
export function getDefaultModelFromEnv(envModels: EnvModelConfig[]): {
  provider: string
  modelId: string
} | null {
  if (envModels.length === 0) return null

  const first = envModels[0]
  return {
    provider: first.provider,
    modelId: first.modelId,
  }
}

export function loadSettings(): ChatModelSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_SETTINGS
    }
    const parsed = JSON.parse(raw) as Partial<ChatModelSettings>
    return {
      provider: parsed.provider ?? DEFAULT_SETTINGS.provider,
      modelId: parsed.modelId ?? DEFAULT_SETTINGS.modelId,
      byProvider: { ...DEFAULT_SETTINGS.byProvider, ...(parsed.byProvider ?? {}) },
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: ChatModelSettings) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* swallow — quota / disabled storage isn't fatal */
  }
}

export function toRuntimeSettings(settings: ChatModelSettings): AgentRuntimeSettings {
  const per = settings.byProvider[settings.provider] ?? { apiKey: '' }
  return {
    provider: settings.provider,
    modelId: settings.modelId,
    apiKey: per.apiKey,
    baseUrl: per.baseUrl,
  }
}

export function findDescriptor(
  catalog: ModelDescriptor[],
  provider: string,
  modelId: string
): ModelDescriptor | undefined {
  return catalog.find(d => d.provider === provider && d.id === modelId)
}

export const CATALOG: ModelDescriptor[] = DEFAULT_MODEL_CATALOG

/**
 * Get all unique providers from the catalog
 */
export function getProviderOptions() {
  const seen = new Set<string>()
  const list: { id: string; label: string }[] = []
  for (const m of CATALOG) {
    if (seen.has(m.provider)) continue
    seen.add(m.provider)
    list.push({ id: m.provider, label: m.provider })
  }
  return list
}

/**
 * Get models for a specific provider
 */
export function getModelOptions(provider: string) {
  return CATALOG.filter(m => m.provider === provider)
}
