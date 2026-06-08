import { describe, expect, it } from 'vitest'
import { TodoStore } from '../TodoStore'

describe('TodoStore', () => {
  it('add appends items in insertion order with monotonically increasing ids', () => {
    const store = new TodoStore(() => 1000)
    store.add('first')
    store.add('second')
    store.add('third')

    const snap = store.snapshot()
    expect(snap.count).toBe(3)
    expect(snap.pendingCount).toBe(3)
    expect(snap.items.map(i => i.id)).toEqual([1, 2, 3])
    expect(snap.items.map(i => i.text)).toEqual(['first', 'second', 'third'])
    expect(snap.items.every(i => i.done === false)).toBe(true)
    expect(snap.items.every(i => i.createdAt === 1000)).toBe(true)
  })

  it('add trims whitespace and rejects empty / whitespace-only text', () => {
    const store = new TodoStore()
    store.add('   spaced   ')
    expect(store.snapshot().items[0]?.text).toBe('spaced')

    expect(() => store.add('')).toThrow('non-empty')
    expect(() => store.add('   ')).toThrow('non-empty')
  })

  it('toggle flips the done flag and round-trips back', () => {
    const store = new TodoStore()
    store.add('task')
    const id = store.snapshot().items[0]!.id

    store.toggle(id)
    expect(store.snapshot().items[0]?.done).toBe(true)
    expect(store.snapshot().pendingCount).toBe(0)

    store.toggle(id)
    expect(store.snapshot().items[0]?.done).toBe(false)
    expect(store.snapshot().pendingCount).toBe(1)
  })

  it('toggle/remove on unknown id throws with the id surfaced in the message', () => {
    const store = new TodoStore()
    expect(() => store.toggle(99)).toThrow(/id 99/)
    expect(() => store.remove(99)).toThrow(/id 99/)
  })

  it('remove deletes the item without recycling its id', () => {
    const store = new TodoStore()
    store.add('one')
    store.add('two')
    store.remove(1)
    store.add('three')

    const ids = store.snapshot().items.map(i => i.id)
    expect(ids).toEqual([2, 3])
  })

  it('clear wipes everything and returns the previous count', () => {
    const store = new TodoStore()
    store.add('a')
    store.add('b')

    const removed = store.clear()
    expect(removed).toBe(2)
    expect(store.snapshot()).toEqual({ items: [], count: 0, pendingCount: 0 })
  })
})
