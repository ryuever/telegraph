import { describe, expect, it } from 'vitest'
import { BookmarkStore } from '../BookmarkStore'

describe('BookmarkStore', () => {
  it('toggle adds then removes a bookmark for the same messageId', () => {
    const store = new BookmarkStore(() => 1000)

    const added = store.toggle('m_1', 'first')
    expect(added.bookmarked).toBe(true)
    expect(added.record).toEqual({ messageId: 'm_1', label: 'first', createdAt: 1000 })
    expect(store.has('m_1')).toBe(true)

    const removed = store.toggle('m_1')
    expect(removed.bookmarked).toBe(false)
    expect(removed.record).toBeUndefined()
    expect(store.has('m_1')).toBe(false)
  })

  it('snapshot returns bookmarks sorted by createdAt with count', () => {
    let now = 100
    const store = new BookmarkStore(() => now)

    store.toggle('m_3')
    now = 50
    store.toggle('m_1')
    now = 200
    store.toggle('m_2')

    const snap = store.snapshot()
    expect(snap.count).toBe(3)
    expect(snap.bookmarks.map(b => b.messageId)).toEqual(['m_1', 'm_3', 'm_2'])
  })

  it('toggle without a label stores no label field', () => {
    const store = new BookmarkStore()
    const result = store.toggle('m_1')
    expect(result.record?.label).toBeUndefined()
  })

  it('clear wipes everything and returns the previous count', () => {
    const store = new BookmarkStore()
    store.toggle('a')
    store.toggle('b')
    store.toggle('c')
    expect(store.clear()).toBe(3)
    expect(store.snapshot()).toEqual({ bookmarks: [], count: 0 })
  })
})
