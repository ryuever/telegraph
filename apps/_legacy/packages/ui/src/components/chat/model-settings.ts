import {
  DEFAULT_MODEL_CATALOG,
  MINIMAX_CN_PROVIDER_ID,
  type AgentBackendKind,
  type AgentOrchestrationMode,
  type AgentOrchestrationPattern,
  type AgentRuntimeSettings,
  type ModelDescriptor,
} from '@telegraph/agent'

export type { AgentRuntimeSettings, ModelDescriptor }

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'telegraph.chat.modelSettings.v2'

// ---------------------------------------------------------------------------
// Separated settings concerns
// ---------------------------------------------------------------------------

/** Which provider + model to use. */
export interface ModelSelection {
  provider: string
  modelId: string
  /** Execution backend selector. */
  backend: AgentBackendKind
}

/** Multi-agent orchestration configuration. */
export interface OrchestrationSettings {
  orchestration: AgentOrchestrationMode
  orchestrationPattern: AgentOrchestrationPattern
  worktreeIsolation: boolean
}

/** Extension-level overrides. */
export interface ExtensionSettings {
  /** Blocklisted extension capability ids (merged with `~/.telegraph/extension-registry.json`). */
  extensionBlocklist: string[]
}

/** Unified settings stored in localStorage — composed from the three concerns above. */
export interface ChatModelSettings
  extends ModelSelection,
    OrchestrationSettings,
    ExtensionSettings {}

// ---------------------------------------------------------------------------
// Env model types (read-only from main process .env)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_MODEL_SELECTION: ModelSelection = {
  provider: MINIMAX_CN_PROVIDER_ID,
  modelId: 'MiniMax-M2.7',
  backend: 'pi-ai',
}

export const DEFAULT_ORCHESTRATION: OrchestrationSettings = {
  orchestration: 'none',
  orchestrationPattern: 'chain',
  worktreeIsolation: false,
}

export const DEFAULT_EXTENSION: ExtensionSettings = {
  extensionBlocklist: [],
}

export const DEFAULT_SETTINGS: ChatModelSettings = {
  ...DEFAULT_MODEL_SELECTION,
  ...DEFAULT_ORCHESTRATION,
  ...DEFAULT_EXTENSION,
}

// ---------------------------------------------------------------------------
// Env model helpers (credentials managed by main process, not renderer)
// ---------------------------------------------------------------------------

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
 * Test connection to a specific model (delegates to main process which holds the key)
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
 * Pick the first available model from env config as default selection.
 */
export function getDefaultModelFromEnv(envModels: EnvModelConfig[]): {
  provider: string
  modelId: string
} | null {
  if (envModels.length === 0) return null
  const first = envModels[0]
  return { provider: first.provider, modelId: first.modelId }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function loadSettings(): ChatModelSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<ChatModelSettings>
    return {
      // ModelSelection
      provider: parsed.provider ?? DEFAULT_SETTINGS.provider,
      modelId: parsed.modelId ?? DEFAULT_SETTINGS.modelId,
      backend: parsed.backend ?? DEFAULT_SETTINGS.backend,
      // OrchestrationSettings
      orchestration: parsed.orchestration ?? DEFAULT_SETTINGS.orchestration,
      orchestrationPattern: parsed.orchestrationPattern ?? DEFAULT_SETTINGS.orchestrationPattern,
      worktreeIsolation: parsed.worktreeIsolation ?? DEFAULT_SETTINGS.worktreeIsolation,
      // ExtensionSettings
      extensionBlocklist: Array.isArray(parsed.extensionBlocklist)
        ? parsed.extensionBlocklist
        : DEFAULT_SETTINGS.extensionBlocklist,
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

// ---------------------------------------------------------------------------
// Conversion to runtime settings
// ---------------------------------------------------------------------------

/**
 * Build `AgentRuntimeSettings` consumed by the main-process agent service.
 *
 * API key / baseUrl are **not** included — the main process resolves credentials
 * from its own env / secure store. The renderer only communicates the selection.
 */
export function toRuntimeSettings(
  settings: ChatModelSettings,
  envModels: EnvModelConfig[] = []
): AgentRuntimeSettings {
  // Look up credentials from env models (sourced from main process)
  const envModel = envModels.find(
    m => m.provider === settings.provider && m.modelId === settings.modelId
  )
  // Fallback: try matching just provider
  const envProviderFallback = envModels.find(m => m.provider === settings.provider)
  const env = envModel ?? envProviderFallback

  return {
    provider: settings.provider,
    modelId: settings.modelId,
    apiKey: env?.apiKey ?? '',
    baseUrl: env?.baseUrl,
    backend: settings.backend,
    orchestration: settings.orchestration,
    orchestrationPattern: settings.orchestrationPattern,
    worktreeIsolation: settings.worktreeIsolation,
    extensionBlocklist:
      settings.extensionBlocklist.length > 0 ? [...settings.extensionBlocklist] : undefined,
  }
}

// ---------------------------------------------------------------------------
// Catalog helpers
// ---------------------------------------------------------------------------

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
