/**
 * Tool definitions + executors for the `@telegraph/todo` extension.
 *
 * Two tools are contributed to the host's ToolCapability registry. Both are
 * pure, synchronous wrappers around a single shared `TodoStore` instance:
 *
 *  - `todo_read`  — read-only snapshot of the todo list. No input.
 *  - `todo_write` — mutate the todo list. Discriminated by `op` field.
 *
 * The schemas are hand-rolled JSON Schema fragments rather than zod / arktype
 * objects because the host's `ToolDefinition.inputSchema` is declared as
 * `unknown` and downstream runtime adapters (pi-ai / pi-embedded) feed it
 * directly to provider-specific tool-call serializers that already accept
 * plain JSON Schema.
 */

import type { ToolCapability } from '@/packages/agent-capabilities'
import type { TodoStore } from './TodoStore'

const EXTENSION_ID = '@telegraph/todo'

function readToolDefinition(): ToolCapability['definition'] {
  return {
    name: 'todo_read',
    title: 'Read todo list',
    description:
      'Return the current scratch-pad todo list for this pagelet session. ' +
      'Returns { items: TodoItem[], count, pendingCount }. ' +
      'TodoItem = { id: number, text: string, done: boolean, createdAt: number }.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    outputSchema: {
      type: 'object',
      required: ['items', 'count', 'pendingCount'],
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'text', 'done', 'createdAt'],
            properties: {
              id: { type: 'integer' },
              text: { type: 'string' },
              done: { type: 'boolean' },
              createdAt: { type: 'integer' },
            },
          },
        },
        count: { type: 'integer' },
        pendingCount: { type: 'integer' },
      },
    },
    metadata: { provider: 'telegraph', sourceExtensionId: EXTENSION_ID },
  }
}

function writeToolDefinition(): ToolCapability['definition'] {
  return {
    name: 'todo_write',
    title: 'Update todo list',
    description:
      "Append, toggle, remove, or wipe scratch-pad todo items. Discriminated by `op`. " +
      "op='add' requires text. op='toggle'|'remove' require id (positive integer). " +
      "op='clear' takes no other fields. Returns the new snapshot in the same shape as todo_read.",
    inputSchema: {
      type: 'object',
      required: ['op'],
      properties: {
        op: { type: 'string', enum: ['add', 'toggle', 'remove', 'clear'] },
        text: { type: 'string', description: 'Required when op = "add".' },
        id: { type: 'integer', minimum: 1, description: 'Required when op = "toggle" or "remove".' },
      },
      additionalProperties: false,
    },
    outputSchema: readToolDefinition().outputSchema,
    metadata: { provider: 'telegraph', sourceExtensionId: EXTENSION_ID },
  }
}

export function createTodoReadTool(store: TodoStore): ToolCapability {
  return {
    definition: readToolDefinition(),
    execute: async () => store.snapshot(),
  }
}

interface TodoWriteInput {
  op: 'add' | 'toggle' | 'remove' | 'clear'
  text?: string
  id?: number
}

function parseTodoWriteInput(input: unknown): TodoWriteInput {
  if (typeof input !== 'object' || input === null) {
    throw new Error('todo_write: input must be an object with an "op" field')
  }
  const record = input as Record<string, unknown>
  const op = record.op
  if (op !== 'add' && op !== 'toggle' && op !== 'remove' && op !== 'clear') {
    throw new Error(`todo_write: unknown op "${String(op)}" (expected add | toggle | remove | clear)`)
  }
  const text = typeof record.text === 'string' ? record.text : undefined
  const id = typeof record.id === 'number' && Number.isInteger(record.id) ? record.id : undefined
  return { op, text, id }
}

export function createTodoWriteTool(store: TodoStore): ToolCapability {
  return {
    definition: writeToolDefinition(),
    execute: async (rawInput: unknown) => {
      const input = parseTodoWriteInput(rawInput)
      switch (input.op) {
        case 'add': {
          if (input.text === undefined) {
            throw new Error('todo_write: op "add" requires a "text" field')
          }
          store.add(input.text)
          return store.snapshot()
        }
        case 'toggle': {
          if (input.id === undefined) {
            throw new Error('todo_write: op "toggle" requires an "id" field')
          }
          store.toggle(input.id)
          return store.snapshot()
        }
        case 'remove': {
          if (input.id === undefined) {
            throw new Error('todo_write: op "remove" requires an "id" field')
          }
          store.remove(input.id)
          return store.snapshot()
        }
        case 'clear': {
          store.clear()
          return store.snapshot()
        }
      }
    },
  }
}
