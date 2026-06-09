import {
  CapabilityHost,
  type CapabilityHookRegistrar,
} from '@/packages/agent-capabilities'
import { describe, expect, it } from 'vitest'
import extension, { TELEGRAPH_TODO_STORE_KEY } from '../extension'
import { TodoStore } from '../TodoStore'
import { createTodoReadTool, createTodoWriteTool } from '../tools'

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

/** Boilerplate: install extension, return host + tools + cleanup. */
function setup() {
  const host = createHost()
  const cleanup = expectSyncCleanup(extension({ host, hooks: noopHooks() }))
  return {
    host,
    cleanup,
    read: host.getTool('todo_read')!,
    write: host.getTool('todo_write')!,
  }
}

// ─── Extension lifecycle ───────────────────────────────────────────

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

// ─── Tool definition schemas ──────────────────────────────────────

describe('tool definitions', () => {
  it('todo_read has a valid JSON Schema input (empty object)', () => {
    const store = new TodoStore()
    const { definition } = createTodoReadTool(store)
    const schema = definition.inputSchema as Record<string, unknown>
    expect(schema.type).toBe('object')
    expect(schema.properties).toEqual({})
    expect(schema.additionalProperties).toBe(false)
  })

  it('todo_read output schema declares items, count, pendingCount', () => {
    const store = new TodoStore()
    const { definition } = createTodoReadTool(store)
    const schema = definition.outputSchema as Record<string, unknown>
    expect(schema.type).toBe('object')
    const props = schema.properties as Record<string, unknown>
    expect(Object.keys(props)).toContain('items')
    expect(Object.keys(props)).toContain('count')
    expect(Object.keys(props)).toContain('pendingCount')
    expect(schema.required).toEqual(['items', 'count', 'pendingCount'])
  })

  it('todo_write input schema requires op and enumerates add|toggle|remove|clear', () => {
    const store = new TodoStore()
    const { definition } = createTodoWriteTool(store)
    const schema = definition.inputSchema as Record<string, unknown>
    expect(schema.type).toBe('object')
    expect(schema.required).toEqual(['op'])
    expect(schema.additionalProperties).toBe(false)

    const props = schema.properties as Record<string, unknown>
    const opSchema = props.op as Record<string, unknown>
    expect(opSchema.enum).toEqual(['add', 'toggle', 'remove', 'clear'])
  })

  it('todo_write definition metadata identifies @telegraph/todo as source', () => {
    const store = new TodoStore()
    const { definition } = createTodoWriteTool(store)
    expect(definition.name).toBe('todo_write')
    expect(definition.title).toBe('Update todo list')
    expect(definition.metadata?.provider).toBe('telegraph')
    expect(definition.metadata?.sourceExtensionId).toBe('@telegraph/todo')
  })

  it('todo_read definition metadata identifies @telegraph/todo as source', () => {
    const store = new TodoStore()
    const { definition } = createTodoReadTool(store)
    expect(definition.name).toBe('todo_read')
    expect(definition.title).toBe('Read todo list')
    expect(definition.metadata?.provider).toBe('telegraph')
    expect(definition.metadata?.sourceExtensionId).toBe('@telegraph/todo')
  })
})

// ─── todo_read tool ───────────────────────────────────────────────

describe('todo_read tool', () => {
  it('returns an empty snapshot when the store is untouched', async () => {
    const { read, cleanup } = setup()
    const snap = (await read.execute({})) as { count: number; pendingCount: number; items: unknown[] }
    expect(snap).toEqual({ items: [], count: 0, pendingCount: 0 })
    cleanup()
  })

  it('reflects items added by todo_write', async () => {
    const { read, write, cleanup } = setup()
    await write.execute({ op: 'add', text: 'review PR' })
    const snap = (await read.execute({})) as { items: Array<{ text: string }>; count: number }
    expect(snap.count).toBe(1)
    expect(snap.items[0]?.text).toBe('review PR')
    cleanup()
  })

  it('ignores any input fields — always returns full snapshot', async () => {
    const { read, cleanup } = setup()
    // Even if a caller passes spurious input, todo_read should still work.
    const snap = (await read.execute({ bogus: true })) as { count: number }
    expect(snap.count).toBe(0)
    cleanup()
  })
})

// ─── todo_write tool: op = add ────────────────────────────────────

describe('todo_write op=add', () => {
  it('adds an item and returns the updated snapshot', async () => {
    const { write, cleanup } = setup()
    const result = (await write.execute({ op: 'add', text: 'fix the bug' })) as {
      items: Array<{ id: number; text: string; done: boolean }>
      count: number
      pendingCount: number
    }
    expect(result.count).toBe(1)
    expect(result.pendingCount).toBe(1)
    expect(result.items[0]).toEqual(
      expect.objectContaining({ text: 'fix the bug', done: false }),
    )
    cleanup()
  })

  it('trims whitespace from text before adding', async () => {
    const { write, cleanup } = setup()
    const result = (await write.execute({ op: 'add', text: '  padded  ' })) as {
      items: Array<{ text: string }>
    }
    expect(result.items[0]?.text).toBe('padded')
    cleanup()
  })

  it('rejects add without text', async () => {
    const { write, cleanup } = setup()
    await expect(write.execute({ op: 'add' })).rejects.toThrow(/"text" field/)
    cleanup()
  })

  it('rejects add with empty string text (store-level validation)', async () => {
    const { write, cleanup } = setup()
    await expect(write.execute({ op: 'add', text: '' })).rejects.toThrow(/non-empty/)
    cleanup()
  })

  it('assigns sequential ids across multiple adds', async () => {
    const { write, cleanup } = setup()
    await write.execute({ op: 'add', text: 'a' })
    await write.execute({ op: 'add', text: 'b' })
    const result = (await write.execute({ op: 'add', text: 'c' })) as {
      items: Array<{ id: number; text: string }>
    }
    expect(result.items.map(i => i.id)).toEqual([1, 2, 3])
    cleanup()
  })
})

// ─── todo_write tool: op = toggle ─────────────────────────────────

describe('todo_write op=toggle', () => {
  it('toggles an item from not-done to done', async () => {
    const { write, cleanup } = setup()
    await write.execute({ op: 'add', text: 'buy milk' })
    const result = (await write.execute({ op: 'toggle', id: 1 })) as {
      items: Array<{ id: number; done: boolean }>
      pendingCount: number
    }
    expect(result.items[0]?.done).toBe(true)
    expect(result.pendingCount).toBe(0)
    cleanup()
  })

  it('toggles back from done to not-done', async () => {
    const { write, cleanup } = setup()
    await write.execute({ op: 'add', text: 'task' })
    await write.execute({ op: 'toggle', id: 1 })
    const result = (await write.execute({ op: 'toggle', id: 1 })) as {
      items: Array<{ id: number; done: boolean }>
      pendingCount: number
    }
    expect(result.items[0]?.done).toBe(false)
    expect(result.pendingCount).toBe(1)
    cleanup()
  })

  it('rejects toggle without id', async () => {
    const { write, cleanup } = setup()
    await expect(write.execute({ op: 'toggle' })).rejects.toThrow(/"id" field/)
    cleanup()
  })

  it('rejects toggle with non-existent id', async () => {
    const { write, cleanup } = setup()
    await expect(write.execute({ op: 'toggle', id: 999 })).rejects.toThrow(/no item with id 999/)
    cleanup()
  })
})

// ─── todo_write tool: op = remove ─────────────────────────────────

describe('todo_write op=remove', () => {
  it('removes an item and returns the updated snapshot', async () => {
    const { write, cleanup } = setup()
    await write.execute({ op: 'add', text: 'temp' })
    const result = (await write.execute({ op: 'remove', id: 1 })) as {
      count: number
      items: unknown[]
    }
    expect(result.count).toBe(0)
    expect(result.items).toEqual([])
    cleanup()
  })

  it('only removes the targeted item, leaving others intact', async () => {
    const { write, cleanup } = setup()
    await write.execute({ op: 'add', text: 'keep' })
    await write.execute({ op: 'add', text: 'remove-me' })
    const result = (await write.execute({ op: 'remove', id: 2 })) as {
      count: number
      items: Array<{ id: number; text: string }>
    }
    expect(result.count).toBe(1)
    expect(result.items[0]?.text).toBe('keep')
    cleanup()
  })

  it('rejects remove without id', async () => {
    const { write, cleanup } = setup()
    await expect(write.execute({ op: 'remove' })).rejects.toThrow(/"id" field/)
    cleanup()
  })

  it('rejects remove with non-existent id', async () => {
    const { write, cleanup } = setup()
    await expect(write.execute({ op: 'remove', id: 42 })).rejects.toThrow(/no item with id 42/)
    cleanup()
  })
})

// ─── todo_write tool: op = clear ──────────────────────────────────

describe('todo_write op=clear', () => {
  it('clears all items and returns an empty snapshot', async () => {
    const { write, cleanup } = setup()
    await write.execute({ op: 'add', text: 'a' })
    await write.execute({ op: 'add', text: 'b' })
    const result = (await write.execute({ op: 'clear' })) as {
      count: number
      pendingCount: number
      items: unknown[]
    }
    expect(result).toEqual({ items: [], count: 0, pendingCount: 0 })
    cleanup()
  })

  it('clear on an already-empty store returns an empty snapshot', async () => {
    const { write, cleanup } = setup()
    const result = (await write.execute({ op: 'clear' })) as { count: number }
    expect(result.count).toBe(0)
    cleanup()
  })
})

// ─── todo_write input parsing edge cases ──────────────────────────

describe('todo_write input parsing edge cases', () => {
  it('rejects null input', async () => {
    const { write, cleanup } = setup()
    await expect(write.execute(null)).rejects.toThrow(/"op" field/)
    cleanup()
  })

  it('rejects undefined input', async () => {
    const { write, cleanup } = setup()
    await expect(write.execute(undefined)).rejects.toThrow(/"op" field/)
    cleanup()
  })

  it('rejects non-object input (string)', async () => {
    const { write, cleanup } = setup()
    await expect(write.execute('add')).rejects.toThrow(/"op" field/)
    cleanup()
  })

  it('rejects non-object input (number)', async () => {
    const { write, cleanup } = setup()
    await expect(write.execute(42)).rejects.toThrow(/"op" field/)
    cleanup()
  })

  it('rejects unknown op value', async () => {
    const { write, cleanup } = setup()
    await expect(write.execute({ op: 'bogus' })).rejects.toThrow(/unknown op/)
    cleanup()
  })

  it('ignores non-string text field (treated as undefined → add fails)', async () => {
    const { write, cleanup } = setup()
    // text: 123 is not a string, so parseTodoWriteInput sets text = undefined → add errors
    await expect(write.execute({ op: 'add', text: 123 })).rejects.toThrow(/"text" field/)
    cleanup()
  })

  it('ignores non-integer id field (treated as undefined → toggle fails)', async () => {
    const { write, cleanup } = setup()
    // id: 1.5 is not an integer, so parseTodoWriteInput sets id = undefined → toggle errors
    await expect(write.execute({ op: 'toggle', id: 1.5 })).rejects.toThrow(/"id" field/)
    cleanup()
  })

  it('ignores string id field (treated as undefined → remove fails)', async () => {
    const { write, cleanup } = setup()
    await expect(write.execute({ op: 'remove', id: '1' })).rejects.toThrow(/"id" field/)
    cleanup()
  })

  it('negative id passes parsing but fails at store level (no such item)', async () => {
    const { write, cleanup } = setup()
    // id: -1 is an integer, so parseTodoWriteInput keeps it → store.toggle(-1) throws
    await expect(write.execute({ op: 'toggle', id: -1 })).rejects.toThrow(/no item with id -1/)
    cleanup()
  })

  it('handles object with no op field', async () => {
    const { write, cleanup } = setup()
    await expect(write.execute({ text: 'nope' })).rejects.toThrow(/unknown op/)
    cleanup()
  })
})

// ─── Chat-UI scenario: "Add 'fix the bug' to my todo list" ─────────

describe('chat-UI scenario: Add fix the bug to my todo list', () => {
  it('LLM calls todo_write({op:"add", text:"fix the bug"}) and the result is visible via todo_read', async () => {
    const { read, write, cleanup } = setup()

    // Simulate what the LLM produces after the user's message.
    const writeResult = (await write.execute({ op: 'add', text: 'fix the bug' })) as {
      items: Array<{ id: number; text: string; done: boolean; createdAt: number }>
      count: number
      pendingCount: number
    }

    // The tool call card in Chat UI renders from the writeResult.
    expect(writeResult.count).toBe(1)
    expect(writeResult.pendingCount).toBe(1)
    const addedItem = writeResult.items[0]!
    expect(addedItem.text).toBe('fix the bug')
    expect(addedItem.done).toBe(false)
    expect(addedItem.id).toBe(1)
    expect(typeof addedItem.createdAt).toBe('number')

    // A subsequent todo_read should return the same item.
    const readResult = (await read.execute({})) as typeof writeResult
    expect(readResult).toEqual(writeResult)
    cleanup()
  })

  it('full session: add → toggle → add another → remove → read', async () => {
    const { read, write, cleanup } = setup()

    // Step 1: "Add 'fix the bug' to my todo list"
    await write.execute({ op: 'add', text: 'fix the bug' })

    // Step 2: "Mark fix the bug as done"
    await write.execute({ op: 'toggle', id: 1 })

    // Step 3: "Also add write tests"
    await write.execute({ op: 'add', text: 'write tests' })

    // Step 4: "Remove fix the bug from my list"
    await write.execute({ op: 'remove', id: 1 })

    // Step 5: "Show my todo list"
    const snapshot = (await read.execute({})) as {
      items: Array<{ id: number; text: string; done: boolean }>
      count: number
      pendingCount: number
    }
    expect(snapshot.count).toBe(1)
    expect(snapshot.pendingCount).toBe(1)
    expect(snapshot.items[0]).toEqual(
      expect.objectContaining({ id: 2, text: 'write tests', done: false }),
    )
    cleanup()
  })

  it('session with clear then re-add: fresh start after clear', async () => {
    const { read, write, cleanup } = setup()

    await write.execute({ op: 'add', text: 'old task 1' })
    await write.execute({ op: 'add', text: 'old task 2' })
    await write.execute({ op: 'toggle', id: 1 })

    // "Clear my todo list"
    const afterClear = (await write.execute({ op: 'clear' })) as { count: number }
    expect(afterClear.count).toBe(0)

    // "Add 'fix the bug' to my todo list" (starts fresh, but id counter continues)
    await write.execute({ op: 'add', text: 'fix the bug' })
    const snapshot = (await read.execute({})) as {
      items: Array<{ id: number; text: string; done: boolean }>
      count: number
    }
    expect(snapshot.count).toBe(1)
    // id counter was not reset — new item gets id 3, not id 1
    expect(snapshot.items[0]?.id).toBe(3)
    expect(snapshot.items[0]?.text).toBe('fix the bug')
    expect(snapshot.items[0]?.done).toBe(false)
    cleanup()
  })

  it('todo_write always returns a snapshot in the same shape as todo_read', async () => {
    const { write, cleanup } = setup()
    // Every op returns { items, count, pendingCount }
    const ops: Array<{ op: string; text?: string; id?: number }> = [
      { op: 'add', text: 'first' },
      { op: 'add', text: 'second' },
      { op: 'toggle', id: 1 },
      { op: 'remove', id: 2 },
      { op: 'clear' },
    ]
    for (const input of ops) {
      const result = (await write.execute(input)) as Record<string, unknown>
      expect(result).toHaveProperty('items')
      expect(result).toHaveProperty('count')
      expect(result).toHaveProperty('pendingCount')
      expect(Array.isArray(result.items)).toBe(true)
      expect(typeof result.count).toBe('number')
      expect(typeof result.pendingCount).toBe('number')
    }
    cleanup()
  })
})

// ─── Multi-extension isolation ────────────────────────────────────

describe('multiple extension instances share no state', () => {
  it('two setups have independent stores', async () => {
    const a = setup()
    const b = setup()

    await a.write.execute({ op: 'add', text: 'only in A' })
    await b.write.execute({ op: 'add', text: 'only in B' })

    const snapA = (await a.read.execute({})) as { items: Array<{ text: string }>; count: number }
    const snapB = (await b.read.execute({})) as { items: Array<{ text: string }>; count: number }

    expect(snapA.count).toBe(1)
    expect(snapA.items[0]?.text).toBe('only in A')
    expect(snapB.count).toBe(1)
    expect(snapB.items[0]?.text).toBe('only in B')

    a.cleanup()
    b.cleanup()
  })
})

// ─── Host capability queries ──────────────────────────────────────

describe('host capability queries', () => {
  it('host.has("tool") is true after extension activates', () => {
    const host = createHost()
    expect(host.has('tool')).toBe(false)
    expectSyncCleanup(extension({ host, hooks: noopHooks() }))
    expect(host.has('tool')).toBe(true)
    expect(host.has('tool', 'todo_read')).toBe(true)
    expect(host.has('tool', 'todo_write')).toBe(true)
    expect(host.has('tool', 'nonexistent')).toBe(false)
  })

  it('listToolCapabilities returns both tools with execute functions', () => {
    const host = createHost()
    expectSyncCleanup(extension({ host, hooks: noopHooks() }))
    const capabilities = host.listToolCapabilities()
    expect(capabilities).toHaveLength(2)
    for (const cap of capabilities) {
      expect(typeof cap.execute).toBe('function')
      expect(cap.definition.name).toMatch(/^todo_/)
    }
  })
})
