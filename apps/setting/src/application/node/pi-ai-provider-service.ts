import { complete, findEnvKeys, getModel, getModels } from '@mariozechner/pi-ai';
import {
  getOAuthApiKey,
  getOAuthProvider,
  type OAuthCredentials,
} from '@mariozechner/pi-ai/oauth';
import { readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import {
  buildPiAiProviderCatalog,
  PI_AI_PROVIDER_DEFAULT_BASE_URLS,
  type PiAiConnectionTestInput,
  type PiAiConnectionTestResult,
  type PiAiModelConfigUpsertInput,
  type PiAiModelDescriptor,
  type PiAiProviderConfigSnapshot,
  type PiAiProviderConfigUpsertInput,
  type PiAiProviderDescriptor,
} from '@/apps/setting/application/common';
import {
  getPiAuthStatus,
  upsertPiAuthCredential,
} from '@/packages/agent/runtime/pi-ai-provider-config';

type ModelLike = { id?: string; name?: string; api?: string; baseUrl?: string };
type JsonRecord = Record<string, unknown>;
type PiAiModelsJson = { providers: Record<string, JsonRecord> };

const getModelsLoose = getModels as unknown as (provider: string) => ModelLike[];
const getModelLoose = getModel as unknown as (provider: string, modelId: string) => unknown;
const DEFAULT_TEST_TIMEOUT_MS = 15000;
const MODELS_JSON_PATH = join(homedir(), '.pi', 'agent', 'models.json');

const DEFAULT_MODELS_JSON: PiAiModelsJson = { providers: {} };
let cachedModelsJson: PiAiModelsJson | null = null;
let cachedModelsJsonMtimeMs = -1;

export function listPiAiProviders(): PiAiProviderDescriptor[] {
  const modelsJson = readModelsJson();
  const customProviderIds = Object.keys(modelsJson.providers);
  const catalog = buildPiAiProviderCatalog(customProviderIds);
  const environmentKeyByProvider: Record<string, string | undefined> = {};
  for (const provider of catalog) {
    environmentKeyByProvider[provider.id] = findEnvKeys(provider.id)?.[0];
  }
  return buildPiAiProviderCatalog(customProviderIds, environmentKeyByProvider).map((provider) => {
    const auth = getPiAuthStatus(provider.id);
    return {
      ...provider,
      authConfigured: auth.configured,
      authSource: auth.source,
      authLabel: auth.label,
    };
  });
}

export function listPiAiModels(provider: string): PiAiModelDescriptor[] {
  if (!provider.trim()) return [];
  const merged = new Map<string, PiAiModelDescriptor>();
  for (const model of safeGetModels(provider)) {
    if (!model.id?.length) continue;
    merged.set(model.id, {
      id: model.id,
      label: model.name ?? model.id,
      provider,
      api: model.api,
      baseUrl: model.baseUrl,
    });
  }
  for (const model of listCustomModels(provider, readModelsJson())) {
    if (!model.id.length) continue;
    const existing = merged.get(model.id);
    merged.set(model.id, {
      ...existing,
      ...model,
    });
  }
  return [...merged.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function testPiAiConnection(input: PiAiConnectionTestInput): Promise<PiAiConnectionTestResult> {
  const startedAt = Date.now();
  try {
    const provider = input.provider.trim();
    const modelId = input.modelId.trim();
    if (!provider || !modelId) {
      throw new Error('provider and modelId are required');
    }

    const auth = await resolvePiAiAuth(input);
    const model = getModelLoose(provider, modelId);
    if (!model) {
      throw new Error(`Unknown model "${modelId}" for provider "${provider}".`);
    }

    const response = await complete(
      model as never,
      {
        messages: [{ role: 'user', content: 'Reply with pong.', timestamp: Date.now() }],
      },
      {
        apiKey: auth.apiKey,
        temperature: 0,
        maxTokens: 16,
        signal: AbortSignal.timeout(clampTimeout(input.timeoutMs)),
      },
    );

    const latencyMs = Date.now() - startedAt;
    return {
      ok: true,
      provider,
      modelId,
      authMode: input.authMode,
      latencyMs,
      resolvedApiKey: auth.apiKey,
      refreshedSubscriptionCredentials: auth.refreshedSubscriptionCredentials,
      responseModel: response.responseModel ?? response.model,
    };
  } catch (error) {
    return {
      ok: false,
      provider: input.provider,
      modelId: input.modelId,
      authMode: input.authMode,
      latencyMs: Date.now() - startedAt,
      error: getErrorMessage(error),
    };
  }
}

async function resolvePiAiAuth(
  input: PiAiConnectionTestInput,
): Promise<{ apiKey: string; refreshedSubscriptionCredentials?: OAuthCredentials }> {
  const authMode = input.authMode === 'subscription' ? 'subscription' : 'api-key';
  if (authMode === 'api-key') {
    const apiKey = (input.apiKey ?? '').trim();
    if (!apiKey) throw new Error('API key is required for api-key mode.');
    return { apiKey };
  }

  const providerId = (input.subscriptionProvider ?? input.provider).trim();
  if (!providerId) throw new Error('subscriptionProvider is required for subscription mode.');
  if (!getOAuthProvider(providerId)) {
    throw new Error(`Provider "${providerId}" does not support subscription OAuth in pi-ai.`);
  }

  const credentials = toOAuthCredentials(input.subscriptionCredentials);
  if (!credentials) throw new Error('subscriptionCredentials is invalid. Expected refresh/access/expires.');

  const oauthResult = await getOAuthApiKey(providerId, {
    [providerId]: credentials,
  });
  if (!oauthResult || !oauthResult.apiKey.trim()) {
    throw new Error(`Subscription auth not configured for provider "${providerId}".`);
  }
  return {
    apiKey: oauthResult.apiKey.trim(),
    refreshedSubscriptionCredentials: oauthResult.newCredentials,
  };
}

function toOAuthCredentials(value: unknown): OAuthCredentials | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
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
}

function clampTimeout(value: number | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return DEFAULT_TEST_TIMEOUT_MS;
  return Math.max(3000, Math.min(45000, Math.trunc(value)));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeGetModels(provider: string): ModelLike[] {
  try {
    return getModelsLoose(provider);
  } catch {
    return [];
  }
}

export async function getPiAiModelsJson(): Promise<string> {
  try {
    return await readFile(MODELS_JSON_PATH, 'utf-8');
  } catch (error) {
    if (isNotFound(error)) {
      return `${JSON.stringify(DEFAULT_MODELS_JSON, null, 2)}\n`;
    }
    throw error;
  }
}

export async function savePiAiModelsJson(content: string): Promise<void> {
  const parsed = parseModelsJson(content);
  await writeModelsJson(parsed);
}

export function getPiAiProviderConfig(provider: string): PiAiProviderConfigSnapshot {
  const providerId = provider.trim();
  if (!providerId) {
    return { baseUrl: '', apiKey: '', authMode: 'api-key', authConfigured: false };
  }

  const modelsJson = readModelsJson();
  const providerConfig = toRecord(modelsJson.providers[providerId]);
  const fromJsonBaseUrl = stringOrUndefined(providerConfig.baseUrl);
  const fromJsonApiKey = stringOrUndefined(providerConfig.apiKey);
  const fromJsonApi = stringOrUndefined(providerConfig.api);
  const auth = getPiAuthStatus(providerId);
  let baseUrl = fromJsonBaseUrl ?? PI_AI_PROVIDER_DEFAULT_BASE_URLS[providerId] ?? '';
  if (!baseUrl) {
    const builtInModels = safeGetModels(providerId);
    baseUrl = stringOrUndefined(builtInModels[0]?.baseUrl) ?? '';
  }

  return {
    baseUrl,
    api: fromJsonApi,
    apiKey: auth.source === 'models-json' ? fromJsonApiKey ?? '' : '',
    authMode: auth.source === 'oauth' ? 'subscription' : 'api-key',
    authConfigured: auth.configured,
    authSource: auth.source,
    authLabel: auth.label,
  };
}

export async function upsertPiAiProviderConfig(input: PiAiProviderConfigUpsertInput): Promise<void> {
  const provider = input.provider.trim();
  if (!provider) {
    throw new Error('provider is required.');
  }

  const parsed = readModelsJson();
  const providers = parsed.providers;
  const providerConfig = toRecord(providers[provider]);
  const nextProviderConfig: JsonRecord = { ...providerConfig };

  const normalizedBaseUrl = trimToUndefined(input.baseUrl);
  const normalizedApi = trimToUndefined(input.api);
  const normalizedApiKey = trimToUndefined(input.apiKey);

  if (normalizedBaseUrl) nextProviderConfig.baseUrl = normalizedBaseUrl;
  else delete nextProviderConfig.baseUrl;

  if (normalizedApi) nextProviderConfig.api = normalizedApi;
  else delete nextProviderConfig.api;

  delete nextProviderConfig.apiKey;

  if ((input.authMode === 'api-key' || !input.authMode) && normalizedApiKey) {
    await upsertPiAuthCredential({
      provider,
      apiKey: normalizedApiKey,
    });
  }

  if (input.authMode === 'subscription' && input.subscriptionCredentials) {
    await upsertPiAuthCredential({
      provider: input.subscriptionProvider?.trim() || provider,
      oauthCredentials: input.subscriptionCredentials,
    });
  }

  providers[provider] = nextProviderConfig;
  parsed.providers = providers;
  await writeModelsJson(parsed);
}

export async function upsertPiAiModelConfig(input: PiAiModelConfigUpsertInput): Promise<void> {
  const provider = input.provider.trim();
  const modelId = input.modelId.trim();
  if (!provider || !modelId) {
    throw new Error('provider and modelId are required.');
  }

  const parsed = readModelsJson();
  const providers = parsed.providers;
  const providerConfig = toRecord(providers[provider]);
  const nextProviderConfig: JsonRecord = { ...providerConfig };
  const normalizedBaseUrl = trimToUndefined(input.baseUrl);
  const normalizedApi = trimToUndefined(input.api);
  const normalizedLabel = trimToUndefined(input.modelLabel);

  if (normalizedBaseUrl) nextProviderConfig.baseUrl = normalizedBaseUrl;
  if (normalizedApi) nextProviderConfig.api = normalizedApi;

  const models = ensureArrayOfRecords(nextProviderConfig.models);
  const modelIndex = models.findIndex((item) => typeof item.id === 'string' && item.id === modelId);
  const existing = modelIndex >= 0 ? models[modelIndex] : {};
  const nextModel: JsonRecord = {
    ...existing,
    id: modelId,
  };
  if (normalizedLabel) nextModel.name = normalizedLabel;
  if (normalizedApi) nextModel.api = normalizedApi;
  if (normalizedBaseUrl) nextModel.baseUrl = normalizedBaseUrl;

  if (modelIndex >= 0) {
    models[modelIndex] = nextModel;
  } else {
    models.push(nextModel);
  }
  nextProviderConfig.models = models;
  providers[provider] = nextProviderConfig;
  parsed.providers = providers;
  await writeModelsJson(parsed);
}

function readModelsJson(): PiAiModelsJson {
  try {
    const { mtimeMs } = statSync(MODELS_JSON_PATH);
    if (cachedModelsJson && cachedModelsJsonMtimeMs === mtimeMs) {
      return cachedModelsJson;
    }
    const content = readFileSync(MODELS_JSON_PATH, 'utf-8');
    const parsed = parseModelsJson(content);
    cachedModelsJson = parsed;
    cachedModelsJsonMtimeMs = mtimeMs;
    return parsed;
  } catch {
    cachedModelsJson = { ...DEFAULT_MODELS_JSON, providers: {} };
    cachedModelsJsonMtimeMs = -1;
    return cachedModelsJson;
  }
}

function parseModelsJson(content: string): PiAiModelsJson {
  const parsed = JSON.parse(content) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('models.json must be an object.');
  }
  const record = parsed as JsonRecord;
  const providersRecord = toRecord(record.providers);
  const providers: Record<string, JsonRecord> = {};
  for (const [providerId, value] of Object.entries(providersRecord)) {
    providers[providerId] = toRecord(value);
  }
  return { providers };
}

function listCustomModels(provider: string, source: PiAiModelsJson): PiAiModelDescriptor[] {
  const providerConfig = toRecord(source.providers[provider]);
  const providerApi = stringOrUndefined(providerConfig.api);
  const providerBaseUrl = stringOrUndefined(providerConfig.baseUrl);
  const models = ensureArrayOfRecords(providerConfig.models);
  return models
    .map((model): PiAiModelDescriptor | null => {
      const id = stringOrUndefined(model.id);
      if (!id) return null;
      return {
        id,
        label: stringOrUndefined(model.name) ?? id,
        provider,
        api: stringOrUndefined(model.api) ?? providerApi,
        baseUrl: stringOrUndefined(model.baseUrl) ?? providerBaseUrl,
      };
    })
    .filter((item): item is PiAiModelDescriptor => item !== null);
}

async function writeModelsJson(data: PiAiModelsJson): Promise<void> {
  await mkdir(dirname(MODELS_JSON_PATH), { recursive: true });
  await writeFile(MODELS_JSON_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  cachedModelsJson = data;
  try {
    cachedModelsJsonMtimeMs = statSync(MODELS_JSON_PATH).mtimeMs;
  } catch {
    cachedModelsJsonMtimeMs = -1;
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT';
}

function toRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as JsonRecord;
}

function ensureArrayOfRecords(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is JsonRecord => typeof item === 'object' && item !== null && !Array.isArray(item));
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function trimToUndefined(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
