// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_TELEGRAPH_THEME_ID,
  TELEGRAPH_THEME_CHANGE_EVENT,
  TELEGRAPH_THEME_STORAGE_KEY,
  applyTelegraphTheme,
  initializeTelegraphTheme,
  setTelegraphTheme,
  subscribeToTelegraphThemeChange,
} from '@/packages/ui/theme'

class MemoryStorage implements Storage {
  private readonly entries = new Map<string, string>()

  get length(): number {
    return this.entries.size
  }

  clear(): void {
    this.entries.clear()
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.entries.delete(key)
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value)
  }
}

type BroadcastListener = (event: MessageEvent<unknown>) => void

class MockBroadcastChannel {
  private static readonly channels = new Set<MockBroadcastChannel>()
  private readonly listeners = new Set<BroadcastListener>()

  constructor(readonly name: string) {
    MockBroadcastChannel.channels.add(this)
  }

  postMessage(message: unknown): void {
    for (const channel of MockBroadcastChannel.channels) {
      if (channel === this || channel.name !== this.name) continue
      channel.emit(message)
    }
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type !== 'message' || typeof listener !== 'function') return
    this.listeners.add(listener)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (type !== 'message' || typeof listener !== 'function') return
    this.listeners.delete(listener)
  }

  close(): void {
    MockBroadcastChannel.channels.delete(this)
    this.listeners.clear()
  }

  private emit(message: unknown): void {
    const event = new MessageEvent('message', { data: message })
    for (const listener of this.listeners) {
      listener(event)
    }
  }

  static reset(): void {
    MockBroadcastChannel.channels.clear()
  }
}

describe('Telegraph theme manager', () => {
  let testStorage = new MemoryStorage()
  const originalBroadcastChannel = globalThis.BroadcastChannel

  beforeEach(() => {
    testStorage = new MemoryStorage()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: testStorage,
    })
  })

  afterEach(() => {
    testStorage.clear()
    MockBroadcastChannel.reset()
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      value: originalBroadcastChannel,
    })
    document.documentElement.removeAttribute('data-telegraph-theme')
    document.documentElement.className = ''
    document.documentElement.style.colorScheme = ''
  })

  it('initializes from storage and applies root theme attributes', () => {
    testStorage.setItem(TELEGRAPH_THEME_STORAGE_KEY, 'tweakcn-modern')

    expect(initializeTelegraphTheme()).toBe('tweakcn-modern')
    expect(document.documentElement.dataset.telegraphTheme).toBe('tweakcn-modern')
    expect(document.documentElement.classList.contains('light')).toBe(true)
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('persists selected themes and emits a same-window change event', () => {
    const received: string[] = []
    const unsubscribe = subscribeToTelegraphThemeChange(themeId => {
      received.push(themeId)
    })

    expect(setTelegraphTheme('catppuccin-mocha')).toBe('catppuccin-mocha')

    unsubscribe()
    expect(testStorage.getItem(TELEGRAPH_THEME_STORAGE_KEY)).toBe('catppuccin-mocha')
    expect(document.documentElement.dataset.telegraphTheme).toBe('catppuccin-mocha')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(received).toEqual(['catppuccin-mocha'])
  })

  it('falls back safely when an unknown theme is applied', () => {
    expect(applyTelegraphTheme('unknown-theme')).toBe(DEFAULT_TELEGRAPH_THEME_ID)
    expect(document.documentElement.dataset.telegraphTheme).toBe(DEFAULT_TELEGRAPH_THEME_ID)
  })

  it('ignores unrelated custom events', () => {
    const received: string[] = []
    const unsubscribe = subscribeToTelegraphThemeChange(themeId => {
      received.push(themeId)
    })

    window.dispatchEvent(new CustomEvent(TELEGRAPH_THEME_CHANGE_EVENT, { detail: { themeId: 42 } }))

    unsubscribe()
    expect(received).toEqual([])
  })

  it('applies theme changes broadcast from another window', () => {
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      value: MockBroadcastChannel,
    })

    const received: string[] = []
    const unsubscribe = subscribeToTelegraphThemeChange(themeId => {
      received.push(themeId)
    })

    const sender = new BroadcastChannel('telegraph-theme')
    sender.postMessage({ type: 'theme-change', themeId: 'nord-frost' })
    sender.close()

    unsubscribe()
    expect(document.documentElement.dataset.telegraphTheme).toBe('nord-frost')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(received).toEqual(['nord-frost'])
  })
})
