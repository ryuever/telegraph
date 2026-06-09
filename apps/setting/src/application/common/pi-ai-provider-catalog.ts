import type { PiAiProviderDescriptor } from './index';

/** Mirrors pi-mono coding-agent `API_KEY_LOGIN_PROVIDERS`. */
export const PI_AI_API_KEY_PROVIDER_NAMES: Readonly<Record<string, string>> = {
  anthropic: 'Anthropic',
  'amazon-bedrock': 'Amazon Bedrock',
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

/** Mirrors pi-ai built-in OAuth providers (`getOAuthProviders()`). */
export const PI_AI_OAUTH_PROVIDER_NAMES: Readonly<Record<string, string>> = {
  anthropic: 'Anthropic (Claude Pro/Max)',
  'github-copilot': 'GitHub Copilot',
  'google-gemini-cli': 'Google Cloud Code Assist (Gemini CLI)',
  'google-antigravity': 'Antigravity (Gemini 3, Claude, GPT-OSS)',
  'openai-codex': 'ChatGPT Plus/Pro (Codex Subscription)',
};

const OAUTH_PROVIDER_IDS = new Set(Object.keys(PI_AI_OAUTH_PROVIDER_NAMES));

/** Built-in defaults from pi-ai model registry (provider-level). */
export const PI_AI_PROVIDER_DEFAULT_BASE_URLS: Readonly<Partial<Record<string, string>>> = {
  anthropic: 'https://api.anthropic.com',
  'amazon-bedrock': 'https://bedrock-runtime.us-east-1.amazonaws.com',
  cerebras: 'https://api.cerebras.ai/v1',
  'cloudflare-workers-ai': 'https://api.cloudflare.com/client/v4/accounts/{account_id}/ai/run',
  deepseek: 'https://api.deepseek.com',
  fireworks: 'https://api.fireworks.ai/inference',
  google: 'https://generativelanguage.googleapis.com/v1beta',
  groq: 'https://api.groq.com/openai/v1',
  huggingface: 'https://router.huggingface.co/v1',
  'kimi-coding': 'https://api.kimi.com/coding',
  mistral: 'https://api.mistral.ai',
  minimax: 'https://api.minimax.io/anthropic',
  'minimax-cn': 'https://api.minimaxi.com/anthropic',
  opencode: 'https://opencode.ai/zen/v1',
  'opencode-go': 'https://opencode.ai/zen/go/v1',
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  'vercel-ai-gateway': 'https://ai-gateway.vercel.sh',
  xai: 'https://api.x.ai/v1',
  zai: 'https://api.z.ai/api/coding/paas/v4',
};

export function buildPiAiProviderCatalog(
  customProviderIds: string[] = [],
  environmentKeyByProvider: Readonly<Record<string, string | undefined>> = {},
): PiAiProviderDescriptor[] {
  const byId = new Map<string, PiAiProviderDescriptor>();

  for (const [id, displayName] of Object.entries(PI_AI_API_KEY_PROVIDER_NAMES)) {
    byId.set(id, {
      id,
      displayName,
      modelCount: 0,
      supportsSubscription: OAUTH_PROVIDER_IDS.has(id),
      supportsApiKey: true,
      environmentKeyName: environmentKeyByProvider[id],
    });
  }

  for (const [id, displayName] of Object.entries(PI_AI_OAUTH_PROVIDER_NAMES)) {
    const existing = byId.get(id);
    if (existing) {
      byId.set(id, {
        ...existing,
        displayName: existing.displayName,
        supportsSubscription: true,
      });
      continue;
    }
    byId.set(id, {
      id,
      displayName,
      modelCount: 0,
      supportsSubscription: true,
      supportsApiKey: false,
      environmentKeyName: environmentKeyByProvider[id],
    });
  }

  for (const id of customProviderIds) {
    if (!id.trim() || byId.has(id)) continue;
    byId.set(id, {
      id,
      displayName: id,
      modelCount: 0,
      supportsSubscription: OAUTH_PROVIDER_IDS.has(id),
      supportsApiKey: !OAUTH_PROVIDER_IDS.has(id),
      environmentKeyName: environmentKeyByProvider[id],
    });
  }

  return [...byId.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}
