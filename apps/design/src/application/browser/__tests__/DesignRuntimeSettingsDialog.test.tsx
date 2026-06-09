import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { RuntimeSettings } from '@/packages/agent-protocol'
import { DesignRuntimeSettingsDialog } from '../DesignRuntimeSettingsDialog'
import {
  type DesignRuntimeSettings,
  loadDesignRuntimeSettings,
} from '../design-runtime-settings'
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
    const settings = loadDesignRuntimeSettings()

    expect(settings).toEqual(expect.objectContaining({
      backend: TELEGRAPH_DESIGN_BUILD_RUNTIME_ID,
      designSystem: {
        themePackId: 'shadcn-new-york-neutral',
      },
      taskCapabilityProfile: {
        kind: 'design-build',
        scopes: ['artifact:write', 'repo:read'],
        artifactPolicy: 'preview',
      },
    }))
  })

  it('saves a design-build run profile through onSave', () => {
    let saved: DesignRuntimeSettings | undefined
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
            saved = next
          }}
        />
      )
    })

    const profileSelect = container.querySelectorAll('select')[1]
    expect(profileSelect).not.toBeNull()

    act(() => {
      profileSelect.value = 'design-build'
      profileSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('button[aria-label="Save design settings"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(saved?.backend).toBe(TELEGRAPH_DESIGN_BUILD_RUNTIME_ID)
    expect(saved?.orchestration).toBe('none')
    expect(saved?.taskCapabilityProfile).toEqual({
      kind: 'design-build',
      scopes: ['artifact:write', 'repo:read'],
      artifactPolicy: 'preview',
    })
  })

  it('saves the selected theme pack through onSave', () => {
    let saved: DesignRuntimeSettings | undefined
    const settings: RuntimeSettings = {
      provider: 'minimax-cn',
      modelId: 'MiniMax-M2.7',
      backend: 'pi-ai',
      taskCapabilityProfile: { kind: 'design-build', scopes: ['artifact:write'], artifactPolicy: 'preview' },
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
            saved = next
          }}
        />
      )
    })

    const themeSelect = container.querySelectorAll('select')[0]
    expect(themeSelect).not.toBeNull()

    act(() => {
      themeSelect.value = 'studio-dark'
      themeSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('button[aria-label="Save design settings"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(saved?.designSystem).toEqual({
      themePackId: 'studio-dark',
    })
  })

  it('adds repo write scope when artifact apply after confirmation is enabled', () => {
    let saved: RuntimeSettings | undefined
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
            saved = next
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

    expect(saved?.backend).toBe(TELEGRAPH_DESIGN_BUILD_RUNTIME_ID)
    expect(saved?.taskCapabilityProfile).toEqual({
      kind: 'design-build',
      scopes: ['artifact:write', 'repo:read', 'repo:write'],
      artifactPolicy: 'apply-after-confirm',
    })
  })
})
