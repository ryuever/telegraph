import { describe, expect, it } from 'vitest'
import {
  type ChatModelSettings,
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  toRuntimeSettings,
} from '../model-settings'
import { AGENT_MODEL_SETTINGS_STORAGE_KEY } from '@/packages/agent/browser/runtime-settings-storage'

describe('chat model settings', () => {
  it('normalizes the internal orchestrator backend away from persisted chat settings', () => {
    installLocalStorage()
    const settings: ChatModelSettings = {
      ...DEFAULT_SETTINGS,
      backend: 'pi-ai',
      taskCapabilityProfile: {
        kind: 'shell-automation',
        commands: ['git', 'pnpm'],
        cwdPolicy: 'workspace',
      },
    }

    saveSettings(settings)

    expect(loadSettings()).toMatchObject({
      backend: 'pi-ai',
    })
    expect(toRuntimeSettings(settings)).toMatchObject({
      backend: 'pi-ai',
      taskCapabilityProfile: {
        kind: 'shell-automation',
        commands: ['git', 'pnpm'],
        cwdPolicy: 'workspace',
      },
    })
  })

  it('normalizes unknown partial storage values against defaults', () => {
    installLocalStorage()
    globalThis.localStorage.setItem(AGENT_MODEL_SETTINGS_STORAGE_KEY, JSON.stringify({
      provider: 'minimax-cn',
      modelId: 'MiniMax-M2.7',
      backend: 'pi-ai',
      taskCapabilityProfile: {
        kind: 'coding-edit',
        scopes: ['repo:read', 123, 'repo:write'],
        patchPolicy: 'apply-after-confirm',
      },
    }))

    expect(loadSettings()).toMatchObject({
      provider: 'minimax-cn',
      modelId: 'MiniMax-M2.7',
      backend: 'pi-ai',
      apiKey: '',
      orchestration: 'none',
      orchestrationPattern: 'chain',
      worktreeIsolation: false,
      extensionBlocklist: [],
      taskCapabilityProfile: {
        kind: 'coding-edit',
        scopes: ['repo:read', 'repo:write'],
        patchPolicy: 'apply-after-confirm',
      },
    })
  })

  it('does not persist provider credentials from the chat settings surface', () => {
    installLocalStorage()

    saveSettings({
      ...DEFAULT_SETTINGS,
      apiKey: 'legacy-local-key',
      baseUrl: 'https://example.test/v1',
      subscriptionCredentials: {
        refresh: 'refresh-token',
        access: 'access-token',
        expires: 123,
      },
    })

    expect(loadSettings()).toMatchObject({
      apiKey: '',
      baseUrl: undefined,
      subscriptionCredentials: undefined,
    })
  })
})

function installLocalStorage(): void {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
      clear: () => { values.clear(); },
    },
  })
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: globalThis.localStorage,
    },
  })
}
