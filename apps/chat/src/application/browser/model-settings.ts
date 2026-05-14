import {
  DEFAULT_MODEL_CATALOG,
  MINIMAX_CN_PROVIDER_ID,
  type AgentBackendKind,
  type AgentOrchestrationMode,
  type AgentOrchestrationPattern,
  type ModelDescriptor,
} from '@/apps/chat/application/common'
import type { AgentRuntimeSettings } from '@/apps/chat/application/common'

export type { AgentRuntimeSettings, ModelDescriptor }

const STORAGE_KEY = 'telegraph.chat.modelSettings.v2'

export interface ModelSelection {
  provider: string
  modelId: string
  backend: AgentBackendKind
}

export interface OrchestrationSettings {
  orchestration: AgentOrchestrationMode
  orchestrationPattern: AgentOrchestrationPattern
  worktreeIsolation: boolean
}

export interface ExtensionSettings {
  extensionBlocklist: string[]
}

export interface ChatModelSettings
  extends ModelSelection,
    OrchestrationSettings,
    ExtensionSettings {}

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

export async function loadEnvModels(): Promise<EnvModelConfig[]> {
  return []
}

export async function testModelConnection(
  _provider: string,
  _modelId: string,
  _apiKey: string,
  _baseUrl?: string
): Promise<ModelConnectionStatus> {
  return { provider: _provider, modelId: _modelId, connected: false, error: 'Not implemented in pagelet mode' }
}

export function getDefaultModelFromEnv(envModels: EnvModelConfig[]): {
  provider: string
  modelId: string
} | null {
  if (envModels.length === 0) return null
  const first = envModels[0]
  return { provider: first.provider, modelId: first.modelId }
}

export function loadSettings(): ChatModelSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<ChatModelSettings>
    return {
      provider: parsed.provider ?? DEFAULT_SETTINGS.provider,
      modelId: parsed.modelId ?? DEFAULT_SETTINGS.modelId,
      backend: parsed.backend ?? DEFAULT_SETTINGS.backend,
      orchestration: parsed.orchestration ?? DEFAULT_SETTINGS.orchestration,
      orchestrationPattern: parsed.orchestrationPattern ?? DEFAULT_SETTINGS.orchestrationPattern,
      worktreeIsolation: parsed.worktreeIsolation ?? DEFAULT_SETTINGS.worktreeIsolation,
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
  } catch {}
}

export function toRuntimeSettings(
  settings: ChatModelSettings,
  envModels: EnvModelConfig[] = []
): AgentRuntimeSettings {
  const envModel = envModels.find(
    m => m.provider === settings.provider && m.modelId === settings.modelId
  )
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

export function findDescriptor(
  catalog: ModelDescriptor[],
  provider: string,
  modelId: string
): ModelDescriptor | undefined {
  return catalog.find(d => d.provider === provider && d.id === modelId)
}

export const CATALOG: ModelDescriptor[] = DEFAULT_MODEL_CATALOG

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

export function getModelOptions(provider: string) {
  return CATALOG.filter(m => m.provider === provider)
}
