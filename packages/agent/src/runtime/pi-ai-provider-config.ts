import {
  findEnvKeys,
  getEnvApiKey,
  getModels,
  getProviders,
  type Api,
  type Model,
} from '@mariozechner/pi-ai'
import { getOAuthApiKey, type OAuthCredentials } from '@mariozechner/pi-ai/oauth'
import { exec } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { AgentRuntimeSettings } from '@/packages/agent/types'

type JsonRecord = Record<string, unknown>

export type PiAiCredentialSource = 'runtime' | 'auth-json' | 'oauth' | 'env' | 'models-json'

export interface PiAiResolvedApiKey {
  apiKey: string
  authMode: 'api-key' | 'subscription'
  source: PiAiCredentialSource
  refreshedSubscriptionCredentials?: OAuthCredentials
}

export interface PiAiAuthStatus {
  configured: boolean
  source?: Exclude<PiAiCredentialSource, 'runtime'>
  label?: string
}

export interface PiAiConfiguredModelDescriptor {
  provider: string
  id: string
  label: string
  api?: string
  baseUrl?: string
  authConfigured: boolean
  authSource?: PiAiAuthStatus['source']
  authLabel?: string
}

export interface PiAiProviderFileConfig {
  baseUrl?: string
  api?: string
  apiKey?: string
}

export interface PiAiModelFileConfig extends PiAiProviderFileConfig {
  id: string
  name?: string
  reasoning?: boolean
  input?: Array<'text' | 'image'>
  contextWindow?: number
  maxTokens?: number
}

type PiAiModelsJson = { providers: Record<string, JsonRecord> }

type ApiKeyCredential = {
  type: 'api_key'
  key: string
}

type OAuthCredential = {
  type: 'oauth'
} & OAuthCredentials

type AuthCredential = ApiKeyCredential | OAuthCredential
type AuthStorageData = Record<string, AuthCredential>

const DEFAULT_MODELS_JSON: PiAiModelsJson = { providers: {} }
const DEFAULT_CONTEXT_WINDOW = 128_000
const DEFAULT_MAX_TOKENS = 8192
const CONFIG_COMMAND_TIMEOUT_MS = 10_000
const AUTH_FILE_MODE = 0o600

export function getPiAgentDir(): string {
  const envDir = process.env.PI_CODING_AGENT_DIR
  if (envDir?.trim()) return expandTilde(envDir.trim())
  return join(homedir(), '.pi', 'agent')
}

export function getPiModelsJsonPath(): string {
  return join(getPiAgentDir(), 'models.json')
}

export function getPiAuthJsonPath(): string {
  return join(getPiAgentDir(), 'auth.json')
}

export function readPiModelsJson(): PiAiModelsJson {
  try {
    return parseModelsJson(readFileSync(getPiModelsJsonPath(), 'utf-8'))
  } catch {
    return { ...DEFAULT_MODELS_JSON, providers: {} }
  }
}

export function readPiAuthJson(): AuthStorageData {
  try {
    return parseAuthJson(readFileSync(getPiAuthJsonPath(), 'utf-8'))
  } catch {
    return {}
  }
}

export function getPiProviderFileConfig(provider: string): PiAiProviderFileConfig {
  const providerConfig = providerRecord(readPiModelsJson(), provider)
  return {
    baseUrl: stringOrUndefined(providerConfig.baseUrl),
    api: stringOrUndefined(providerConfig.api),
    apiKey: stringOrUndefined(providerConfig.apiKey),
  }
}

export function getPiModelFileConfig(
  provider: string,
  modelId: string,
): PiAiModelFileConfig | undefined {
  const providerConfig = providerRecord(readPiModelsJson(), provider)
  const providerBaseUrl = stringOrUndefined(providerConfig.baseUrl)
  const providerApi = stringOrUndefined(providerConfig.api)
  const providerApiKey = stringOrUndefined(providerConfig.apiKey)
  for (const model of arrayOfRecords(providerConfig.models)) {
    const id = stringOrUndefined(model.id)
    if (id !== modelId) continue
    return {
      id,
      name: stringOrUndefined(model.name),
      api: stringOrUndefined(model.api) ?? providerApi,
      baseUrl: stringOrUndefined(model.baseUrl) ?? providerBaseUrl,
      apiKey: stringOrUndefined(model.apiKey) ?? providerApiKey,
      reasoning: typeof model.reasoning === 'boolean' ? model.reasoning : undefined,
      input: parseModelInput(model.input),
      contextWindow: numberOrUndefined(model.contextWindow),
      maxTokens: numberOrUndefined(model.maxTokens),
    }
  }
  return undefined
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
  const credential = readPiAuthJson()[provider]
  if (credential?.type === 'api_key' && credential.key.trim()) {
    return { configured: true, source: 'auth-json', label: 'auth.json' }
  }
  if (credential?.type === 'oauth') {
    return { configured: true, source: 'oauth', label: 'auth.json oauth' }
  }

  const envKey = findEnvKeys(provider)?.[0]
  if (envKey) {
    return { configured: true, source: 'env', label: envKey }
  }

  const providerConfig = getPiProviderFileConfig(provider)
  if (providerConfig.apiKey?.trim()) {
    return { configured: true, source: 'models-json', label: 'models.json apiKey' }
  }

  return { configured: false }
}

export async function listPiConfiguredModels(): Promise<PiAiConfiguredModelDescriptor[]> {
  const modelsJson = readPiModelsJson()
  const providerIds = new Set<string>([
    ...safeGetProviders(),
    ...Object.keys(readPiAuthJson()),
    ...Object.keys(modelsJson.providers),
  ])
  const configuredModels: PiAiConfiguredModelDescriptor[] = []

  for (const provider of providerIds) {
    const auth = getPiAuthStatus(provider)
    if (!auth.configured) continue

    const byId = new Map<string, PiAiConfiguredModelDescriptor>()
    for (const model of safeGetModels(provider)) {
      if (!model.id) continue
      byId.set(model.id, {
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

    for (const model of listPiModelsFromJson(provider, modelsJson)) {
      byId.set(model.id, {
        ...byId.get(model.id),
        ...model,
        authConfigured: true,
        authSource: auth.source,
        authLabel: auth.label,
      })
    }

    configuredModels.push(...byId.values())
  }

  return configuredModels.sort((a, b) => {
    const providerOrder = a.provider.localeCompare(b.provider)
    return providerOrder === 0 ? a.id.localeCompare(b.id) : providerOrder
  })
}

export async function resolvePiAiApiKey(settings: AgentRuntimeSettings): Promise<PiAiResolvedApiKey> {
  const runtimeApiKey = settings.apiKey.trim()
  if (runtimeApiKey) {
    return { apiKey: runtimeApiKey, authMode: 'api-key', source: 'runtime' }
  }

  const fromAuthJson = await resolvePiAuthJsonApiKey(settings)
  if (fromAuthJson) return fromAuthJson

  const fromSubscriptionSettings = await resolveSubscriptionSettingsApiKey(settings)
  if (fromSubscriptionSettings) return fromSubscriptionSettings

  const envKey = getEnvApiKey(settings.provider)
  if (envKey?.trim()) {
    return { apiKey: envKey.trim(), authMode: 'api-key', source: 'env' }
  }

  const providerConfig = getPiProviderFileConfig(settings.provider)
  if (providerConfig.apiKey?.trim()) {
    const apiKey = await resolveConfigValue(providerConfig.apiKey)
    if (apiKey) return { apiKey, authMode: 'api-key', source: 'models-json' }
  }

  throw new Error(
    `Chat model settings are required: no API key found for provider "${settings.provider}". Configure Settings -> Providers or ${getPiAuthJsonPath()}.`,
  )
}

export async function upsertPiAuthCredential(input: {
  provider: string
  apiKey?: string
  oauthCredentials?: OAuthCredentials
}): Promise<void> {
  const provider = input.provider.trim()
  if (!provider) throw new Error('provider is required.')

  const existing = readPiAuthJson()
  const next: AuthStorageData = { ...existing }
  if (input.oauthCredentials) {
    next[provider] = { type: 'oauth', ...input.oauthCredentials }
  } else if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
    next[provider] = { type: 'api_key', key: input.apiKey.trim() }
  } else {
    return
  }

  const authPath = getPiAuthJsonPath()
  await mkdir(dirname(authPath), { recursive: true })
  await writeFile(authPath, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: AUTH_FILE_MODE,
  })
  try {
    chmodSync(authPath, AUTH_FILE_MODE)
  } catch {
    // best effort on non-POSIX filesystems
  }
}

export function writePiAuthCredentialSync(input: {
  provider: string
  apiKey?: string
  oauthCredentials?: OAuthCredentials
}): void {
  const provider = input.provider.trim()
  if (!provider) throw new Error('provider is required.')

  const existing = readPiAuthJson()
  const next: AuthStorageData = { ...existing }
  if (input.oauthCredentials) {
    next[provider] = { type: 'oauth', ...input.oauthCredentials }
  } else if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
    next[provider] = { type: 'api_key', key: input.apiKey.trim() }
  } else {
    return
  }

  const authPath = getPiAuthJsonPath()
  mkdirSync(dirname(authPath), { recursive: true })
  writeFileSync(authPath, `${JSON.stringify(next, null, 2)}\n`, {
    encoding: 'utf-8',
    mode: AUTH_FILE_MODE,
  })
  try {
    chmodSync(authPath, AUTH_FILE_MODE)
  } catch {
    // best effort on non-POSIX filesystems
  }
}

async function resolvePiAuthJsonApiKey(
  settings: AgentRuntimeSettings,
): Promise<PiAiResolvedApiKey | undefined> {
  const authJson = readPiAuthJson()
  const providerId = (settings.subscriptionProvider ?? settings.provider).trim()
  const credential = authJson[providerId] ?? authJson[settings.provider]
  if (!credential) return undefined

  if (credential.type === 'api_key') {
    const apiKey = await resolveConfigValue(credential.key)
    return apiKey ? { apiKey, authMode: 'api-key', source: 'auth-json' } : undefined
  }

  const oauthCredentials = collectOAuthCredentials(authJson)
  const oauthResult = await getOAuthApiKey(providerId, oauthCredentials)
  if (!oauthResult?.apiKey.trim()) return undefined
  if (oauthResult.newCredentials) {
    writePiAuthCredentialSync({
      provider: providerId,
      oauthCredentials: oauthResult.newCredentials,
    })
  }
  return {
    apiKey: oauthResult.apiKey.trim(),
    authMode: 'subscription',
    source: 'oauth',
    refreshedSubscriptionCredentials: oauthResult.newCredentials,
  }
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
    source: 'oauth',
    refreshedSubscriptionCredentials: oauthResult.newCredentials,
  }
}

function collectOAuthCredentials(authJson: AuthStorageData): Record<string, OAuthCredentials> {
  const credentials: Record<string, OAuthCredentials> = {}
  for (const [provider, value] of Object.entries(authJson)) {
    if (value.type === 'oauth') {
      credentials[provider] = value
    }
  }
  return credentials
}

async function resolveConfigValue(value: string): Promise<string | undefined> {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('!')) {
    return runConfigCommand(trimmed.slice(1))
  }

  const dollarPlaceholder = '\u0000DOLLAR\u0000'
  const bangPlaceholder = '\u0000BANG\u0000'
  const interpolated = trimmed
    .replaceAll('$$', dollarPlaceholder)
    .replaceAll('$!', bangPlaceholder)
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => process.env[name] ?? '')
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name: string) => process.env[name] ?? '')
    .replaceAll(dollarPlaceholder, '$')
    .replaceAll(bangPlaceholder, '!')
    .trim()

  return interpolated.length > 0 ? interpolated : undefined
}

function runConfigCommand(command: string): Promise<string | undefined> {
  if (!command.trim()) return Promise.resolve(undefined)
  return new Promise((resolve) => {
    exec(command, {
      timeout: CONFIG_COMMAND_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    }, (error, stdout) => {
      if (error) {
        resolve(undefined)
        return
      }
      const result = stdout.trim()
      resolve(result.length > 0 ? result : undefined)
    })
  })
}

function listPiModelsFromJson(
  provider: string,
  source: PiAiModelsJson,
): PiAiConfiguredModelDescriptor[] {
  const providerConfig = providerRecord(source, provider)
  const providerApi = stringOrUndefined(providerConfig.api)
  const providerBaseUrl = stringOrUndefined(providerConfig.baseUrl)
  return arrayOfRecords(providerConfig.models)
    .map((model): PiAiConfiguredModelDescriptor | undefined => {
      const id = stringOrUndefined(model.id)
      if (!id) return undefined
      return {
        id,
        label: stringOrUndefined(model.name) ?? id,
        provider,
        api: stringOrUndefined(model.api) ?? providerApi,
        baseUrl: stringOrUndefined(model.baseUrl) ?? providerBaseUrl,
        authConfigured: true,
      }
    })
    .filter((item): item is PiAiConfiguredModelDescriptor => item !== undefined)
}

function safeGetProviders(): string[] {
  try {
    return getProviders()
  } catch {
    return []
  }
}

function safeGetModels(provider: string): Array<Model<Api>> {
  try {
    return (getModels as unknown as (providerId: string) => Array<Model<Api>>)(provider)
  } catch {
    return []
  }
}

function parseModelsJson(content: string): PiAiModelsJson {
  const parsed = JSON.parse(content) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return DEFAULT_MODELS_JSON
  const providers = toRecord((parsed as { providers?: unknown }).providers)
  const result: Record<string, JsonRecord> = {}
  for (const [key, value] of Object.entries(providers)) {
    result[key] = toRecord(value)
  }
  return { providers: result }
}

function parseAuthJson(content: string): AuthStorageData {
  const parsed = JSON.parse(content) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const result: AuthStorageData = {}
  for (const [provider, value] of Object.entries(parsed as Record<string, unknown>)) {
    const credential = parseAuthCredential(value)
    if (credential) result[provider] = credential
  }
  return result
}

function parseAuthCredential(value: unknown): AuthCredential | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (record.type === 'api_key' && typeof record.key === 'string') {
    return { type: 'api_key', key: record.key }
  }
  if (record.type === 'oauth') {
    const credentials = toOAuthCredentials(record)
    return credentials ? { type: 'oauth', ...credentials } : undefined
  }
  return undefined
}

function toOAuthCredentials(value: unknown): OAuthCredentials | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (
    typeof record.refresh !== 'string' ||
    typeof record.access !== 'string' ||
    typeof record.expires !== 'number'
  ) {
    return null
  }
  return {
    ...record,
    refresh: record.refresh,
    access: record.access,
    expires: record.expires,
  }
}

function providerRecord(source: PiAiModelsJson, provider: string): JsonRecord {
  return toRecord(source.providers[provider])
}

function toRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as JsonRecord
}

function arrayOfRecords(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is JsonRecord => (
    typeof item === 'object' && item !== null && !Array.isArray(item)
  ))
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function parseModelInput(value: unknown): Array<'text' | 'image'> | undefined {
  if (!Array.isArray(value)) return undefined
  const input = value.filter((item): item is 'text' | 'image' => item === 'text' || item === 'image')
  return input.length > 0 ? input : undefined
}

function expandTilde(value: string): string {
  if (value === '~') return homedir()
  if (value.startsWith('~/')) return join(homedir(), value.slice(2))
  return value
}
