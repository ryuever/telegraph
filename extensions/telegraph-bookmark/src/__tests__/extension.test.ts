import {
  CapabilityHost,
  type CapabilityHookRegistrar,
} from '@/packages/agent-capabilities'
import { describe, expect, it } from 'vitest'
import extension, {
  TELEGRAPH_BOOKMARK_STORE_KEY,
  type BookmarkCommandResult,
} from '../extension'
import { BookmarkStore } from '../BookmarkStore'

function noopHooks(): CapabilityHookRegistrar {
  return { on: () => () => {} }
}

function createHost(): CapabilityHost {
  return new CapabilityHost(noopHooks())
}

function expectSyncCleanup(value: unknown): () => void {
  expect(typeof value).toBe('function')
  return value as () => void
}

describe('telegraph-bookmark extension factory', () => {
  it('registers the bookmark command on the host and exposes its store under TELEGRAPH_BOOKMARK_STORE_KEY', () => {
    const host = createHost()
    const cleanup = expectSyncCleanup(extension({ host, hooks: noopHooks() }))

    const command = host.getCommand('bookmark')
    expect(command?.id).toBe('bookmark')
    expect(command?.command).toBe('/bookmark')
    expect(typeof command?.invoke).toBe('function')

    expect(host.getCustom(TELEGRAPH_BOOKMARK_STORE_KEY)).toBeInstanceOf(BookmarkStore)
    cleanup()
  })

  it('invoke toggles the bookmark and returns a fresh snapshot', () => {
    const host = createHost()
    const cleanup = expectSyncCleanup(extension({ host, hooks: noopHooks() }))
    const command = host.getCommand('bookmark')!

    const added = command.invoke!({ messageId: 'm_1', label: 'pin me' }) as BookmarkCommandResult
    expect(added.bookmarked).toBe(true)
    expect(added.snapshot.count).toBe(1)
    expect(added.snapshot.bookmarks[0]).toMatchObject({ messageId: 'm_1', label: 'pin me' })

    const removed = command.invoke!({ messageId: 'm_1' }) as BookmarkCommandResult
    expect(removed.bookmarked).toBe(false)
    expect(removed.snapshot.count).toBe(0)
    cleanup()
  })

  it('invoke surfaces actionable errors when args shape is wrong', () => {
    const host = createHost()
    const cleanup = expectSyncCleanup(extension({ host, hooks: noopHooks() }))
    const command = host.getCommand('bookmark')!

    expect(() => command.invoke!(undefined)).toThrow(/"messageId" field/)
    expect(() => command.invoke!({})).toThrow(/"messageId" must be a non-empty string/)
    expect(() => command.invoke!({ messageId: '' })).toThrow(/"messageId" must be a non-empty string/)
    expect(() => command.invoke!({ messageId: 42 })).toThrow(/"messageId" must be a non-empty string/)
    cleanup()
  })

  it('cleanup wipes the store but leaves the command registration on the host', () => {
    const host = createHost()
    const cleanup = expectSyncCleanup(extension({ host, hooks: noopHooks() }))
    const command = host.getCommand('bookmark')!
    command.invoke!({ messageId: 'm_pre' })

    cleanup()

    expect(host.getCommand('bookmark')).toBeDefined()
    const store = host.getCustom(TELEGRAPH_BOOKMARK_STORE_KEY) as BookmarkStore
    expect(store.snapshot()).toEqual({ bookmarks: [], count: 0 })
  })
})
