import { describe, expect, it } from 'vitest'
import {
  AGENT_MODEL_SETTINGS_STORAGE_KEY,
  LEGACY_CHAT_MODEL_SETTINGS_STORAGE_KEY,
  readRuntimeSettingsFromStorage,
  writeRuntimeSettingsToStorage,
} from '../runtime-settings-storage'

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('runtime settings storage', () => {
  it('reads the shared agent key before the legacy chat key', () => {
    const storage = new MemoryStorage()
    storage.setItem(LEGACY_CHAT_MODEL_SETTINGS_STORAGE_KEY, JSON.stringify({ provider: 'legacy', modelId: 'legacy-model' }))
    storage.setItem(AGENT_MODEL_SETTINGS_STORAGE_KEY, JSON.stringify({ provider: 'agent', modelId: 'agent-model' }))

    expect(readRuntimeSettingsFromStorage(storage)).toMatchObject({
      provider: 'agent',
      modelId: 'agent-model',
    })
  })

  it('writes both shared and legacy keys during migration', () => {
    const storage = new MemoryStorage()

    writeRuntimeSettingsToStorage({
      provider: 'p',
      modelId: 'm',
      apiKey: 'k',
      backend: 'pi-ai',
      taskCapabilityProfile: {
        kind: 'readonly-workspace',
        scopes: ['repo:read'],
      },
    }, storage)

    expect(JSON.parse(storage.getItem(AGENT_MODEL_SETTINGS_STORAGE_KEY) ?? '{}')).toMatchObject({
      provider: 'p',
      modelId: 'm',
      apiKey: 'k',
      backend: 'pi-ai',
      taskCapabilityProfile: {
        kind: 'readonly-workspace',
        scopes: ['repo:read'],
      },
    })
    expect(storage.getItem(LEGACY_CHAT_MODEL_SETTINGS_STORAGE_KEY)).toBe(storage.getItem(AGENT_MODEL_SETTINGS_STORAGE_KEY))
  })

  it('normalizes task capability profiles from storage', () => {
    const storage = new MemoryStorage()
    storage.setItem(AGENT_MODEL_SETTINGS_STORAGE_KEY, JSON.stringify({
      taskCapabilityProfile: {
        kind: 'shell-automation',
        commands: ['git', 42, 'pnpm'],
        cwdPolicy: 'restricted',
      },
    }))

    expect(readRuntimeSettingsFromStorage(storage)).toMatchObject({
      taskCapabilityProfile: {
        kind: 'shell-automation',
        commands: ['git', 'pnpm'],
        cwdPolicy: 'restricted',
      },
    })
  })
})
