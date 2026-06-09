import { complete, findEnvKeys, getModel, getModels } from '@mariozechner/pi-ai';
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
  type PiAiRuntimeConfigSnapshot,
} from '@/apps/setting/application/common';
import {
  getProjectModelFileConfig,
  getProjectLocalEnvPath,
  getProjectProviderFileConfig,
  getProjectProviderStatus,
  listProjectConfiguredModels,
  readProjectRuntimeSettings,
  resolveProjectConfigValue,
  upsertProjectModelConfig,
  upsertProjectProviderConfig,
  writeProjectLocalEnvValue,
} from '@/packages/agent/runtime/project-agent-config';
import { resolvePiModelFromFiles } from '@/packages/agent/runtime/pi-ai-provider-config';

type ModelLike = { id?: string; name?: string; api?: string; baseUrl?: string };

const getModelsLoose = getModels as unknown as (provider: string) => ModelLike[];
const getModelLoose = getModel as unknown as (provider: string, modelId: string) => unknown;
const DEFAULT_TEST_TIMEOUT_MS = 15000;

export function listPiAiProviders(): PiAiProviderDescriptor[] {
  const runtime = readProjectRuntimeSettings();
  const customProviderIds = runtime.provider ? [runtime.provider] : [];
  const catalog = buildPiAiProviderCatalog(customProviderIds);
  const environmentKeyByProvider: Record<string, string | undefined> = {};
  for (const provider of catalog) {
    environmentKeyByProvider[provider.id] = findEnvKeys(provider.id)?.[0];
  }
  return buildPiAiProviderCatalog(customProviderIds, environmentKeyByProvider).map((provider) => {
    const auth = getProjectProviderStatus(provider.id);
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
  for (const model of listProjectConfiguredModels().filter(item => item.provider === provider)) {
    merged.set(model.id, {
      ...merged.get(model.id),
      id: model.id,
      label: model.label,
      provider,
      api: model.api,
      baseUrl: model.baseUrl,
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

    const apiKey = await resolveConnectionTestApiKey(input);
    const model = resolvePiModelFromFiles({
      provider,
      modelId,
      apiKey: '',
      authMode: input.authMode,
    }) ?? getModelLoose(provider, modelId);
    if (!model) {
      throw new Error(`Unknown model "${modelId}" for provider "${provider}".`);
    }

    const response = await complete(
      model as never,
      {
        messages: [{ role: 'user', content: 'Reply with pong.', timestamp: Date.now() }],
      },
      {
        apiKey,
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
      resolvedApiKey: apiKey,
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

export function getPiAiProviderConfig(provider: string): PiAiProviderConfigSnapshot {
  const providerId = provider.trim();
  if (!providerId) {
    return { baseUrl: '', apiKey: '', authMode: 'api-key', authConfigured: false };
  }

  const providerConfig = getProjectProviderFileConfig(providerId);
  const runtime = readProjectRuntimeSettings();
  const selectedModelConfig = runtime.provider === providerId && runtime.modelId
    ? getProjectModelFileConfig(providerId, runtime.modelId)
    : undefined;
  const configuredDescriptor = listProjectConfiguredModels().find(item => item.provider === providerId);
  const auth = getProjectProviderStatus(providerId);
  let baseUrl = providerConfig.baseUrl ?? PI_AI_PROVIDER_DEFAULT_BASE_URLS[providerId] ?? '';
  if (!baseUrl) {
    const builtInModels = safeGetModels(providerId);
    baseUrl = stringOrUndefined(builtInModels[0]?.baseUrl) ?? '';
  }

  return {
    modelId: selectedModelConfig?.id ?? configuredDescriptor?.id,
    modelLabel: selectedModelConfig?.name ?? configuredDescriptor?.label,
    baseUrl,
    api: providerConfig.api ?? selectedModelConfig?.api ?? configuredDescriptor?.api,
    apiKey: '',
    apiKeyEnvName: providerConfig.apiKey?.startsWith('env:') ? providerConfig.apiKey.slice('env:'.length).trim() : undefined,
    apiKeyConfigured: auth.configured,
    authMode: runtime.provider === providerId && runtime.authMode === 'subscription' ? 'subscription' : 'api-key',
    authConfigured: auth.configured,
    authSource: auth.source,
    authLabel: auth.label,
  };
}

export function getPiAiRuntimeConfig(): PiAiRuntimeConfigSnapshot {
  const runtime = readProjectRuntimeSettings();
  const provider = runtime.provider ?? 'zai';
  const modelId = runtime.modelId ?? 'glm-5.1';
  return {
    provider,
    modelId,
    ...getPiAiProviderConfig(provider),
  };
}

export async function upsertPiAiProviderConfig(input: PiAiProviderConfigUpsertInput): Promise<void> {
  const apiKeyEnvName = normalizeEnvName(input.apiKeyEnvName);
  if (apiKeyEnvName && input.apiKey?.trim()) {
    await writeProjectLocalEnvValue(apiKeyEnvName, input.apiKey.trim());
  }
  await upsertProjectProviderConfig({
    provider: input.provider,
    baseUrl: input.baseUrl,
    api: input.api,
    apiKey: apiKeyEnvName ? `env:${apiKeyEnvName}` : input.apiKey,
  });
  if (input.modelId?.trim()) {
    await upsertProjectModelConfig({
      provider: input.provider,
      modelId: input.modelId.trim(),
      modelLabel: input.modelLabel?.trim() || input.modelId.trim(),
      api: input.api,
      baseUrl: input.baseUrl,
    });
  }
}

export async function upsertPiAiModelConfig(input: PiAiModelConfigUpsertInput): Promise<void> {
  await upsertProjectModelConfig(input);
}

async function resolveConnectionTestApiKey(input: PiAiConnectionTestInput): Promise<string> {
  if (input.authMode === 'subscription') {
    throw new Error('Subscription auth is no longer stored globally. Use an api-key provider in project .env.');
  }

  const direct = await resolveProjectConfigValue(input.apiKey ?? '');
  if (direct) return direct;

  const providerConfig = getProjectProviderFileConfig(input.provider);
  if (providerConfig.apiKey) {
    const configured = await resolveProjectConfigValue(providerConfig.apiKey);
    if (configured) return configured;
  }

  throw new Error(`API key is required. Configure ${getProjectLocalEnvPath()} or its referenced environment variable.`);
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

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function normalizeEnvName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed) ? trimmed : undefined;
}
