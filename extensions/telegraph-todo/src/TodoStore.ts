/**
 * Per-pagelet, in-memory scratch-pad todo store.
 *
 * The 4-pack `telegraph-todo` extension owns one instance for the lifetime
 * of the pagelet utility process. The store is intentionally NOT persisted:
 *
 *  - It exists as a *scratch pad* the model can use to keep track of
 *    intermediate work inside a single chat session.
 *  - Persisting across restarts would require coordinating with the chat
 *    pagelet's session storage, which is out of scope for a contribution-kind
 *    demo (and would conflict with the "every contribution kind has a real
 *    consumer, nothing more" 4-pack principle).
 *
 * Items are addressed by short numeric ids (`#1`, `#2`, …) assigned in
 * insertion order. Reusing a removed id is allowed: gaps are filled by the
 * next monotonically-increasing free integer to keep the surface predictable
 * for an LLM that may try `op: 'remove', id: 1` then `op: 'add', text: '...'`
 * back-to-back in a single turn.
 */

export interface TodoItem {
  /** Stable numeric id, assigned at add time. Stays unique within the store's lifetime. */
  id: number
  /** Human-readable task text, trimmed at write time. */
  text: string
  /** Completion flag. Flipped by `op: 'toggle'`. */
  done: boolean
  /** Wall-clock creation timestamp, in epoch ms. */
  createdAt: number
}

export interface TodoSnapshot {
  /** Items in insertion order. */
  items: TodoItem[]
  /** Total count (convenience for the LLM, equal to items.length). */
  count: number
  /** Count of items with `done === false`. */
  pendingCount: number
}

export class TodoStore {
  private nextId = 1
  private readonly items = new Map<number, TodoItem>()
  private readonly clock: () => number

  constructor(clock: () => number = () => Date.now()) {
    this.clock = clock
  }

  snapshot(): TodoSnapshot {
    const items = [...this.items.values()]
    const pendingCount = items.reduce((acc, item) => acc + (item.done ? 0 : 1), 0)
    return { items, count: items.length, pendingCount }
  }

  add(text: string): TodoItem {
    const trimmed = text.trim()
    if (!trimmed) throw new Error('todo_write: text must be a non-empty string')
    const id = this.nextId
    this.nextId += 1
    const item: TodoItem = { id, text: trimmed, done: false, createdAt: this.clock() }
    this.items.set(id, item)
    return item
  }

  toggle(id: number): TodoItem {
    const item = this.items.get(id)
    if (!item) throw new Error(`todo_write: no item with id ${String(id)}`)
    const updated: TodoItem = { ...item, done: !item.done }
    this.items.set(id, updated)
    return updated
  }

  remove(id: number): TodoItem {
    const item = this.items.get(id)
    if (!item) throw new Error(`todo_write: no item with id ${String(id)}`)
    this.items.delete(id)
    return item
  }

  clear(): number {
    const removed = this.items.size
    this.items.clear()
    return removed
  }
}
