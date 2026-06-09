import { getEnvApiKey, getModels, getProviders, type Api, type Model } from '@mariozechner/pi-ai'
import { getOAuthApiKey, type OAuthCredentials } from '@mariozechner/pi-ai/oauth'
import type { AgentRuntimeSettings } from '@/packages/agent/types'
import {
  getProjectModelFileConfig,
  getProjectProviderFileConfig,
  getProjectProviderStatus,
  getProjectEnvPath,
  getProjectLocalEnvPath,
  listProjectConfiguredModels,
  readProjectRuntimeSettings,
  readProjectRuntimeSettingsWithDesignSystem,
  resolveProjectConfigValue,
  writeProjectRuntimeSettings,
  type ProjectConfiguredModelDescriptor,
  type ProjectCredentialSource,
  type ProjectProviderFileConfig,
  type ProjectProviderStatus,
} from '@/packages/agent/runtime/project-agent-config'

export type PiAiCredentialSource = ProjectCredentialSource | 'subscription-settings'

export interface PiAiResolvedApiKey {
  apiKey: string
  authMode: 'api-key' | 'subscription'
  source: PiAiCredentialSource
  refreshedSubscriptionCredentials?: OAuthCredentials
}

export type PiAiAuthStatus = ProjectProviderStatus
export type PiAiConfiguredModelDescriptor = ProjectConfiguredModelDescriptor
export type PiAiProviderFileConfig = ProjectProviderFileConfig

export interface PiAiModelFileConfig extends PiAiProviderFileConfig {
  id: string
  name?: string
  reasoning?: boolean
  input?: Array<'text' | 'image'>
  contextWindow?: number
  maxTokens?: number
}

const DEFAULT_CONTEXT_WINDOW = 128_000
const DEFAULT_MAX_TOKENS = 8192

export function getPiProviderFileConfig(provider: string): PiAiProviderFileConfig {
  return getProjectProviderFileConfig(provider)
}

export function getPiModelFileConfig(
  provider: string,
  modelId: string,
): PiAiModelFileConfig | undefined {
  return getProjectModelFileConfig(provider, modelId)
}

export function resolvePiModelFromFiles(settings: AgentRuntimeSettings): Model<Api> | undefined {
  const modelConfig = getPiModelFileConfig(settings.provider, settings.modelId)
  if (!modelConfig) return undefined

  return {
    id: modelConfig.id,
    name: modelConfig.name ?? modelConfig.id,
    api: modelConfig.api ?? 'openai-completions',
    provider: settings.provider,
    baseUrl: modelConfig.baseUrl ?? settings.baseUrl ?? '',
    reasoning: modelConfig.reasoning ?? false,
    input: modelConfig.input ?? ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: modelConfig.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: modelConfig.maxTokens ?? DEFAULT_MAX_TOKENS,
  } as unknown as Model<Api>
}

export function applyPiModelOverridesFromFiles(
  settings: AgentRuntimeSettings,
  model: Model<Api>,
): Model<Api> {
  const providerConfig = getPiProviderFileConfig(settings.provider)
  const modelConfig = getPiModelFileConfig(settings.provider, settings.modelId)
  return {
    ...model,
    api: modelConfig?.api ?? providerConfig.api ?? model.api,
    baseUrl: settings.baseUrl ?? modelConfig?.baseUrl ?? providerConfig.baseUrl ?? model.baseUrl,
    name: modelConfig?.name ?? model.name,
  } as unknown as Model<Api>
}

export function getPiAuthStatus(provider: string): PiAiAuthStatus {
  return getProjectProviderStatus(provider)
}

export async function listPiConfiguredModels(): Promise<PiAiConfiguredModelDescriptor[]> {
  const projectModels = listProjectConfiguredModels()
  const projectModelKeys = new Set(projectModels.map(model => `${model.provider}/${model.id}`))
  const configuredModels = [...projectModels]

  for (const provider of safeGetProviders()) {
    const auth = getPiAuthStatus(provider)
    if (!auth.configured) continue
    for (const model of safeGetModels(provider)) {
      if (!model.id) continue
      const key = `${provider}/${model.id}`
      if (projectModelKeys.has(key)) continue
      configuredModels.push({
        provider,
        id: model.id,
        label: model.name ?? model.id,
        api: model.api,
        baseUrl: model.baseUrl,
        authConfigured: true,
        authSource: auth.source,
        authLabel: auth.label,
      })
    }
  }

  return configuredModels.sort((a, b) => {
    const providerOrder = a.provider.localeCompare(b.provider)
    return providerOrder === 0 ? a.id.localeCompare(b.id) : providerOrder
  })
}

export async function resolvePiAiApiKey(settings: AgentRuntimeSettings): Promise<PiAiResolvedApiKey> {
  const runtimeApiKey = await resolveProjectConfigValue(settings.apiKey)
  if (runtimeApiKey) {
    return { apiKey: runtimeApiKey, authMode: 'api-key', source: 'runtime' }
  }

  const fromSubscriptionSettings = await resolveSubscriptionSettingsApiKey(settings)
  if (fromSubscriptionSettings) return fromSubscriptionSettings

  const providerConfig = getPiProviderFileConfig(settings.provider)
  if (providerConfig.apiKey?.trim()) {
    const apiKey = await resolveProjectConfigValue(providerConfig.apiKey)
    if (apiKey) return { apiKey, authMode: 'api-key', source: 'project-config' }
  }

  const envKey = (getEnvApiKey as unknown as (provider: string) => string | undefined)(settings.provider)
  if (envKey?.trim()) {
    return { apiKey: envKey.trim(), authMode: 'api-key', source: 'env' }
  }

  throw new Error(
    `Chat model settings are required: no API key found for provider "${settings.provider}". Configure ${getProjectLocalEnvPath()} or ${getProjectEnvPath()}.`,
  )
}

export {
  getProjectEnvPath,
  getProjectLocalEnvPath,
  listProjectConfiguredModels,
  readProjectRuntimeSettings,
  readProjectRuntimeSettingsWithDesignSystem,
  writeProjectRuntimeSettings,
}

async function resolveSubscriptionSettingsApiKey(
  settings: AgentRuntimeSettings,
): Promise<PiAiResolvedApiKey | undefined> {
  if (settings.authMode !== 'subscription') return undefined
  const providerId = (settings.subscriptionProvider ?? settings.provider).trim()
  const credentials = toOAuthCredentials(settings.subscriptionCredentials)
  if (!providerId || !credentials) return undefined

  const oauthResult = await getOAuthApiKey(providerId, {
    [providerId]: credentials,
  })
  if (!oauthResult?.apiKey.trim()) return undefined
  return {
    apiKey: oauthResult.apiKey.trim(),
    authMode: 'subscription',
    source: 'subscription-settings',
    refreshedSubscriptionCredentials: oauthResult.newCredentials,
  }
}

function toOAuthCredentials(value: unknown): OAuthCredentials | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (
    typeof record.refresh !== 'string' ||
    typeof record.access !== 'string' ||
    typeof record.expires !== 'number'
  ) {
    return undefined
  }
  return {
    ...record,
    refresh: record.refresh,
    access: record.access,
    expires: record.expires,
  }
}

function safeGetProviders(): string[] {
  try {
    return getProviders()
  } catch {
    return []
  }
}

function safeGetModels(provider: string): Array<{ id?: string; name?: string; api?: string; baseUrl?: string }> {
  try {
    return (getModels as unknown as (provider: string) => Array<{ id?: string; name?: string; api?: string; baseUrl?: string }>)(provider)
  } catch {
    return []
  }
}
