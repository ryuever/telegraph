import { getModel, type Api, type Model } from '@mariozechner/pi-ai'
import type { AgentRuntimeSettings, ModelDescriptor } from '@/packages/agent/types'
import {
  createMiniMaxOpenAIModel,
  MINIMAX_OPENAI_BASE_URL,
} from '@/packages/agent/providers/minimax'
import {
  applyPiModelOverridesFromFiles,
  resolvePiModelFromFiles,
} from '@/packages/agent/runtime/pi-ai-provider-config'

/** Provider id used for MiniMax's first-class (Anthropic-messages) entry. */
export const MINIMAX_PROVIDER_ID = 'minimax'
/** Provider id used for the China-region MiniMax (api.minimaxi.com). */
export const MINIMAX_CN_PROVIDER_ID = 'minimax-cn'
/** Synthetic provider id for the OpenAI-compatible escape hatch. */
export const MINIMAX_OPENAI_COMPAT_PROVIDER_ID = 'minimax-openai-compat'

/**
 * The default catalog of models the chat picker offers. Add new entries here.
 *
 *   - Built-in pi-ai providers (anthropic, openai, minimax, …) use
 *     `kind: 'builtin'` — they go through `getModel()` and pick up pi-ai's
 *     known costs / context windows.
 *   - Custom OpenAI-compatible deployments use `kind: 'custom'` with a
 *     pre-built Model.
 */
export const DEFAULT_MODEL_CATALOG: ModelDescriptor[] = [
  { kind: 'builtin', provider: MINIMAX_PROVIDER_ID, id: 'MiniMax-M2.7', label: 'MiniMax · M2.7' },
  { kind: 'builtin', provider: MINIMAX_PROVIDER_ID, id: 'MiniMax-M2.7-highspeed', label: 'MiniMax · M2.7 highspeed' },
  { kind: 'builtin', provider: MINIMAX_CN_PROVIDER_ID, id: 'MiniMax-M2.7', label: 'MiniMax (CN) · M2.7' },
  { kind: 'builtin', provider: MINIMAX_CN_PROVIDER_ID, id: 'MiniMax-M2.7-highspeed', label: 'MiniMax (CN) · M2.7 highspeed' },
  {
    kind: 'custom',
    provider: MINIMAX_OPENAI_COMPAT_PROVIDER_ID,
    id: 'MiniMax-Text-01',
    label: 'MiniMax (OpenAI-compat) · Text-01',
    model: createMiniMaxOpenAIModel({ id: 'MiniMax-Text-01' }),
  },
  { kind: 'builtin', provider: 'anthropic', id: 'claude-sonnet-4-5', label: 'Anthropic · Claude Sonnet 4.5' },
  { kind: 'builtin', provider: 'openai', id: 'gpt-4o-mini', label: 'OpenAI · GPT-4o mini' },
  { kind: 'builtin', provider: 'openai', id: 'gpt-4o', label: 'OpenAI · GPT-4o' },
]

/**
 * Resolve runtime settings into a concrete pi-ai Model. The OpenAI-compat
 * synthetic provider honors the user's `baseUrl` so they can point at a
 * proxy / regional endpoint without editing code.
 */
export function resolveModel(settings: AgentRuntimeSettings): Model<Api> | undefined {
  if (settings.provider === MINIMAX_OPENAI_COMPAT_PROVIDER_ID) {
    return createMiniMaxOpenAIModel({
      id: settings.modelId,
      baseUrl: settings.baseUrl ?? MINIMAX_OPENAI_BASE_URL,
    })
  }

  const configuredModel = resolvePiModelFromFiles(settings)
  if (configuredModel) return configuredModel

  // pi-ai's getModel signature is heavily generic; we don't know the literal
  // provider/modelId at compile time here, so we cast at the boundary.
  try {
    const model = (getModel as unknown as (p: string, m: string) => Model<Api>)(
      settings.provider,
      settings.modelId
    )
    return applyPiModelOverridesFromFiles(settings, model)
  } catch {
    return undefined
  }
}

export {
  createMiniMaxOpenAIModel,
  MINIMAX_OPENAI_BASE_URL,
}
