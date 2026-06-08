import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  addBookmark,
  clearBookmarks,
  getBookmarksSnapshot,
  isMessageBookmarked,
  subscribeBookmarks,
} from '../bookmark-store'

afterEach(() => {
  clearBookmarks()
})

describe('bookmark-store', () => {
  it('starts empty and reports falsy membership', () => {
    expect(getBookmarksSnapshot().size).toBe(0)
    expect(isMessageBookmarked('m_anything')).toBe(false)
  })

  it('adds a bookmark and notifies subscribers exactly once', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeBookmarks(listener)

    addBookmark('m_1')

    expect(isMessageBookmarked('m_1')).toBe(true)
    expect(getBookmarksSnapshot().has('m_1')).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('returns a new snapshot reference on mutation so useSyncExternalStore picks it up', () => {
    const before = getBookmarksSnapshot()
    addBookmark('m_a')
    const after = getBookmarksSnapshot()
    expect(after).not.toBe(before)
    expect(after.has('m_a')).toBe(true)
  })

  it('keeps the same reference when adding a duplicate (no rerender thrash)', () => {
    addBookmark('m_dup')
    const snapshot1 = getBookmarksSnapshot()
    const listener = vi.fn()
    const unsubscribe = subscribeBookmarks(listener)

    addBookmark('m_dup')

    const snapshot2 = getBookmarksSnapshot()
    expect(snapshot2).toBe(snapshot1)
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('ignores empty messageId so renderer typos do not poison the set', () => {
    addBookmark('')
    expect(getBookmarksSnapshot().size).toBe(0)
  })

  it('unsubscribes cleanly', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeBookmarks(listener)
    unsubscribe()
    addBookmark('m_after_unsub')
    expect(listener).not.toHaveBeenCalled()
  })

  it('clearBookmarks resets state and notifies', () => {
    addBookmark('m_1')
    addBookmark('m_2')
    const listener = vi.fn()
    const unsubscribe = subscribeBookmarks(listener)

    clearBookmarks()

    expect(getBookmarksSnapshot().size).toBe(0)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('clearBookmarks on an empty store is a no-op', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeBookmarks(listener)
    clearBookmarks()
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })
})
