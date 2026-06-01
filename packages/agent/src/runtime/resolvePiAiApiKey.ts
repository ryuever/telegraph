import { getOAuthApiKey, type OAuthCredentials } from '@mariozechner/pi-ai/oauth'
import type { AgentRuntimeSettings } from '@/packages/agent/types'

export interface ResolvedPiAiApiKey {
  apiKey: string
  authMode: 'api-key' | 'subscription'
  refreshedSubscriptionCredentials?: OAuthCredentials
}

export async function resolvePiAiApiKey(settings: AgentRuntimeSettings): Promise<ResolvedPiAiApiKey> {
  const authMode = settings.authMode === 'subscription' ? 'subscription' : 'api-key'

  if (authMode === 'api-key') {
    const apiKey = settings.apiKey.trim()
    if (!apiKey) {
      throw new Error('Chat model settings are required: apiKey must be configured for api-key mode.')
    }
    return {
      apiKey,
      authMode,
    }
  }

  const providerId = (settings.subscriptionProvider ?? settings.provider).trim()
  if (!providerId) {
    throw new Error('Chat model settings are required: subscriptionProvider must be configured for subscription mode.')
  }

  const credentials = toOAuthCredentials(settings.subscriptionCredentials)
  if (!credentials) {
    throw new Error('Chat model settings are required: subscriptionCredentials must be valid OAuth credentials for subscription mode.')
  }

  const oauthResult = await getOAuthApiKey(providerId, {
    [providerId]: credentials,
  })
  if (!oauthResult || !oauthResult.apiKey.trim()) {
    throw new Error(`Subscription auth not configured for provider "${providerId}".`)
  }

  return {
    apiKey: oauthResult.apiKey.trim(),
    authMode,
    refreshedSubscriptionCredentials: oauthResult.newCredentials,
  }
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
