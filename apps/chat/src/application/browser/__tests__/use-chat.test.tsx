import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSessionStore, removeSessionStore, useSessionsStore } from '@/packages/stores'
import { useChat, type SendMessageOptions } from '../use-chat'
import type { AgentSendOptions, AgentService } from '../types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const storageHarness = vi.hoisted(() => {
  class MemoryStorage implements Storage {
    private readonly values = new Map<string, string>()

    get length(): number {
      return this.values.size
    }

    clear(): void {
      this.values.clear()
    }

    getItem(key: string): string | null {
      return this.values.get(key) ?? null
    }

    key(index: number): string | null {
      return Array.from(this.values.keys())[index] ?? null
    }

    removeItem(key: string): void {
      this.values.delete(key)
    }

    setItem(key: string, value: string): void {
      this.values.set(key, value)
    }
  }

  const storage = new MemoryStorage()
  const install = () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: storage,
    })
  }
  install()
  return { storage, install }
})

const SESSION_ID = 'session-use-chat'

let root: Root | undefined
let host: HTMLDivElement | undefined
let latest: ReturnType<typeof useChat> | undefined

beforeEach(() => {
  storageHarness.install()
  storageHarness.storage.clear()
  removeSessionStore(SESSION_ID)
  useSessionsStore.setState({
    sessions: [{ id: SESSION_ID, title: 'New chat', createdAt: 1, updatedAt: 1 }],
    activeSessionId: SESSION_ID,
  })
})

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount()
    })
  }
  root = undefined
  host?.remove()
  host = undefined
  latest = undefined
  removeSessionStore(SESSION_ID)
  storageHarness.storage.clear()
})

describe('useChat sendMessage', () => {
  it('writes the user message and completed assistant response', async () => {
    const { agent, sendMock } = fakeAgent(opts => {
      opts.onStatus?.('running')
      opts.onChunk('hello')
      opts.onChunk(' there')
    })
    renderUseChat(agent)

    await send('hi')

    const state = getSessionStore(SESSION_ID).getState()
    expect(state.isStreaming).toBe(false)
    expect(state.messages).toMatchObject([
      { role: 'user', content: 'hi', status: 'done' },
      { role: 'assistant', content: 'hello there', status: 'done' },
    ])
    const sent = sendMock.mock.calls[0][0]
    expect(sent.conversation.id).toBe(SESSION_ID)
    expect(sent.conversation.messages).toMatchObject([
      { role: 'user', content: 'hi' },
    ])
  })

  it('keeps a failed send visible as an assistant error', async () => {
    const { agent } = fakeAgent(opts => {
      opts.onStatus?.('running')
      throw new Error('missing model credentials')
    })
    renderUseChat(agent)

    await send('hi')

    const state = getSessionStore(SESSION_ID).getState()
    expect(state.isStreaming).toBe(false)
    expect(state.messages).toMatchObject([
      { role: 'user', content: 'hi', status: 'done' },
      {
        role: 'assistant',
        content: '',
        status: 'error',
        errorMessage: 'missing model credentials',
      },
    ])
  })
})

function renderUseChat(agent: AgentService): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root?.render(<UseChatHarness agent={agent} />)
  })
}

function UseChatHarness({ agent }: { agent: AgentService }) {
  latest = useChat({ agent })
  return null
}

async function send(text: string, options?: SendMessageOptions): Promise<void> {
  if (!latest) throw new Error('useChat harness was not rendered')
  await act(async () => {
    await latest?.sendMessage(text, options)
  })
}

function fakeAgent(send: (opts: AgentSendOptions) => void | Promise<void>): {
  agent: AgentService
  sendMock: ReturnType<typeof vi.fn<(opts: AgentSendOptions) => Promise<void>>>
} {
  const sendMock = vi.fn<(opts: AgentSendOptions) => Promise<void>>(async opts => {
    await send(opts)
  })

  return {
    agent: {
      send: sendMock,
      listSubagents: vi.fn(() => Promise.resolve([])),
      getSubagentResult: vi.fn(() => Promise.resolve(null)),
      cancelSubagent: vi.fn(() => Promise.resolve(false)),
    },
    sendMock,
  }
}
