import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/apps/main/application/browser/App'
import type { PageConfig } from '@/apps/main/application/common/cp-config'
import type { MainSwitchPagePayload } from '@/packages/services/pagelet-host/common'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

const rpcMock = vi.hoisted(() => ({
  switchPage: undefined as ((pageId: string, payload?: MainSwitchPagePayload) => void) | undefined,
  openSettingWindow: vi.fn(),
  applyWindowTheme: vi.fn(),
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
    onSwitchPage: vi.fn((callback: (pageId: string, payload?: MainSwitchPagePayload) => void) => {
      rpcMock.switchPage = callback
    }),
    openSettingWindow: rpcMock.openSettingWindow,
    applyWindowTheme: rpcMock.applyWindowTheme,
  },
}))

vi.mock('@/apps/main/application/browser/PageletHost', () => ({
  PageletHost: ({
    activePage,
    runConsoleFocus,
  }: {
    activePage: PageConfig
    runConsoleFocus?: MainSwitchPagePayload
  }) => (
    <>
      <div data-testid="active-page">{activePage.id}</div>
      <div data-testid="focused-run">{runConsoleFocus?.runId ?? ''}</div>
    </>
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
    rpcMock.applyWindowTheme.mockClear()
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
    expect(rpcMock.applyWindowTheme).toHaveBeenCalledWith({
      mode: 'dark',
      backgroundColor: '#0b0f17',
      accentColor: '#ff6542',
    })
  })

  it('persists sidebar page selection', () => {
    const app = renderApp()
    const chatButton = Array.from(app.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Chat')

    expect(chatButton).toBeDefined()

    act(() => {
      chatButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(app.querySelector('[data-testid="active-page"]')?.textContent).toBe('chat')
    expect(localStorageMock.getItem('telegraph.activePageId')).toBe('chat')
  })

  it('persists run console page selection', () => {
    const app = renderApp()
    const runsButton = Array.from(app.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Runs')

    expect(runsButton).toBeDefined()

    act(() => {
      runsButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(app.querySelector('[data-testid="active-page"]')?.textContent).toBe('run-console')
    expect(localStorageMock.getItem('telegraph.activePageId')).toBe('run-console')
  })

  it('opens settings from the account avatar menu', () => {
    const app = renderApp()
    const accountButton = Array.from(app.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Open account menu')

    expect(accountButton).toBeDefined()

    act(() => {
      accountButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const menuItem = Array.from(app.querySelectorAll('[role="menuitem"]'))
      .find((item) => item.textContent === 'Setting')

    expect(menuItem).toBeDefined()

    act(() => {
      menuItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(rpcMock.openSettingWindow).toHaveBeenCalledTimes(1)
    expect(localStorageMock.getItem('telegraph.settingWindowPage')).toBe('settings')
    expect(app.querySelector('[role="menu"]')).toBeNull()
  })

  it('opens dev from the account avatar menu', () => {
    const app = renderApp()
    const accountButton = Array.from(app.querySelectorAll('button'))
      .find((button) => button.getAttribute('aria-label') === 'Open account menu')

    expect(accountButton).toBeDefined()

    act(() => {
      accountButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const menuItem = Array.from(app.querySelectorAll('[role="menuitem"]'))
      .find((item) => item.textContent === 'Dev')

    expect(menuItem).toBeDefined()

    act(() => {
      menuItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(rpcMock.openSettingWindow).toHaveBeenCalledTimes(1)
    expect(localStorageMock.getItem('telegraph.settingWindowPage')).toBe('dev')
    expect(app.querySelector('[role="menu"]')).toBeNull()
  })

  it('restores the run console after a renderer remount', () => {
    localStorageMock.setItem('telegraph.activePageId', 'run-console')

    const app = renderApp()

    expect(app.querySelector('[data-testid="active-page"]')?.textContent).toBe('run-console')
  })

  it('persists page switches requested by the main window service', () => {
    const app = renderApp()

    act(() => {
      rpcMock.switchPage?.('connection')
    })

    expect(app.querySelector('[data-testid="active-page"]')?.textContent).toBe('connection')
    expect(localStorageMock.getItem('telegraph.activePageId')).toBe('connection')
  })

  it('passes open-run focus payloads into the run console', () => {
    const app = renderApp()

    act(() => {
      rpcMock.switchPage?.('run-console', { runId: 'run-open', pageletId: 'design' })
    })

    expect(app.querySelector('[data-testid="active-page"]')?.textContent).toBe('run-console')
    expect(app.querySelector('[data-testid="focused-run"]')?.textContent).toBe('run-open')
  })
})
