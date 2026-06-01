import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeSettings } from '@/packages/agent/types'
const { getOAuthApiKeyMock } = vi.hoisted(() => ({
  getOAuthApiKeyMock: vi.fn(),
}))

vi.mock('@mariozechner/pi-ai/oauth', () => ({
  getOAuthApiKey: getOAuthApiKeyMock,
}))

import { resolvePiAiApiKey } from '../resolvePiAiApiKey'

function baseSettings(): AgentRuntimeSettings {
  return {
    provider: 'openai',
    modelId: 'gpt-4o-mini',
    apiKey: 'test-key',
  }
}

describe('resolvePiAiApiKey', () => {
  beforeEach(() => {
    getOAuthApiKeyMock.mockReset()
  })

  it('uses api-key mode by default', async () => {
    const result = await resolvePiAiApiKey({
      ...baseSettings(),
      apiKey: '  key-from-user  ',
    })

    expect(result).toMatchObject({
      apiKey: 'key-from-user',
      authMode: 'api-key',
    })
    expect(getOAuthApiKeyMock).not.toHaveBeenCalled()
  })

  it('throws when api-key mode has no key', async () => {
    await expect(resolvePiAiApiKey({
      ...baseSettings(),
      apiKey: '   ',
    })).rejects.toThrow('apiKey must be configured')
  })

  it('resolves api key from subscription credentials', async () => {
    getOAuthApiKeyMock.mockResolvedValue({
      apiKey: 'oauth-api-key',
      newCredentials: {
        refresh: 'new-refresh',
        access: 'new-access',
        expires: 123,
      },
    })

    const result = await resolvePiAiApiKey({
      ...baseSettings(),
      apiKey: '',
      authMode: 'subscription',
      subscriptionProvider: 'openai-codex',
      subscriptionCredentials: {
        refresh: 'old-refresh',
        access: 'old-access',
        expires: 99,
      },
    })

    expect(getOAuthApiKeyMock).toHaveBeenCalledWith('openai-codex', {
      'openai-codex': {
        refresh: 'old-refresh',
        access: 'old-access',
        expires: 99,
      },
    })
    expect(result).toMatchObject({
      apiKey: 'oauth-api-key',
      authMode: 'subscription',
      refreshedSubscriptionCredentials: {
        refresh: 'new-refresh',
        access: 'new-access',
        expires: 123,
      },
    })
  })

  it('throws when subscription credentials are malformed', async () => {
    await expect(resolvePiAiApiKey({
      ...baseSettings(),
      apiKey: '',
      authMode: 'subscription',
      subscriptionProvider: 'openai-codex',
      subscriptionCredentials: { refresh: 'token' } as unknown as AgentRuntimeSettings['subscriptionCredentials'],
    })).rejects.toThrow('subscriptionCredentials must be valid')
  })
})
