/**
 * Per-pagelet, in-memory bookmark store for the `@telegraph/bookmark`
 * extension. Bookmarks are addressed by `messageId` (the chat ChatMessage.id
 * issued by the browser-side use-chat hook) and carry an optional label.
 *
 * Like {@link TodoStore} in `@telegraph/todo`, the store is intentionally
 * non-persistent: bookmarks live for the pagelet's lifetime only. This keeps
 * the 4-pack demo focused on the Command contribution kind and avoids
 * touching the chat session-storage boundary.
 *
 * The browser-side ChatMessages component keeps its own renderer-side
 * mirror so the bookmark badge can re-render without an RPC round-trip on
 * every keystroke; the pagelet-side store is the source of truth and the
 * /bookmark command's `invoke` callback returns a fresh snapshot the
 * renderer overlays on top of its mirror.
 */

export interface BookmarkRecord {
  messageId: string
  label?: string
  createdAt: number
}

export interface BookmarkSnapshot {
  bookmarks: BookmarkRecord[]
  count: number
}

export class BookmarkStore {
  private readonly records = new Map<string, BookmarkRecord>()
  private readonly clock: () => number

  constructor(clock: () => number = () => Date.now()) {
    this.clock = clock
  }

  snapshot(): BookmarkSnapshot {
    const bookmarks = [...this.records.values()].sort((a, b) => a.createdAt - b.createdAt)
    return { bookmarks, count: bookmarks.length }
  }

  has(messageId: string): boolean {
    return this.records.has(messageId)
  }

  /**
   * Toggle the bookmark on a given messageId. Returns the new state so the
   * caller (typically a slash command) can surface "added" vs "removed" in
   * the confirmation message.
   */
  toggle(messageId: string, label?: string): { bookmarked: boolean; record?: BookmarkRecord } {
    const existing = this.records.get(messageId)
    if (existing) {
      this.records.delete(messageId)
      return { bookmarked: false }
    }
    const record: BookmarkRecord = { messageId, createdAt: this.clock() }
    if (label !== undefined) record.label = label
    this.records.set(messageId, record)
    return { bookmarked: true, record }
  }

  clear(): number {
    const removed = this.records.size
    this.records.clear()
    return removed
  }
}
