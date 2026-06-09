import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { RuntimeSettings, RuntimeTaskCapabilityProfile } from '@/packages/agent-protocol'
import { resolveTelegraphWorkspaceRoot } from '@/packages/agent/persistence/telegraphPaths'

export type ProjectCredentialSource = 'runtime' | 'project-config' | 'env'

export interface ProjectConfiguredModelDescriptor {
  provider: string
  id: string
  label: string
  api?: string
  baseUrl?: string
  authConfigured: boolean
  authSource?: ProjectCredentialSource
  authLabel?: string
}

export interface ProjectProviderStatus {
  configured: boolean
  source?: ProjectCredentialSource
  label?: string
}

export interface ProjectProviderFileConfig {
  name?: string
  baseUrl?: string
  api?: string
  apiKey?: string
}

export interface ProjectModelFileConfig extends ProjectProviderFileConfig {
  id: string
  name?: string
  reasoning?: boolean
  input?: Array<'text' | 'image'>
  contextWindow?: number
  maxTokens?: number
}

interface ProjectEnvRuntimeConfig {
  provider?: string
  modelId?: string
  authMode?: 'api-key' | 'subscription'
  subscriptionProvider?: string
  subscriptionCredentials?: RuntimeSettings['subscriptionCredentials']
  baseUrl?: string
  backend?: string
  orchestration?: string
  orchestrationPattern?: string
  worktreeIsolation?: boolean
  extensionBlocklist?: string[]
  taskCapabilityProfile?: RuntimeTaskCapabilityProfile
}

interface ProjectEnvProviderConfig {
  name?: string
  baseUrl?: string
  api?: string
  apiKeyEnv?: string
  apiKey?: string
  models?: ProjectModelFileConfig[]
}

interface ProjectEnvObjectConfig {
  runtime: ProjectEnvRuntimeConfig
  providers: Record<string, ProjectEnvProviderConfig>
  designSystem: {
    themePackId?: string
  }
}

type DotEnvValues = Record<string, string>

const DEFAULT_CONTEXT_WINDOW = 128_000
const DEFAULT_MAX_TOKENS = 16_384
const DEFAULT_PROVIDER = 'zai'
const DEFAULT_MODEL_ID = 'glm-5.1'
const DEFAULT_MODEL_LABEL = 'GLM-5.1'
const DEFAULT_BASE_URL = 'https://api.z.ai/api/coding/paas/v4'
const DEFAULT_API = 'openai-completions'
const DEFAULT_THEME_PACK_ID = 'shadcn-new-york-neutral'

const RUNTIME_CONFIG_KEY = 'TELEGRAPH_AGENT_RUNTIME'
const PROVIDERS_CONFIG_KEY = 'TELEGRAPH_AGENT_PROVIDERS'
const DESIGN_SYSTEM_CONFIG_KEY = 'TELEGRAPH_DESIGN_SYSTEM'

const LEGACY_AGENT_ENV_KEYS = [
  'TELEGRAPH_AGENT_PROVIDER',
  'TELEGRAPH_AGENT_MODEL',
  'TELEGRAPH_AGENT_MODEL_LABEL',
  'TELEGRAPH_AGENT_AUTH_MODE',
  'TELEGRAPH_AGENT_BASE_URL',
  'TELEGRAPH_AGENT_API',
  'TELEGRAPH_AGENT_API_KEY_ENV',
  'TELEGRAPH_AGENT_BACKEND',
  'TELEGRAPH_AGENT_ORCHESTRATION',
  'TELEGRAPH_AGENT_ORCHESTRATION_PATTERN',
  'TELEGRAPH_AGENT_WORKTREE_ISOLATION',
  'TELEGRAPH_AGENT_EXTENSION_BLOCKLIST',
  'TELEGRAPH_AGENT_TASK_CAPABILITY_PROFILE',
  'TELEGRAPH_AGENT_MODEL_REASONING',
  'TELEGRAPH_AGENT_CONTEXT_WINDOW',
  'TELEGRAPH_AGENT_MAX_TOKENS',
  'TELEGRAPH_DESIGN_THEME_PACK_ID',
]

export const DEFAULT_RUNTIME_SETTINGS = {
  provider: DEFAULT_PROVIDER,
  modelId: DEFAULT_MODEL_ID,
  apiKey: '',
  authMode: 'api-key',
  backend: 'pi-ai',
  orchestration: 'none',
  orchestrationPattern: 'chain',
  worktreeIsolation: false,
  extensionBlocklist: [],
  taskCapabilityProfile: { kind: 'default' },
} satisfies RuntimeSettings & {
  provider: string
  modelId: string
  apiKey: string
  authMode: 'api-key'
  backend: string
  orchestration: string
  orchestrationPattern: string
  worktreeIsolation: boolean
  extensionBlocklist: string[]
  taskCapabilityProfile: RuntimeTaskCapabilityProfile
}

export function getProjectEnvPath(startDir = process.cwd()): string {
  return join(resolveTelegraphWorkspaceRoot(startDir), '.env')
}

export function getProjectLocalEnvPath(startDir = process.cwd()): string {
  return join(resolveTelegraphWorkspaceRoot(startDir), '.env.local')
}

export function readProjectEnvValues(): DotEnvValues {
  return {
    ...readDotEnvFile(getProjectEnvPath()),
    ...readDotEnvFile(getProjectLocalEnvPath()),
    ...definedProcessEnv(),
  }
}

export function readProjectRuntimeSettings(): RuntimeSettings {
  const projectConfig = readProjectObjectConfig()
  const runtime = normalizeRuntimeSettings(projectConfig.runtime as Record<string, unknown>)
  const providerConfig = projectConfig.providers[runtime.provider ?? DEFAULT_PROVIDER]
  return {
    ...runtime,
    baseUrl: runtime.baseUrl ?? providerConfig?.baseUrl,
  }
}

export function readProjectRuntimeSettingsWithDesignSystem(): RuntimeSettings & {
  designSystem?: Record<string, unknown>
} {
  const projectConfig = readProjectObjectConfig()
  return {
    ...readProjectRuntimeSettings(),
    designSystem: {
      themePackId: projectConfig.designSystem.themePackId ?? DEFAULT_THEME_PACK_ID,
    },
  }
}

export async function writeProjectRuntimeSettings(settings: RuntimeSettings): Promise<void> {
  const projectConfig = readProjectObjectConfig()
  const normalized = normalizeRuntimeSettings(settings as Record<string, unknown>)
  projectConfig.runtime = {
    ...projectConfig.runtime,
    provider: normalized.provider ?? DEFAULT_RUNTIME_SETTINGS.provider,
    modelId: normalized.modelId ?? DEFAULT_RUNTIME_SETTINGS.modelId,
    authMode: normalized.authMode,
    subscriptionProvider: normalized.subscriptionProvider,
    subscriptionCredentials: normalized.subscriptionCredentials,
    baseUrl: normalized.baseUrl,
    backend: normalized.backend,
    orchestration: normalized.orchestration,
    orchestrationPattern: normalized.orchestrationPattern ?? DEFAULT_RUNTIME_SETTINGS.orchestrationPattern,
    worktreeIsolation: normalized.worktreeIsolation,
    extensionBlocklist: normalized.extensionBlocklist,
    taskCapabilityProfile: normalized.taskCapabilityProfile,
  }

  const provider = projectConfig.runtime.provider ?? DEFAULT_PROVIDER
  const providerConfig = ensureProviderConfig(projectConfig, provider)
  if (normalized.baseUrl?.trim()) providerConfig.baseUrl = normalized.baseUrl.trim()

  const designSystem = (settings as { designSystem?: { themePackId?: unknown } }).designSystem
  if (typeof designSystem?.themePackId === 'string' && designSystem.themePackId.trim()) {
    projectConfig.designSystem.themePackId = designSystem.themePackId.trim()
  }

  await writeProjectObjectConfig(projectConfig)
}

export function getProjectProviderFileConfig(provider: string): ProjectProviderFileConfig {
  const providerId = provider.trim()
  if (!providerId) return {}
  const projectConfig = readProjectObjectConfig()
  const providerConfig = projectConfig.providers[providerId]
  if (!providerConfig) return providerId === DEFAULT_PROVIDER ? defaultProviderFileConfig(providerId) : {}
  const apiKey = providerConfig.apiKeyEnv
    ? `env:${providerConfig.apiKeyEnv}`
    : providerConfig.apiKey
  return {
    name: providerConfig.name,
    baseUrl: providerConfig.baseUrl,
    api: providerConfig.api,
    apiKey,
  }
}

export function getProjectModelFileConfig(
  provider: string,
  modelId: string,
): ProjectModelFileConfig | undefined {
  const providerId = provider.trim()
  const id = modelId.trim()
  if (!providerId || !id) return undefined

  const projectConfig = readProjectObjectConfig()
  const providerConfig = projectConfig.providers[providerId]
  const configuredModel = providerConfig?.models?.find(model => model.id === id)
  if (configuredModel) {
    return {
      ...configuredModel,
      api: configuredModel.api ?? providerConfig?.api,
      baseUrl: configuredModel.baseUrl ?? providerConfig?.baseUrl,
      apiKey: configuredModel.apiKey ?? providerConfigFileApiKey(providerConfig),
    }
  }

  if (projectConfig.runtime.provider !== providerId || projectConfig.runtime.modelId !== id) return undefined
  const fallbackProviderConfig = providerConfig ?? defaultProviderObjectConfig(providerId)
  return {
    id,
    name: id === DEFAULT_MODEL_ID ? DEFAULT_MODEL_LABEL : id,
    api: fallbackProviderConfig.api,
    baseUrl: fallbackProviderConfig.baseUrl,
    apiKey: providerConfigFileApiKey(fallbackProviderConfig),
    reasoning: id === DEFAULT_MODEL_ID,
    input: ['text'],
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
  }
}

export function listProjectConfiguredModels(): ProjectConfiguredModelDescriptor[] {
  const projectConfig = readProjectObjectConfig()
  const descriptors: ProjectConfiguredModelDescriptor[] = []
  for (const [provider, providerConfig] of Object.entries(projectConfig.providers)) {
    const auth = getProjectProviderStatus(provider)
    for (const model of providerConfig.models ?? []) {
      descriptors.push({
        provider,
        id: model.id,
        label: model.name ?? model.id,
        api: model.api ?? providerConfig.api,
        baseUrl: model.baseUrl ?? providerConfig.baseUrl,
        authConfigured: auth.configured,
        authSource: auth.source,
        authLabel: auth.label,
      })
    }
  }
  return descriptors
}

export function getProjectProviderStatus(provider: string): ProjectProviderStatus {
  const projectConfig = readProjectObjectConfig()
  const providerConfig = projectConfig.providers[provider.trim()]
  if (!providerConfig) return { configured: false }

  const envName = providerConfig.apiKeyEnv
  if (envName) {
    const envValue = resolveProjectEnvValue(envName)
    return {
      configured: Boolean(envValue?.trim()),
      source: envValue?.trim() ? 'env' : 'project-config',
      label: 'configured',
    }
  }

  if (providerConfig.apiKey?.trim()) {
    return { configured: true, source: 'project-config', label: 'configured' }
  }

  return { configured: false }
}

export async function upsertProjectProviderConfig(input: {
  provider: string
  baseUrl?: string
  api?: string
  apiKey?: string
}): Promise<void> {
  const provider = input.provider.trim()
  if (!provider) throw new Error('provider is required.')

  const projectConfig = readProjectObjectConfig()
  const providerConfig = ensureProviderConfig(projectConfig, provider)
  providerConfig.name = providerConfig.name ?? defaultProviderDisplayName(provider)
  providerConfig.baseUrl = input.baseUrl?.trim() || providerConfig.baseUrl || defaultBaseUrl(provider)
  providerConfig.api = input.api?.trim() || providerConfig.api || DEFAULT_API

  const envName = input.apiKey ? envReferenceName(input.apiKey) : undefined
  if (envName) {
    providerConfig.apiKeyEnv = envName
    delete providerConfig.apiKey
  } else if (input.apiKey?.trim()) {
    providerConfig.apiKey = input.apiKey.trim()
    delete providerConfig.apiKeyEnv
  } else {
    providerConfig.apiKeyEnv = providerConfig.apiKeyEnv ?? defaultApiKeyEnvName(provider)
  }

  projectConfig.runtime.provider = provider
  projectConfig.runtime.authMode = projectConfig.runtime.authMode ?? 'api-key'
  projectConfig.runtime.baseUrl = providerConfig.baseUrl
  await writeProjectObjectConfig(projectConfig)
}

export async function upsertProjectModelConfig(input: {
  provider: string
  modelId: string
  modelLabel?: string
  api?: string
  baseUrl?: string
}): Promise<void> {
  const provider = input.provider.trim()
  const modelId = input.modelId.trim()
  if (!provider || !modelId) throw new Error('provider and modelId are required.')

  const projectConfig = readProjectObjectConfig()
  const providerConfig = ensureProviderConfig(projectConfig, provider)
  providerConfig.name = providerConfig.name ?? defaultProviderDisplayName(provider)
  providerConfig.baseUrl = input.baseUrl?.trim() || providerConfig.baseUrl || defaultBaseUrl(provider)
  providerConfig.api = input.api?.trim() || providerConfig.api || DEFAULT_API

  const models = providerConfig.models ?? []
  const existingIndex = models.findIndex(model => model.id === modelId)
  const nextModel: ProjectModelFileConfig = {
    ...(existingIndex >= 0 ? models[existingIndex] : {}),
    id: modelId,
    name: input.modelLabel?.trim() || models[existingIndex]?.name || modelId,
    api: input.api?.trim() || models[existingIndex]?.api || providerConfig.api,
    baseUrl: input.baseUrl?.trim() || models[existingIndex]?.baseUrl || providerConfig.baseUrl,
    reasoning: models[existingIndex]?.reasoning ?? (modelId === DEFAULT_MODEL_ID),
    input: models[existingIndex]?.input ?? ['text'],
    contextWindow: models[existingIndex]?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: models[existingIndex]?.maxTokens ?? DEFAULT_MAX_TOKENS,
  }
  if (existingIndex >= 0) models[existingIndex] = nextModel
  else models.push(nextModel)
  providerConfig.models = models

  projectConfig.runtime.provider = provider
  projectConfig.runtime.modelId = modelId
  projectConfig.runtime.baseUrl = providerConfig.baseUrl
  await writeProjectObjectConfig(projectConfig)
}

export async function writeProjectLocalEnvValue(name: string, value: string): Promise<void> {
  const normalizedName = normalizeEnvName(name)
  if (!normalizedName) throw new Error('env variable name is required.')
  await writeProjectLocalEnvValues({ [normalizedName]: value })
}

export async function writeProjectLocalEnvValues(updates: DotEnvValues): Promise<void> {
  await writeProjectLocalEnvValuesInternal(updates, [])
}

export function normalizeRuntimeSettings(parsed: Record<string, unknown>): RuntimeSettings {
  const str = (value: unknown, fallback: string): string => typeof value === 'string' && value.trim() ? value : fallback
  const bool = (value: unknown, fallback: boolean): boolean => typeof value === 'boolean' ? value : fallback
  const authMode = parsed.authMode === 'subscription' ? 'subscription' : 'api-key'
  const subscriptionProvider = stringOrUndefined(parsed.subscriptionProvider)
  const subscriptionCredentials = normalizeSubscriptionCredentials(parsed.subscriptionCredentials)

  return {
    provider: str(parsed.provider, DEFAULT_RUNTIME_SETTINGS.provider),
    modelId: str(parsed.modelId, DEFAULT_RUNTIME_SETTINGS.modelId),
    apiKey: '',
    authMode,
    subscriptionProvider: authMode === 'subscription'
      ? (subscriptionProvider ?? str(parsed.provider, DEFAULT_RUNTIME_SETTINGS.provider))
      : undefined,
    subscriptionCredentials: authMode === 'subscription' ? subscriptionCredentials : undefined,
    baseUrl: stringOrUndefined(parsed.baseUrl),
    backend: str(parsed.backend, DEFAULT_RUNTIME_SETTINGS.backend),
    orchestration: str(parsed.orchestration, DEFAULT_RUNTIME_SETTINGS.orchestration),
    orchestrationPattern: str(parsed.orchestrationPattern, DEFAULT_RUNTIME_SETTINGS.orchestrationPattern),
    worktreeIsolation: bool(parsed.worktreeIsolation, DEFAULT_RUNTIME_SETTINGS.worktreeIsolation),
    extensionBlocklist: stringList(parsed.extensionBlocklist),
    taskCapabilityProfile: normalizeTaskCapabilityProfile(parsed.taskCapabilityProfile),
  }
}

export async function resolveProjectConfigValue(value: string): Promise<string | undefined> {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const envName = envReferenceName(trimmed)
  if (envName) return resolveProjectEnvValue(envName)

  const dollarPlaceholder = '\u0000DOLLAR\u0000'
  const interpolated = trimmed
    .replaceAll('$$', dollarPlaceholder)
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => resolveProjectEnvValue(name) ?? '')
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name: string) => resolveProjectEnvValue(name) ?? '')
    .replaceAll(dollarPlaceholder, '$')
    .trim()

  return interpolated.length > 0 ? interpolated : undefined
}

function readProjectObjectConfig(): ProjectEnvObjectConfig {
  const env = readProjectEnvValues()
  const runtime = normalizeRuntimeObject(parseJsonRecord(env[RUNTIME_CONFIG_KEY]) ?? legacyRuntimeConfig(env))
  const providers = normalizeProvidersObject(parseJsonRecord(env[PROVIDERS_CONFIG_KEY]) ?? legacyProvidersConfig(env, runtime))
  const designSystem = normalizeDesignSystemObject(parseJsonRecord(env[DESIGN_SYSTEM_CONFIG_KEY]), env)
  const config: ProjectEnvObjectConfig = { runtime, providers, designSystem }
  ensureProviderConfig(config, runtime.provider ?? DEFAULT_PROVIDER)
  ensureSelectedModel(config)
  return config
}

async function writeProjectObjectConfig(config: ProjectEnvObjectConfig): Promise<void> {
  const normalized: ProjectEnvObjectConfig = {
    runtime: normalizeRuntimeObject(config.runtime),
    providers: normalizeProvidersObject(config.providers),
    designSystem: normalizeDesignSystemObject(config.designSystem, {}),
  }
  ensureProviderConfig(normalized, normalized.runtime.provider ?? DEFAULT_PROVIDER)
  ensureSelectedModel(normalized)
  await writeProjectLocalEnvValuesInternal({
    [RUNTIME_CONFIG_KEY]: JSON.stringify(normalized.runtime),
    [PROVIDERS_CONFIG_KEY]: JSON.stringify(normalized.providers),
    [DESIGN_SYSTEM_CONFIG_KEY]: JSON.stringify(normalized.designSystem),
  }, LEGACY_AGENT_ENV_KEYS)
}

async function writeProjectLocalEnvValuesInternal(updates: DotEnvValues, removeKeys: string[]): Promise<void> {
  const path = getProjectLocalEnvPath()
  const current = existsSync(path) ? readFileSync(path, 'utf-8') : ''
  const cleaned = removeKeys.length > 0 ? removeDotEnvValues(current, removeKeys) : current
  const next = upsertDotEnvValues(cleaned, updates)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, next, 'utf-8')
  for (const [name, value] of Object.entries(updates)) {
    if (normalizeEnvName(name)) process.env[name] = value
  }
  for (const name of removeKeys) {
    delete process.env[name]
  }
}

function readDotEnvFile(path: string): DotEnvValues {
  if (!existsSync(path)) return {}
  return parseDotEnv(readFileSync(path, 'utf-8'))
}

function definedProcessEnv(): DotEnvValues {
  const values: DotEnvValues = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') values[key] = value
  }
  return values
}

function parseDotEnv(content: string): DotEnvValues {
  const values: DotEnvValues = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const normalized = line.startsWith('export ') ? line.slice('export '.length).trim() : line
    const separator = normalized.indexOf('=')
    if (separator <= 0) continue
    const name = normalizeEnvName(normalized.slice(0, separator).trim())
    if (!name) continue
    values[name] = parseDotEnvValue(normalized.slice(separator + 1).trim())
  }
  return values
}

function parseDotEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  const commentIndex = value.search(/\s#/)
  return (commentIndex >= 0 ? value.slice(0, commentIndex) : value).trim()
}

function upsertDotEnvValues(content: string, updates: DotEnvValues): string {
  let next = content
  for (const [name, value] of Object.entries(updates)) {
    const normalizedName = normalizeEnvName(name)
    if (!normalizedName) continue
    next = upsertDotEnvValue(next, normalizedName, value)
  }
  return next
}

function upsertDotEnvValue(content: string, name: string, value: string): string {
  const line = `${name}=${quoteDotEnvValue(value)}`
  const lines = content.length > 0 ? content.split(/\r?\n/) : []
  let replaced = false
  const nextLines = lines.map((rawLine) => {
    const trimmed = rawLine.trim()
    const withoutExport = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed
    if (withoutExport.startsWith(`${name}=`)) {
      replaced = true
      return line
    }
    return rawLine
  })
  if (!replaced) {
    if (nextLines.length > 0 && nextLines[nextLines.length - 1] !== '') nextLines.push('')
    nextLines.push(line)
  }
  return `${nextLines.join('\n').replace(/\n*$/, '')}\n`
}

function removeDotEnvValues(content: string, keys: string[]): string {
  const removeSet = new Set(keys.map(key => normalizeEnvName(key)).filter((key): key is string => Boolean(key)))
  const nextLines = content.split(/\r?\n/).filter((rawLine) => {
    const trimmed = rawLine.trim()
    const withoutExport = trimmed.startsWith('export ') ? trimmed.slice('export '.length).trim() : trimmed
    const separator = withoutExport.indexOf('=')
    if (separator <= 0) return true
    const name = normalizeEnvName(withoutExport.slice(0, separator).trim())
    return !name || !removeSet.has(name)
  })
  return `${nextLines.join('\n').replace(/\n*$/, '')}\n`
}

function quoteDotEnvValue(value: string): string {
  if (isJsonObjectLiteral(value)) return value
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
}

function resolveProjectEnvValue(name: string): string | undefined {
  const normalizedName = normalizeEnvName(name)
  if (!normalizedName) return undefined
  return readProjectEnvValues()[normalizedName]?.trim() || undefined
}

function parseJsonRecord(value: string | undefined): Record<string, unknown> | undefined {
  if (!value?.trim()) return undefined
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function isJsonObjectLiteral(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed))
  } catch {
    return false
  }
}

function legacyRuntimeConfig(env: DotEnvValues): ProjectEnvRuntimeConfig {
  return {
    provider: readSetting(env, 'TELEGRAPH_AGENT_PROVIDER', DEFAULT_RUNTIME_SETTINGS.provider),
    modelId: readSetting(env, 'TELEGRAPH_AGENT_MODEL', DEFAULT_RUNTIME_SETTINGS.modelId),
    authMode: readSetting(env, 'TELEGRAPH_AGENT_AUTH_MODE', DEFAULT_RUNTIME_SETTINGS.authMode) === 'subscription'
      ? 'subscription'
      : 'api-key',
    baseUrl: readSetting(env, 'TELEGRAPH_AGENT_BASE_URL', ''),
    backend: readSetting(env, 'TELEGRAPH_AGENT_BACKEND', DEFAULT_RUNTIME_SETTINGS.backend),
    orchestration: readSetting(env, 'TELEGRAPH_AGENT_ORCHESTRATION', DEFAULT_RUNTIME_SETTINGS.orchestration),
    orchestrationPattern: readSetting(env, 'TELEGRAPH_AGENT_ORCHESTRATION_PATTERN', DEFAULT_RUNTIME_SETTINGS.orchestrationPattern),
    worktreeIsolation: readBooleanSetting(env, 'TELEGRAPH_AGENT_WORKTREE_ISOLATION', DEFAULT_RUNTIME_SETTINGS.worktreeIsolation),
    extensionBlocklist: readListSetting(env, 'TELEGRAPH_AGENT_EXTENSION_BLOCKLIST'),
    taskCapabilityProfile: readTaskCapabilityProfile(env),
  }
}

function legacyProvidersConfig(env: DotEnvValues, runtime: ProjectEnvRuntimeConfig): Record<string, ProjectEnvProviderConfig> {
  const provider = runtime.provider ?? DEFAULT_PROVIDER
  const prefix = providerEnvPrefix(provider)
  const apiKeyEnv = readSetting(env, 'TELEGRAPH_AGENT_API_KEY_ENV', readSetting(env, `${prefix}_API_KEY_ENV`, defaultApiKeyEnvName(provider)))
  const baseUrl = runtime.baseUrl || readSetting(env, `${prefix}_BASE_URL`, defaultBaseUrl(provider))
  const api = readSetting(env, 'TELEGRAPH_AGENT_API', readSetting(env, `${prefix}_API`, DEFAULT_API))
  const modelId = runtime.modelId ?? DEFAULT_MODEL_ID
  return {
    [provider]: {
      ...defaultProviderObjectConfig(provider),
      baseUrl,
      api,
      apiKeyEnv,
      models: [{
        id: modelId,
        name: readSetting(env, 'TELEGRAPH_AGENT_MODEL_LABEL', modelId === DEFAULT_MODEL_ID ? DEFAULT_MODEL_LABEL : modelId),
        api,
        baseUrl,
        reasoning: readBooleanSetting(env, 'TELEGRAPH_AGENT_MODEL_REASONING', modelId === DEFAULT_MODEL_ID),
        input: ['text'],
        contextWindow: readNumberSetting(env, 'TELEGRAPH_AGENT_CONTEXT_WINDOW', DEFAULT_CONTEXT_WINDOW),
        maxTokens: readNumberSetting(env, 'TELEGRAPH_AGENT_MAX_TOKENS', DEFAULT_MAX_TOKENS),
      }],
    },
  }
}

function normalizeRuntimeObject(value: unknown): ProjectEnvRuntimeConfig {
  const normalized = normalizeRuntimeSettings(value && typeof value === 'object' ? value as Record<string, unknown> : {})
  return {
    provider: normalized.provider,
    modelId: normalized.modelId,
    authMode: normalized.authMode,
    subscriptionProvider: normalized.subscriptionProvider,
    subscriptionCredentials: normalized.subscriptionCredentials,
    baseUrl: normalized.baseUrl,
    backend: normalized.backend,
    orchestration: normalized.orchestration,
    orchestrationPattern: normalized.orchestrationPattern ?? DEFAULT_RUNTIME_SETTINGS.orchestrationPattern,
    worktreeIsolation: normalized.worktreeIsolation,
    extensionBlocklist: normalized.extensionBlocklist,
    taskCapabilityProfile: normalized.taskCapabilityProfile,
  }
}

function normalizeProvidersObject(value: unknown): Record<string, ProjectEnvProviderConfig> {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  const providers: Record<string, ProjectEnvProviderConfig> = {}
  for (const [rawProvider, rawConfig] of Object.entries(source)) {
    const provider = rawProvider.trim()
    if (!provider || !rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) continue
    const config = rawConfig as Record<string, unknown>
    providers[provider] = {
      name: stringOrUndefined(config.name) ?? defaultProviderDisplayName(provider),
      baseUrl: stringOrUndefined(config.baseUrl) ?? defaultBaseUrl(provider),
      api: stringOrUndefined(config.api) ?? DEFAULT_API,
      apiKeyEnv: normalizeEnvName(typeof config.apiKeyEnv === 'string' ? config.apiKeyEnv : ''),
      apiKey: stringOrUndefined(config.apiKey),
      models: normalizeModelList(config.models, provider, config),
    }
  }
  return providers
}

function normalizeModelList(value: unknown, provider: string, providerConfig: Record<string, unknown>): ProjectModelFileConfig[] {
  if (!Array.isArray(value)) return []
  const models: ProjectModelFileConfig[] = []
  for (const rawModel of value) {
    if (!rawModel || typeof rawModel !== 'object' || Array.isArray(rawModel)) continue
    const model = rawModel as Record<string, unknown>
    const id = stringOrUndefined(model.id)
    if (!id) continue
    models.push({
      id,
      name: stringOrUndefined(model.name) ?? id,
      baseUrl: stringOrUndefined(model.baseUrl) ?? stringOrUndefined(providerConfig.baseUrl) ?? defaultBaseUrl(provider),
      api: stringOrUndefined(model.api) ?? stringOrUndefined(providerConfig.api) ?? DEFAULT_API,
      apiKey: stringOrUndefined(model.apiKey),
      reasoning: typeof model.reasoning === 'boolean' ? model.reasoning : id === DEFAULT_MODEL_ID,
      input: normalizeModelInputs(model.input),
      contextWindow: numberOrUndefined(model.contextWindow) ?? DEFAULT_CONTEXT_WINDOW,
      maxTokens: numberOrUndefined(model.maxTokens) ?? DEFAULT_MAX_TOKENS,
    })
  }
  return models
}

function normalizeDesignSystemObject(value: unknown, env: DotEnvValues | Record<string, unknown>): ProjectEnvObjectConfig['designSystem'] {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    themePackId: stringOrUndefined(record.themePackId) ?? stringOrUndefined(env.TELEGRAPH_DESIGN_THEME_PACK_ID) ?? DEFAULT_THEME_PACK_ID,
  }
}

function ensureProviderConfig(config: ProjectEnvObjectConfig, provider: string): ProjectEnvProviderConfig {
  const providerId = provider.trim() || DEFAULT_PROVIDER
  config.providers[providerId] = {
    ...defaultProviderObjectConfig(providerId),
    ...config.providers[providerId],
  }
  return config.providers[providerId]
}

function ensureSelectedModel(config: ProjectEnvObjectConfig): void {
  const provider = config.runtime.provider ?? DEFAULT_PROVIDER
  const modelId = config.runtime.modelId ?? DEFAULT_MODEL_ID
  const providerConfig = ensureProviderConfig(config, provider)
  if (providerConfig.models?.some(model => model.id === modelId)) return
  providerConfig.models = [
    ...(providerConfig.models ?? []),
    {
      id: modelId,
      name: modelId === DEFAULT_MODEL_ID ? DEFAULT_MODEL_LABEL : modelId,
      api: providerConfig.api,
      baseUrl: providerConfig.baseUrl,
      reasoning: modelId === DEFAULT_MODEL_ID,
      input: ['text'],
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      maxTokens: DEFAULT_MAX_TOKENS,
    },
  ]
}

function providerConfigFileApiKey(providerConfig: ProjectEnvProviderConfig | undefined): string | undefined {
  if (!providerConfig) return undefined
  return providerConfig.apiKeyEnv ? `env:${providerConfig.apiKeyEnv}` : providerConfig.apiKey
}

function defaultProviderFileConfig(provider: string): ProjectProviderFileConfig {
  const config = defaultProviderObjectConfig(provider)
  return {
    name: config.name,
    baseUrl: config.baseUrl,
    api: config.api,
    apiKey: providerConfigFileApiKey(config),
  }
}

function defaultProviderObjectConfig(provider: string): ProjectEnvProviderConfig {
  return {
    name: defaultProviderDisplayName(provider),
    baseUrl: defaultBaseUrl(provider),
    api: DEFAULT_API,
    apiKeyEnv: defaultApiKeyEnvName(provider),
    models: [],
  }
}

function defaultProviderDisplayName(provider: string): string {
  return provider === DEFAULT_PROVIDER ? 'ZAI' : provider
}

function readSetting(env: DotEnvValues, key: string, fallback: string): string {
  const value = env[key]?.trim()
  return value ? value : fallback
}

function readBooleanSetting(env: DotEnvValues, key: string, fallback: boolean): boolean {
  const value = env[key]?.trim().toLowerCase()
  if (value === 'true' || value === '1' || value === 'yes') return true
  if (value === 'false' || value === '0' || value === 'no') return false
  return fallback
}

function readNumberSetting(env: DotEnvValues, key: string, fallback: number): number {
  const value = Number(env[key])
  return Number.isFinite(value) ? value : fallback
}

function readListSetting(env: DotEnvValues, key: string): string[] {
  return stringList(env[key]?.split(','))
}

function readTaskCapabilityProfile(env: DotEnvValues): RuntimeTaskCapabilityProfile {
  return normalizeTaskCapabilityProfile({
    kind: readSetting(env, 'TELEGRAPH_AGENT_TASK_CAPABILITY_PROFILE', 'default'),
  })
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function numberOrUndefined(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
}

function normalizeModelInputs(value: unknown): Array<'text' | 'image'> {
  if (!Array.isArray(value)) return ['text']
  const inputs = value.filter((item): item is 'text' | 'image' => item === 'text' || item === 'image')
  return inputs.length > 0 ? inputs : ['text']
}

function normalizeSubscriptionCredentials(value: unknown): RuntimeSettings['subscriptionCredentials'] {
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

function normalizeTaskCapabilityProfile(value: unknown): RuntimeTaskCapabilityProfile {
  if (!value || typeof value !== 'object') return { ...DEFAULT_RUNTIME_SETTINGS.taskCapabilityProfile }
  const profile = value as Partial<RuntimeTaskCapabilityProfile>

  switch (profile.kind) {
    case 'readonly-workspace':
      return { kind: 'readonly-workspace', scopes: stringList(profile.scopes) }
    case 'shell-automation':
      return {
        kind: 'shell-automation',
        commands: stringList(profile.commands),
        cwdPolicy: profile.cwdPolicy === 'restricted' ? 'restricted' : 'workspace',
      }
    case 'coding-edit':
      return {
        kind: 'coding-edit',
        scopes: stringList(profile.scopes),
        patchPolicy: profile.patchPolicy === 'apply-after-confirm' ? 'apply-after-confirm' : 'preview',
      }
    case 'design-build':
      return {
        kind: 'design-build',
        scopes: stringList(profile.scopes),
        artifactPolicy: profile.artifactPolicy === 'apply-after-confirm' ? 'apply-after-confirm' : 'preview',
      }
    default:
      return { ...DEFAULT_RUNTIME_SETTINGS.taskCapabilityProfile }
  }
}

function envReferenceName(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed.startsWith('env:')) return undefined
  return normalizeEnvName(trimmed.slice('env:'.length))
}

function normalizeEnvName(name: string): string | undefined {
  const trimmed = name.trim()
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed) ? trimmed : undefined
}

function providerEnvPrefix(provider: string): string {
  return provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function defaultApiKeyEnvName(provider: string): string {
  return `${providerEnvPrefix(provider)}_API_KEY`
}

function defaultBaseUrl(provider: string): string {
  return provider === DEFAULT_PROVIDER ? DEFAULT_BASE_URL : ''
}
