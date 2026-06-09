import { describe, expect, it } from 'vitest'
import {
  type ChatModelSettings,
  DEFAULT_SETTINGS,
  loadSettings,
  toRuntimeSettings,
} from '../model-settings'

describe('chat model settings', () => {
  it('normalizes chat settings into runtime settings', () => {
    const settings: ChatModelSettings = {
      ...DEFAULT_SETTINGS,
      backend: 'pi-ai',
      taskCapabilityProfile: {
        kind: 'shell-automation',
        commands: ['git', 'pnpm'],
        cwdPolicy: 'workspace',
      },
    }

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

  it('does not forward provider credentials from the chat settings surface', () => {
    const runtime = toRuntimeSettings({
      ...DEFAULT_SETTINGS,
      apiKey: 'legacy-local-key',
      baseUrl: 'https://example.test/v1',
      subscriptionCredentials: {
        refresh: 'refresh-token',
        access: 'access-token',
        expires: 123,
      },
    })

    expect(runtime).toMatchObject({
      apiKey: '',
      baseUrl: undefined,
      subscriptionCredentials: undefined,
    })
  })
})
