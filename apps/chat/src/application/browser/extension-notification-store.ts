/**
 * Browser-side in-memory notification store for the 4-pack
 * `telegraph-completion-notify` extension demo (4-pack item D). The chat
 * pagelet pushes a {@link ChatExtensionNotificationStreamEvent} every time
 * an extension calls the chat-side notify capability
 * (`CHAT_NOTIFY_CAPABILITY_KEY = 'chat.notify'`); the chat surface needs to
 * surface those as a toast/banner without dropping them through the
 * conversation transcript or the LLM trace panel.
 *
 * Design notes (mirrored from `bookmark-store.ts`):
 *
 * - Manual subscribe/snapshot rather than zustand to stay in line with the
 *   rest of `apps/chat/browser/*`; the chat app deliberately does not pull
 *   in a state-management library.
 * - Snapshot identity is stable across calls when nothing changes, so
 *   `useSyncExternalStore` does not tear.
 * - The store is process-local and non-persistent. A page reload clears
 *   pending toasts — extensions that need durable delivery should emit a
 *   real chat message instead. This matches the "side-effect only,
 *   non-blocking" contract documented on the capability surface.
 * - Bounded to {@link NOTIFICATION_CAPACITY} entries. Once the cap is hit
 *   we drop the *oldest* entry to make room. A burst of notifications must
 *   not be allowed to grow unbounded across a long-lived chat session.
 * - Each entry is keyed by a synthetic `id` derived from the producer
 *   (extensionId) plus a monotonic counter. Renderer code never needs to
 *   know about that scheme — it just feeds the id back to
 *   {@link dismissNotification} when the user closes a toast.
 */

import type { ChatExtensionNotificationStreamEvent } from '@/apps/chat/application/common'

/** Hard cap on retained notifications; FIFO eviction beyond this. */
export const NOTIFICATION_CAPACITY = 8

/** Stored shape — superset of the stream event with a renderer-side id. */
export interface ExtensionNotificationEntry {
  /** Synthetic, monotonically increasing per store lifetime. */
  id: string
  extensionId: string
  level: 'info' | 'warn' | 'error'
  message: string
  runId?: string
  sessionId?: string
  /** Producer-supplied timestamp from the pagelet (Date.now()). */
  ts: number
}

let entries: ReadonlyArray<ExtensionNotificationEntry> = []
let idCounter = 0
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach(fn => { fn() })
}

/**
 * Subscribe to mutations. Returns an unsubscribe thunk suitable for
 * `useSyncExternalStore`.
 */
export function subscribeNotifications(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Snapshot of currently-visible notifications, oldest first. The returned
 * array is reference-stable across calls when nothing changed, so
 * `useSyncExternalStore` does not thrash.
 */
export function getNotificationsSnapshot(): ReadonlyArray<ExtensionNotificationEntry> {
  return entries
}

/**
 * Push a new entry derived from a stream event. The stream event itself is
 * the boundary type (defined in `apps/chat/application/common`); we accept
 * it directly so the chat panel can pipe events in without any adaptation.
 *
 * Returns the synthesized id so callers/tests can assert ordering.
 */
export function pushExtensionNotification(
  event: ChatExtensionNotificationStreamEvent,
): string {
  idCounter += 1
  const entry: ExtensionNotificationEntry = {
    id: `extnotif:${event.extensionId}:${String(idCounter)}`,
    extensionId: event.extensionId,
    level: event.level,
    message: event.message,
    runId: event.runId,
    sessionId: event.sessionId,
    ts: event.ts,
  }

  // FIFO eviction at capacity. The slice() call gives us a fresh array so
  // snapshot identity changes — required for useSyncExternalStore.
  const next = entries.length >= NOTIFICATION_CAPACITY
    ? [...entries.slice(entries.length - NOTIFICATION_CAPACITY + 1), entry]
    : [...entries, entry]
  entries = next
  emit()
  return entry.id
}

/**
 * Remove a single notification by id. No-op (and no listener notification)
 * if the id is unknown — e.g. the user dismissed a toast that had already
 * been evicted by a fresh burst.
 */
export function dismissNotification(id: string): void {
  if (!entries.some(item => item.id === id)) return
  entries = entries.filter(item => item.id !== id)
  emit()
}

/**
 * Clear every notification. Used by tests and would be used by a future
 * "clear all" UX affordance. Idempotent on an already-empty store.
 */
export function clearNotifications(): void {
  if (entries.length === 0) return
  entries = []
  emit()
}
