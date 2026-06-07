import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentRuntimeSettings } from '@/packages/agent/types'
const { getOAuthApiKeyMock } = vi.hoisted(() => ({
  getOAuthApiKeyMock: vi.fn(),
}))

vi.mock('@mariozechner/pi-ai/oauth', () => ({
  getOAuthApiKey: getOAuthApiKeyMock,
}))

import { resolvePiAiApiKey } from '../resolvePiAiApiKey'

let tempDir = ''

function baseSettings(): AgentRuntimeSettings {
  return {
    provider: 'unit-provider',
    modelId: 'gpt-4o-mini',
    apiKey: 'test-key',
  }
}

describe('resolvePiAiApiKey', () => {
  let previousPiAgentDir: string | undefined
  let previousEnvKey: string | undefined

  beforeEach(() => {
    getOAuthApiKeyMock.mockReset()
    tempDir = mkdtempSync(join(tmpdir(), 'telegraph-pi-auth-'))
    previousPiAgentDir = process.env.PI_CODING_AGENT_DIR
    previousEnvKey = process.env.TELEGRAPH_UNIT_API_KEY
    process.env.PI_CODING_AGENT_DIR = tempDir
    delete process.env.TELEGRAPH_UNIT_API_KEY
  })

  afterEach(() => {
    if (previousPiAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR
    } else {
      process.env.PI_CODING_AGENT_DIR = previousPiAgentDir
    }
    if (previousEnvKey === undefined) {
      delete process.env.TELEGRAPH_UNIT_API_KEY
    } else {
      process.env.TELEGRAPH_UNIT_API_KEY = previousEnvKey
    }
    rmSync(tempDir, { recursive: true, force: true })
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

  it('throws when no credential source is configured', async () => {
    await expect(resolvePiAiApiKey({
      ...baseSettings(),
      apiKey: '   ',
    })).rejects.toThrow('no API key found')
  })

  it('resolves api keys from auth.json', async () => {
    writeAuthJson({
      'unit-provider': { type: 'api_key', key: 'auth-json-key' },
    })

    const result = await resolvePiAiApiKey({
      ...baseSettings(),
      apiKey: '',
    })

    expect(result).toMatchObject({
      apiKey: 'auth-json-key',
      authMode: 'api-key',
      source: 'auth-json',
    })
  })

  it('interpolates env references from auth.json api keys', async () => {
    process.env.TELEGRAPH_UNIT_API_KEY = 'env-ref-key'
    writeAuthJson({
      'unit-provider': { type: 'api_key', key: '$TELEGRAPH_UNIT_API_KEY' },
    })

    await expect(resolvePiAiApiKey({
      ...baseSettings(),
      apiKey: '',
    })).resolves.toMatchObject({
      apiKey: 'env-ref-key',
      source: 'auth-json',
    })
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
    })).rejects.toThrow('no API key found')
  })
})

function writeAuthJson(value: Record<string, unknown>): void {
  writeFileSync(join(tempDir, 'auth.json'), JSON.stringify(value, null, 2), 'utf-8')
}
