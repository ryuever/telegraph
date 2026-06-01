import { complete, findEnvKeys, getModel, getModels, getProviders } from '@mariozechner/pi-ai';
import {
  getOAuthApiKey,
  getOAuthProvider,
  getOAuthProviders,
  type OAuthCredentials,
} from '@mariozechner/pi-ai/oauth';
import type {
  PiAiConnectionTestInput,
  PiAiConnectionTestResult,
  PiAiModelDescriptor,
  PiAiProviderDescriptor,
} from '@/apps/setting/application/common';

type ModelLike = { id?: string; name?: string; api?: string };

const getModelsLoose = getModels as unknown as (provider: string) => ModelLike[];
const getModelLoose = getModel as unknown as (provider: string, modelId: string) => unknown;
const DEFAULT_TEST_TIMEOUT_MS = 15000;

const BEDROCK_PROVIDER_ID = 'amazon-bedrock';

const API_KEY_LOGIN_PROVIDERS: Partial<Record<string, string>> = {
  anthropic: 'Anthropic',
  [BEDROCK_PROVIDER_ID]: 'Amazon Bedrock',
  'azure-openai-responses': 'Azure OpenAI Responses',
  cerebras: 'Cerebras',
  'cloudflare-workers-ai': 'Cloudflare Workers AI',
  deepseek: 'DeepSeek',
  fireworks: 'Fireworks',
  google: 'Google Gemini',
  'google-vertex': 'Google Vertex AI',
  groq: 'Groq',
  huggingface: 'Hugging Face',
  'kimi-coding': 'Kimi For Coding',
  mistral: 'Mistral',
  minimax: 'MiniMax',
  'minimax-cn': 'MiniMax (China)',
  opencode: 'OpenCode Zen',
  'opencode-go': 'OpenCode Go',
  openai: 'OpenAI',
  openrouter: 'OpenRouter',
  'vercel-ai-gateway': 'Vercel AI Gateway',
  xai: 'xAI',
  zai: 'ZAI',
};

const BUILT_IN_API_KEY_LOGIN_PROVIDERS = new Set(Object.keys(API_KEY_LOGIN_PROVIDERS));
const OAUTH_ONLY_LOGIN_PROVIDERS = new Set([
  'github-copilot',
  'openai-codex',
]);

export function listPiAiProviders(): PiAiProviderDescriptor[] {
  const oauthProviders = getOAuthProviders();
  const oauthProviderIds = new Set(oauthProviders.map((provider) => provider.id));
  const oauthProviderNames = new Map(oauthProviders.map((provider) => [provider.id, provider.name]));
  const modelProviderIds = new Set(getProviders());
  const allProviderIds = new Set<string>([...modelProviderIds, ...oauthProviderIds]);

  return [...allProviderIds]
    .map((providerId) => {
      const models = safeGetModels(providerId);
      const supportsSubscription = oauthProviderIds.has(providerId);
      const supportsApiKey = isApiKeyLoginProvider(providerId, oauthProviderIds, modelProviderIds);
      const environmentKeyName = findEnvKeys(providerId)?.[0];
      return {
        id: providerId,
        displayName: oauthProviderNames.get(providerId) ??
          API_KEY_LOGIN_PROVIDERS[providerId] ??
          providerId,
        modelCount: models.length,
        supportsSubscription,
        supportsApiKey,
        environmentKeyName,
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export function listPiAiModels(provider: string): PiAiModelDescriptor[] {
  if (!provider.trim()) return [];
  try {
    return getModelsLoose(provider)
      .map((model) => ({
        id: model.id ?? '',
        label: model.name ?? model.id ?? 'unknown-model',
        provider,
        api: model.api,
      }))
      .filter((model) => model.id.length > 0)
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return [];
  }
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

function isApiKeyLoginProvider(
  providerId: string,
  oauthProviderIds: ReadonlySet<string>,
  builtInProviderIds: ReadonlySet<string>,
): boolean {
  if (BUILT_IN_API_KEY_LOGIN_PROVIDERS.has(providerId)) {
    return true;
  }
  if (builtInProviderIds.has(providerId)) {
    // Keep API-key mode resilient as pi-ai adds new built-in providers.
    return !OAUTH_ONLY_LOGIN_PROVIDERS.has(providerId);
  }
  return !oauthProviderIds.has(providerId);
}
