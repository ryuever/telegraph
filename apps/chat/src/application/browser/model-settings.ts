import {
  DEFAULT_MODEL_CATALOG,
  MINIMAX_CN_PROVIDER_ID,
  type AgentBackendKind,
  type AgentOrchestrationMode,
  type AgentOrchestrationPattern,
  type ChatConfiguredModelDescriptorSnapshot,
  type ModelDescriptor,
} from '@/apps/chat/application/common'
import type { AgentRuntimeSettings } from '@/apps/chat/application/common'
import type { RuntimeTaskCapabilityProfile } from '@/packages/agent-protocol'

export type { AgentRuntimeSettings, ModelDescriptor }

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
  taskCapabilityProfile: RuntimeTaskCapabilityProfile
}

export interface ApiKeySettings {
  apiKey: string
  baseUrl?: string
}

export interface ProviderAuthSettings {
  authMode: 'api-key' | 'subscription'
  subscriptionProvider?: string
  subscriptionCredentials?: {
    refresh: string
    access: string
    expires: number
    [key: string]: unknown
  }
}

export interface ChatModelSettings
  extends ModelSelection,
    OrchestrationSettings,
    ExtensionSettings,
    ApiKeySettings,
    ProviderAuthSettings {}

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
  taskCapabilityProfile: { kind: 'default' },
}

export const DEFAULT_API_KEY: ApiKeySettings = {
  apiKey: '',
  baseUrl: undefined,
}

export const DEFAULT_PROVIDER_AUTH: ProviderAuthSettings = {
  authMode: 'api-key',
  subscriptionProvider: undefined,
  subscriptionCredentials: undefined,
}

export const DEFAULT_SETTINGS: ChatModelSettings = {
  ...DEFAULT_MODEL_SELECTION,
  ...DEFAULT_ORCHESTRATION,
  ...DEFAULT_EXTENSION,
  ...DEFAULT_API_KEY,
  ...DEFAULT_PROVIDER_AUTH,
}

export function loadEnvModels(): EnvModelConfig[] {
  return []
}

export function testModelConnection(
  _provider: string,
  _modelId: string,
  _apiKey: string,
  _baseUrl?: string
): ModelConnectionStatus {
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
  return DEFAULT_SETTINGS
}

export function toRuntimeSettings(
  settings: ChatModelSettings,
  _envModels: EnvModelConfig[] = []
): AgentRuntimeSettings {
  return {
    provider: settings.provider,
    modelId: settings.modelId,
    apiKey: '',
    authMode: settings.authMode,
    subscriptionProvider: settings.subscriptionProvider,
    subscriptionCredentials: undefined,
    baseUrl: undefined,
    backend: normalizeBackend(settings.backend),
    orchestration: settings.orchestration,
    orchestrationPattern: settings.orchestrationPattern,
    worktreeIsolation: settings.worktreeIsolation,
    extensionBlocklist:
      settings.extensionBlocklist.length > 0 ? [...settings.extensionBlocklist] : undefined,
    taskCapabilityProfile: settings.taskCapabilityProfile,
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

export function getConfiguredProviderOptions(models: ChatConfiguredModelDescriptorSnapshot[]) {
  const seen = new Set<string>()
  const list: { id: string; label: string; authLabel?: string }[] = []
  for (const model of models) {
    if (seen.has(model.provider)) continue
    seen.add(model.provider)
    list.push({
      id: model.provider,
      label: model.provider,
      authLabel: model.authLabel,
    })
  }
  return list
}

export function getConfiguredModelOptions(
  provider: string,
  models: ChatConfiguredModelDescriptorSnapshot[]
) {
  return models.filter(model => model.provider === provider)
}

function normalizeBackend(value: unknown): AgentBackendKind {
  if (
    value === 'pi-ai' ||
    value === 'pi-cli' ||
    value === 'pi-embedded' ||
    value === 'telegraph-subagents' ||
    value === 'langgraph' ||
    value === 'vercel-ai'
  ) {
    return value
  }
  return DEFAULT_SETTINGS.backend
}
