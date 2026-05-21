import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AGENT_MODEL_SETTINGS_STORAGE_KEY,
} from '@/packages/agent/browser/runtime-settings-storage'
import type { RuntimeSettings } from '@/packages/agent-protocol'
import { DesignRuntimeSettingsDialog } from '../DesignRuntimeSettingsDialog'
import { loadDesignRuntimeSettings, saveDesignRuntimeSettings } from '../design-runtime-settings'
import { TELEGRAPH_DESIGN_BUILD_RUNTIME_ID } from '@/apps/design/application/common/design-build'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

describe('DesignRuntimeSettingsDialog', () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount()
      })
    }
    container?.remove()
    container = undefined
    root = undefined
  })

  it('loads design-build defaults when no runtime settings were saved', () => {
    const settings = loadDesignRuntimeSettings({
      getItem: () => null,
    })

    expect(settings).toEqual(expect.objectContaining({
      backend: TELEGRAPH_DESIGN_BUILD_RUNTIME_ID,
      taskCapabilityProfile: {
        kind: 'design-build',
        scopes: ['artifact:write', 'repo:read'],
        artifactPolicy: 'preview',
      },
    }))
  })

  it('normalizes saved chat backend settings to the design-build runtime', () => {
    const settings = loadDesignRuntimeSettings({
      getItem: key => key === AGENT_MODEL_SETTINGS_STORAGE_KEY
        ? JSON.stringify({
          provider: 'minimax-cn',
          modelId: 'MiniMax-M2.7',
          backend: 'pi-ai',
          orchestration: 'telegraph-subagents',
          taskCapabilityProfile: { kind: 'default' },
        } satisfies RuntimeSettings)
        : null,
    })

    expect(settings).toEqual(expect.objectContaining({
      provider: 'minimax-cn',
      modelId: 'MiniMax-M2.7',
      backend: TELEGRAPH_DESIGN_BUILD_RUNTIME_ID,
      orchestration: 'none',
      taskCapabilityProfile: { kind: 'default' },
    }))
  })

  it('saves a design-build run profile into runtime settings storage', () => {
    const storage = new Map<string, string>()
    const settings: RuntimeSettings = {
      provider: 'minimax-cn',
      modelId: 'MiniMax-M2.7',
      backend: 'pi-ai',
      taskCapabilityProfile: { kind: 'default' },
      extensionBlocklist: [],
    }

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <DesignRuntimeSettingsDialog
          open
          settings={settings}
          onClose={() => {}}
          onSave={next => {
            saveDesignRuntimeSettings(next, {
              setItem: (key, value) => { storage.set(key, value) },
            })
          }}
        />
      )
    })

    const profileSelect = container.querySelector('select')
    expect(profileSelect).not.toBeNull()

    act(() => {
      if (!profileSelect) return
      profileSelect.value = 'design-build'
      profileSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('button[aria-label="Save design settings"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const saved = JSON.parse(storage.get(AGENT_MODEL_SETTINGS_STORAGE_KEY) ?? '{}') as RuntimeSettings
    expect(saved.backend).toBe(TELEGRAPH_DESIGN_BUILD_RUNTIME_ID)
    expect(saved.orchestration).toBe('none')
    expect(saved.taskCapabilityProfile).toEqual({
      kind: 'design-build',
      scopes: ['artifact:write', 'repo:read'],
      artifactPolicy: 'preview',
    })
  })

  it('adds repo write scope when artifact apply after confirmation is enabled', () => {
    const storage = new Map<string, string>()
    const settings: RuntimeSettings = {
      provider: 'minimax-cn',
      modelId: 'MiniMax-M2.7',
      backend: 'pi-ai',
      taskCapabilityProfile: {
        kind: 'design-build',
        scopes: ['artifact:write', 'repo:read'],
        artifactPolicy: 'preview',
      },
      extensionBlocklist: [],
    }

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <DesignRuntimeSettingsDialog
          open
          settings={settings}
          onClose={() => {}}
          onSave={next => {
            saveDesignRuntimeSettings(next, {
              setItem: (key, value) => { storage.set(key, value) },
            })
          }}
        />
      )
    })

    act(() => {
      container
        ?.querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('button[aria-label="Save design settings"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const saved = JSON.parse(storage.get(AGENT_MODEL_SETTINGS_STORAGE_KEY) ?? '{}') as RuntimeSettings
    expect(saved.backend).toBe(TELEGRAPH_DESIGN_BUILD_RUNTIME_ID)
    expect(saved.taskCapabilityProfile).toEqual({
      kind: 'design-build',
      scopes: ['artifact:write', 'repo:read', 'repo:write'],
      artifactPolicy: 'apply-after-confirm',
    })
  })
})
