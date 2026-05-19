import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CHAT_PAGE, DESIGN_PAGE } from '@/apps/main/application/common/cp-config'
import { PageletHost } from '@/apps/main/application/browser/PageletHost'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/apps/connection/application/browser/PageView', () => ({
  default: () => <div data-testid="page-connection">Connection slot</div>,
}))

vi.mock('@/apps/monitor/application/browser/MonitorPage', () => ({
  default: () => <div data-testid="page-monitor">Monitor slot</div>,
}))

vi.mock('@/apps/design/application/browser/DesignPanel', () => ({
  DesignPanel: () => <div data-testid="page-design">Design slot</div>,
}))

vi.mock('@/apps/chat/application/browser/ChatPage', () => ({
  default: () => <div data-testid="page-chat">Chat slot</div>,
}))

describe('PageletHost', () => {
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

  it('keeps visited pagelets mounted while hiding inactive pagelets', () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    act(() => {
      root?.render(<PageletHost activePage={DESIGN_PAGE} />)
    })

    expect(container.querySelector('[data-testid="page-design"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="page-chat"]')).toBeNull()

    act(() => {
      root?.render(<PageletHost activePage={CHAT_PAGE} />)
    })

    const designSlot = container.querySelector('[data-testid="page-design"]')
    const chatSlot = container.querySelector('[data-testid="page-chat"]')

    expect(designSlot).not.toBeNull()
    expect(chatSlot).not.toBeNull()
    expect(designSlot?.closest('section')?.hidden).toBe(true)
    expect(chatSlot?.closest('section')?.hidden).toBe(false)
  })
})
