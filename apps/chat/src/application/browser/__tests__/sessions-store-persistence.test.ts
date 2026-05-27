import { beforeEach, describe, expect, it, vi } from 'vitest'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

beforeEach(() => {
  vi.resetModules()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  })
})

describe('chat session persistence', () => {
  it('keeps an intentionally empty session list empty after reload', async () => {
    localStorage.setItem('telegraph:sessions', '[]')
    localStorage.setItem('telegraph:activeSessionId', '')

    const { useSessionsStore } = await import('@/packages/stores')

    expect(useSessionsStore.getState().sessions).toEqual([])
    expect(useSessionsStore.getState().activeSessionId).toBeNull()
  })

  it('does not resurrect a deleted session through upsert backfill', async () => {
    const { isSessionDeleted, useSessionsStore } = await import('@/packages/stores')

    useSessionsStore.getState().deleteSession('session-from-ledger')
    useSessionsStore.getState().upsertSession('session-from-ledger', 'Old remote chat')

    expect(isSessionDeleted('session-from-ledger')).toBe(true)
    expect(useSessionsStore.getState().sessions.some(session => session.id === 'session-from-ledger')).toBe(false)
  })

  it('allows explicit session loads to clear a deleted marker', async () => {
    const { isSessionDeleted, useSessionsStore } = await import('@/packages/stores')

    useSessionsStore.getState().deleteSession('restored-session')
    useSessionsStore.getState().loadSessions([
      { id: 'restored-session', title: 'Restored', createdAt: 1, updatedAt: 1 },
    ])

    expect(isSessionDeleted('restored-session')).toBe(false)
    expect(useSessionsStore.getState().sessions).toEqual([
      { id: 'restored-session', title: 'Restored', createdAt: 1, updatedAt: 1 },
    ])
  })
})
