import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/apps/main/application/browser/App'
import type { PageConfig } from '@/apps/main/application/common/cp-config'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

const rpcMock = vi.hoisted(() => ({
  switchPage: undefined as ((pageId: string) => void) | undefined,
  openSettingWindow: vi.fn(),
}))

const localStorageMock = vi.hoisted(() => {
  let values = new Map<string, string>()

  return {
    clear: vi.fn(() => {
      values = new Map()
    }),
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
  }
})

vi.mock('@/apps/main/application/browser/rpc-clients', () => ({
  mainWindowClient: {
    onSwitchPage: vi.fn((callback: (pageId: string) => void) => {
      rpcMock.switchPage = callback
    }),
    openSettingWindow: rpcMock.openSettingWindow,
  },
}))

vi.mock('@/apps/main/application/browser/PageletHost', () => ({
  PageletHost: ({ activePage }: { activePage: PageConfig }) => (
    <div data-testid="active-page">{activePage.id}</div>
  ),
}))

describe('App page navigation', () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  beforeEach(() => {
    vi.stubGlobal('localStorage', localStorageMock)
    localStorageMock.clear()
    rpcMock.switchPage = undefined
    rpcMock.openSettingWindow.mockClear()
  })

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount()
      })
    }
    container?.remove()
    container = undefined
    root = undefined
    vi.unstubAllGlobals()
  })

  function renderApp(): HTMLDivElement {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    act(() => {
      root?.render(<App />)
    })

    return container
  }

  it('restores the last selected page after a renderer remount', () => {
    localStorageMock.setItem('telegraph.activePageId', 'chat')

    const app = renderApp()

    expect(app.querySelector('[data-testid="active-page"]')?.textContent).toBe('chat')
  })

  it('persists sidebar page selection', () => {
    const app = renderApp()
    const chatButton = Array.from(app.querySelectorAll('button'))
      .find((button) => button.textContent.includes('Chat'))

    expect(chatButton).toBeDefined()

    act(() => {
      chatButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(app.querySelector('[data-testid="active-page"]')?.textContent).toBe('chat')
    expect(localStorageMock.getItem('telegraph.activePageId')).toBe('chat')
  })

  it('persists page switches requested by the main window service', () => {
    const app = renderApp()

    act(() => {
      rpcMock.switchPage?.('connection')
    })

    expect(app.querySelector('[data-testid="active-page"]')?.textContent).toBe('connection')
    expect(localStorageMock.getItem('telegraph.activePageId')).toBe('connection')
  })
})
