import {
  CapabilityHost,
  type CapabilityHookRegistrar,
} from '@/packages/agent-capabilities'
import { describe, expect, it } from 'vitest'
import extension, { TELEGRAPH_TODO_STORE_KEY } from '../extension'
import { TodoStore } from '../TodoStore'

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

describe('telegraph-todo extension factory', () => {
  it('registers todo_read and todo_write tool capabilities on the host', () => {
    const host = createHost()
    const cleanup = expectSyncCleanup(extension({ host, hooks: noopHooks() }))

    const tools = host.listTools().map(t => t.name).sort()
    expect(tools).toEqual(['todo_read', 'todo_write'])

    const read = host.getTool('todo_read')
    const write = host.getTool('todo_write')
    expect(read?.definition.metadata?.provider).toBe('telegraph')
    expect(read?.definition.metadata?.sourceExtensionId).toBe('@telegraph/todo')
    expect(write?.definition.metadata?.sourceExtensionId).toBe('@telegraph/todo')
    cleanup()
  })

  it('publishes its TodoStore under TELEGRAPH_TODO_STORE_KEY so pagelets can inspect it', () => {
    const host = createHost()
    const cleanup = expectSyncCleanup(extension({ host, hooks: noopHooks() }))
    expect(host.getCustom(TELEGRAPH_TODO_STORE_KEY)).toBeInstanceOf(TodoStore)
    cleanup()
  })

  it('end-to-end: add via todo_write then read via todo_read returns the new item', async () => {
    const host = createHost()
    const cleanup = expectSyncCleanup(extension({ host, hooks: noopHooks() }))

    const write = host.getTool('todo_write')!
    const read = host.getTool('todo_read')!

    const afterAdd = (await write.execute({ op: 'add', text: 'wire up demo' })) as {
      items: Array<{ id: number; text: string; done: boolean }>
      count: number
      pendingCount: number
    }
    expect(afterAdd.count).toBe(1)
    expect(afterAdd.items[0]?.text).toBe('wire up demo')

    const snapshot = (await read.execute({})) as { items: Array<{ id: number; text: string }> }
    expect(snapshot.items).toEqual(afterAdd.items)
    cleanup()
  })

  it('todo_write validates input shape with actionable error messages', async () => {
    const host = createHost()
    const cleanup = expectSyncCleanup(extension({ host, hooks: noopHooks() }))
    const write = host.getTool('todo_write')!

    await expect(write.execute({ op: 'bogus' })).rejects.toThrow(/unknown op/)
    await expect(write.execute({ op: 'add' })).rejects.toThrow(/"text" field/)
    await expect(write.execute({ op: 'toggle' })).rejects.toThrow(/"id" field/)
    await expect(write.execute({ op: 'remove' })).rejects.toThrow(/"id" field/)
    await expect(write.execute(null)).rejects.toThrow(/"op" field/)
    cleanup()
  })

  it('cleanup wipes the shared store but leaves tool registrations on the host', async () => {
    const host = createHost()
    const cleanup = expectSyncCleanup(extension({ host, hooks: noopHooks() }))

    const write = host.getTool('todo_write')!
    await write.execute({ op: 'add', text: 'pre-cleanup' })

    cleanup()

    // Host registrations persist (pagelet owns the host lifetime, per RFC §7 P5).
    expect(host.getTool('todo_write')).toBeDefined()
    // But the store's data is gone — call todo_read via the same execute path
    // to prove the side effect of cleanup() reached the store the tool holds.
    const read = host.getTool('todo_read')!
    const snapshot = (await read.execute({})) as { count: number }
    expect(snapshot.count).toBe(0)
  })
})
