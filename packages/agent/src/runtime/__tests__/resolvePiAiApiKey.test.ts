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
  let previousEnvKey: string | undefined
  let previousWorkspaceRoot: string | undefined

  beforeEach(() => {
    getOAuthApiKeyMock.mockReset()
    tempDir = mkdtempSync(join(tmpdir(), 'telegraph-agent-config-'))
    previousEnvKey = process.env.TELEGRAPH_UNIT_API_KEY
    previousWorkspaceRoot = process.env.TELEGRAPH_WORKSPACE_ROOT
    process.env.TELEGRAPH_WORKSPACE_ROOT = tempDir
    delete process.env.TELEGRAPH_UNIT_API_KEY
  })

  afterEach(() => {
    if (previousWorkspaceRoot === undefined) {
      delete process.env.TELEGRAPH_WORKSPACE_ROOT
    } else {
      process.env.TELEGRAPH_WORKSPACE_ROOT = previousWorkspaceRoot
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

  it('resolves api keys from project .env.local', async () => {
    writeProjectEnv('project-config-key')

    const result = await resolvePiAiApiKey({
      ...baseSettings(),
      apiKey: '',
    })

    expect(result).toMatchObject({
      apiKey: 'project-config-key',
      authMode: 'api-key',
      source: 'project-config',
    })
  })

  it('resolves env references from project config api keys', async () => {
    process.env.TELEGRAPH_UNIT_API_KEY = 'env-ref-key'
    writeProjectEnv('', 'TELEGRAPH_UNIT_API_KEY')

    await expect(resolvePiAiApiKey({
      ...baseSettings(),
      apiKey: '',
    })).resolves.toMatchObject({
      apiKey: 'env-ref-key',
      source: 'project-config',
    })
  })

  it('resolves env references from project .env.local', async () => {
    writeProjectEnv('local-env-file-key', 'TELEGRAPH_UNIT_API_KEY')

    await expect(resolvePiAiApiKey({
      ...baseSettings(),
      apiKey: '',
    })).resolves.toMatchObject({
      apiKey: 'local-env-file-key',
      source: 'project-config',
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

function writeProjectEnv(apiKey: string, apiKeyEnvName = 'TELEGRAPH_UNIT_API_KEY'): void {
  writeFileSync(join(tempDir, '.env.local'), [
    `TELEGRAPH_AGENT_RUNTIME=${JSON.stringify({ provider: 'unit-provider', modelId: 'gpt-4o-mini', authMode: 'api-key' })}`,
    `TELEGRAPH_AGENT_PROVIDERS=${JSON.stringify({
      'unit-provider': {
        name: 'Unit Provider',
        api: 'openai-completions',
        apiKeyEnv: apiKeyEnvName,
        models: [{ id: 'gpt-4o-mini', name: 'gpt-4o-mini' }],
      },
    })}`,
    apiKey ? `${apiKeyEnvName}=${apiKey}` : '',
    '',
  ].filter(Boolean).join('\n'), 'utf-8')
}
