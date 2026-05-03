import {
  DEFAULT_MODEL_CATALOG,
  MINIMAX_OPENAI_BASE_URL,
  MINIMAX_OPENAI_COMPAT_PROVIDER_ID,
  MINIMAX_PROVIDER_ID,
  type AgentRuntimeSettings,
  type ModelDescriptor,
} from '@telegraph/agent'

export type { AgentRuntimeSettings, ModelDescriptor }

const STORAGE_KEY = 'telegraph.chat.modelSettings.v1'

/**
 * Pre-seeded MiniMax key supplied by the user during the initial scaffolding
 * of this feature. Written to localStorage on first load only — once the user
 * opens settings and edits anything, their value wins. Wipe the key above to
 * re-seed.
 */
const SEED_MINIMAX_KEY =
  'sk-cp-J69E7LZrhfF2k-9UWBHMCIk1qsDgA2HuFd6eEEpOIzgcFfEAVg16obe5OPmZfurGJe6e_o1eaWdyuFiLtGWKR-laVaoairdt67_zFML4I6HPq-jRLEWSwX8'

export interface PerProviderSettings {
  apiKey: string
  /** Only honored by `minimax-openai-compat`; pi-ai's first-class providers carry their own baseUrl. */
  baseUrl?: string
}

export interface ChatModelSettings {
  provider: string
  modelId: string
  /** Per-provider creds keyed by provider id, so switching providers keeps each one's setup. */
  byProvider: Record<string, PerProviderSettings>
}

export const DEFAULT_SETTINGS: ChatModelSettings = {
  provider: MINIMAX_PROVIDER_ID,
  modelId: 'MiniMax-M2.7',
  byProvider: {
    // The same MiniMax key works against both the Anthropic-messages endpoint
    // (first-class `minimax`) and the OpenAI-compatible escape hatch.
    [MINIMAX_PROVIDER_ID]: { apiKey: SEED_MINIMAX_KEY },
    [MINIMAX_OPENAI_COMPAT_PROVIDER_ID]: { apiKey: SEED_MINIMAX_KEY, baseUrl: MINIMAX_OPENAI_BASE_URL },
  },
}

export function loadSettings(): ChatModelSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS))
      return DEFAULT_SETTINGS
    }
    const parsed = JSON.parse(raw) as Partial<ChatModelSettings>
    return {
      provider: parsed.provider ?? DEFAULT_SETTINGS.provider,
      modelId: parsed.modelId ?? DEFAULT_SETTINGS.modelId,
      byProvider: { ...DEFAULT_SETTINGS.byProvider, ...(parsed.byProvider ?? {}) },
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

export function toRuntimeSettings(settings: ChatModelSettings): AgentRuntimeSettings {
  const per = settings.byProvider[settings.provider] ?? { apiKey: '' }
  return {
    provider: settings.provider,
    modelId: settings.modelId,
    apiKey: per.apiKey,
    baseUrl: per.baseUrl,
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
