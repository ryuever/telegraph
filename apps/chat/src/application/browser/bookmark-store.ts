/**
 * Browser-side in-memory bookmark store for the 4-pack `telegraph-bookmark`
 * extension demo. The extension itself owns the canonical bookmark list
 * inside the chat pagelet (see `extensions/telegraph-bookmark/src/BookmarkStore.ts`),
 * but renderer code needs a separate observable surface so the
 * `ChatMessages` component can paint a bookmark badge on bookmarked
 * assistant messages without round-tripping to the pagelet on every render.
 *
 * Design notes:
 *
 * - This store mirrors the *messageId set* only. It does not duplicate
 *   message content or labels; those still live on the `ChatMessage`
 *   objects produced by `use-chat`.
 * - It is intentionally process-local and non-persistent. Reloading the
 *   chat surface clears it. The extension's pagelet-side store can later
 *   be wired to persist or rehydrate, but that's out of scope for the
 *   4-pack demo (M-style UX, not a real feature).
 * - The shape mirrors `llm-trace-store.ts` (manual subscribe/snapshot)
 *   rather than introducing zustand or a heavier dep — the chat app
 *   doesn't ship zustand and we don't need its selector machinery for a
 *   single Set.
 */

let bookmarkedIds: ReadonlySet<string> = new Set<string>()
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach(fn => { fn(); })
}

/**
 * Subscribe to bookmark-set mutations. Returns an unsubscribe thunk
 * suitable for `useSyncExternalStore`.
 */
export function subscribeBookmarks(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener); }
}

/**
 * Snapshot of the current bookmarked-message-id set. Reference-stable
 * across calls if nothing has changed, so `useSyncExternalStore` doesn't
 * tear or thrash.
 */
export function getBookmarksSnapshot(): ReadonlySet<string> {
  return bookmarkedIds
}

/** Returns `true` iff `messageId` is currently bookmarked. */
export function isMessageBookmarked(messageId: string): boolean {
  return bookmarkedIds.has(messageId)
}

/**
 * Mark `messageId` as bookmarked. Idempotent — re-bookmarking the same
 * id is a no-op (no listener notification, no new Set allocation).
 * This is the only mutator the chat layer needs because the demo UX
 * never unbookmarks (per 4-pack scope discussion).
 */
export function addBookmark(messageId: string): void {
  if (!messageId || bookmarkedIds.has(messageId)) return
  const next = new Set(bookmarkedIds)
  next.add(messageId)
  bookmarkedIds = next
  emit()
}

/**
 * Reset the entire bookmark set. Used by tests and would be used by a
 * future "clear bookmarks" UX. Not wired to any UI today.
 */
export function clearBookmarks(): void {
  if (bookmarkedIds.size === 0) return
  bookmarkedIds = new Set<string>()
  emit()
}
