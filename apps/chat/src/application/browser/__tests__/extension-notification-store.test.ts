import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatExtensionNotificationStreamEvent } from '@/apps/chat/application/common'
import {
  NOTIFICATION_CAPACITY,
  clearNotifications,
  dismissNotification,
  getNotificationsSnapshot,
  pushExtensionNotification,
  subscribeNotifications,
} from '../extension-notification-store'

afterEach(() => {
  clearNotifications()
})

function makeEvent(
  overrides: Partial<ChatExtensionNotificationStreamEvent> = {},
): ChatExtensionNotificationStreamEvent {
  return {
    type: 'extension_notification',
    extensionId: '@telegraph/completion-notify',
    level: 'info',
    message: 'Run completed',
    ts: 1_700_000_000_000,
    ...overrides,
  }
}

describe('extension-notification-store', () => {
  it('starts empty', () => {
    expect(getNotificationsSnapshot()).toHaveLength(0)
  })

  it('pushes a notification, notifies, returns synthesized id', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeNotifications(listener)

    const id = pushExtensionNotification(makeEvent())

    expect(id).toMatch(/^extnotif:@telegraph\/completion-notify:\d+$/)
    expect(getNotificationsSnapshot()).toHaveLength(1)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('returns a new snapshot reference per mutation (useSyncExternalStore safety)', () => {
    const before = getNotificationsSnapshot()
    pushExtensionNotification(makeEvent())
    const after = getNotificationsSnapshot()
    expect(after).not.toBe(before)
  })

  it('preserves insertion order (oldest first)', () => {
    pushExtensionNotification(makeEvent({ message: 'first' }))
    pushExtensionNotification(makeEvent({ message: 'second' }))
    pushExtensionNotification(makeEvent({ message: 'third' }))
    expect(getNotificationsSnapshot().map(e => e.message)).toEqual([
      'first',
      'second',
      'third',
    ])
  })

  it('copies stream-event fields into the stored entry', () => {
    pushExtensionNotification(makeEvent({
      extensionId: '@me/ext',
      level: 'warn',
      message: 'hi',
      runId: 'run_1',
      sessionId: 'sess_1',
      ts: 42,
    }))
    const entry = getNotificationsSnapshot()[0]
    expect(entry).toMatchObject({
      extensionId: '@me/ext',
      level: 'warn',
      message: 'hi',
      runId: 'run_1',
      sessionId: 'sess_1',
      ts: 42,
    })
  })

  it('evicts the oldest entry when capacity is exceeded', () => {
    for (let i = 0; i < NOTIFICATION_CAPACITY + 3; i += 1) {
      pushExtensionNotification(makeEvent({ message: `msg-${String(i)}` }))
    }
    const snap = getNotificationsSnapshot()
    expect(snap).toHaveLength(NOTIFICATION_CAPACITY)
    // Oldest three were dropped.
    expect(snap[0].message).toBe('msg-3')
    expect(snap[snap.length - 1].message).toBe(
      `msg-${String(NOTIFICATION_CAPACITY + 2)}`,
    )
  })

  it('dismiss removes the entry and notifies', () => {
    const id1 = pushExtensionNotification(makeEvent({ message: 'a' }))
    pushExtensionNotification(makeEvent({ message: 'b' }))
    const listener = vi.fn()
    const unsubscribe = subscribeNotifications(listener)

    dismissNotification(id1)

    expect(getNotificationsSnapshot().map(e => e.message)).toEqual(['b'])
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('dismiss is a no-op (and no listener fire) for unknown ids', () => {
    pushExtensionNotification(makeEvent())
    const listener = vi.fn()
    const unsubscribe = subscribeNotifications(listener)

    dismissNotification('extnotif:unknown:999')

    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('clearNotifications empties the store and notifies', () => {
    pushExtensionNotification(makeEvent({ message: 'a' }))
    pushExtensionNotification(makeEvent({ message: 'b' }))
    const listener = vi.fn()
    const unsubscribe = subscribeNotifications(listener)

    clearNotifications()

    expect(getNotificationsSnapshot()).toHaveLength(0)
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
  })

  it('clearNotifications on empty is a no-op', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeNotifications(listener)
    clearNotifications()
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
  })

  it('unsubscribes cleanly', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeNotifications(listener)
    unsubscribe()
    pushExtensionNotification(makeEvent())
    expect(listener).not.toHaveBeenCalled()
  })

  it('ids are monotonically distinct even for the same extension', () => {
    const id1 = pushExtensionNotification(makeEvent())
    const id2 = pushExtensionNotification(makeEvent())
    expect(id1).not.toBe(id2)
  })
})
