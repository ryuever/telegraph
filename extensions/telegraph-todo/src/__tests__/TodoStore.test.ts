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

  it('snapshot on an empty store returns zeroed-out counters', () => {
    const store = new TodoStore()
    const snap = store.snapshot()
    expect(snap).toEqual({ items: [], count: 0, pendingCount: 0 })
  })

  it('pendingCount only counts items with done === false', () => {
    const store = new TodoStore()
    store.add('pending-1')
    store.add('pending-2')
    store.add('pending-3')
    store.toggle(2) // mark pending-2 as done

    const snap = store.snapshot()
    expect(snap.count).toBe(3)
    expect(snap.pendingCount).toBe(2)
  })

  it('add returns the newly created item with correct shape', () => {
    const clock = () => 42
    const store = new TodoStore(clock)
    const item = store.add('fix the bug')

    expect(item).toEqual({ id: 1, text: 'fix the bug', done: false, createdAt: 42 })
  })

  it('toggle returns the updated item with flipped done flag', () => {
    const store = new TodoStore()
    store.add('task')
    const toggled = store.toggle(1)
    expect(toggled.done).toBe(true)
    expect(toggled.id).toBe(1)

    const toggledBack = store.toggle(1)
    expect(toggledBack.done).toBe(false)
  })

  it('remove returns the deleted item', () => {
    const store = new TodoStore()
    store.add('doomed')
    const removed = store.remove(1)
    expect(removed.text).toBe('doomed')
    expect(removed.id).toBe(1)
    expect(store.snapshot().count).toBe(0)
  })

  it('id assignment continues monotonically after remove (no id recycling)', () => {
    const store = new TodoStore()
    store.add('one')   // id 1
    store.add('two')   // id 2
    store.remove(1)    // delete id 1
    store.add('three') // id 3 (not 1)
    store.add('four')  // id 4
    store.remove(2)    // delete id 2
    store.add('five')  // id 5 (not 1 or 2)

    const ids = store.snapshot().items.map(i => i.id)
    expect(ids).toEqual([3, 4, 5])
  })

  it('clock injection allows deterministic createdAt timestamps', () => {
    let tick = 1000
    const store = new TodoStore(() => tick)
    store.add('first')  // createdAt = 1000
    tick += 100
    store.add('second') // createdAt = 1100

    const items = store.snapshot().items
    expect(items[0]!.createdAt).toBe(1000)
    expect(items[1]!.createdAt).toBe(1100)
  })

  it('clear on an empty store returns 0', () => {
    const store = new TodoStore()
    expect(store.clear()).toBe(0)
  })

  it('snapshot items reflect all mutations (add, toggle, remove)', () => {
    const store = new TodoStore()
    store.add('alpha')   // id=1, done=false
    store.add('bravo')   // id=2, done=false
    store.toggle(1)      // id=1, done=true
    store.remove(2)      // id=2 gone

    const snap = store.snapshot()
    expect(snap.count).toBe(1)
    expect(snap.pendingCount).toBe(0)
    expect(snap.items).toEqual([
      expect.objectContaining({ id: 1, text: 'alpha', done: true }),
    ])
  })
})
