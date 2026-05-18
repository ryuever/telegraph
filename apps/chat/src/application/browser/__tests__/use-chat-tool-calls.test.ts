import type { ChatToolCall } from '@/apps/chat/application/common'
import { describe, expect, it } from 'vitest'
import { upsertToolCall } from '../chat-tool-calls'

describe('upsertToolCall', () => {
  it('updates existing tool calls by id', () => {
    const calls: ChatToolCall[] = [
      {
        id: 'call-1',
        name: 'search',
        input: { query: 'telegraph' },
        status: 'running',
      },
    ]

    expect(upsertToolCall(calls, {
      id: 'call-1',
      name: 'search',
      output: { answer: 42 },
      status: 'done',
    })).toEqual([
      {
        id: 'call-1',
        name: 'search',
        input: { query: 'telegraph' },
        output: { answer: 42 },
        status: 'done',
      },
    ])
  })

  it('appends new tool calls', () => {
    expect(upsertToolCall([], {
      id: 'call-1',
      name: 'search',
      status: 'running',
    })).toEqual([
      {
        id: 'call-1',
        name: 'search',
        status: 'running',
      },
    ])
  })
})
