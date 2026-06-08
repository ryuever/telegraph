import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ChatMessages } from '../components/ChatMessages'
import { addBookmark, clearBookmarks } from '../bookmark-store'
import type { ChatMessage } from '@/apps/chat/application/common'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount()
    })
  }
  root = undefined
  host?.remove()
  host = undefined
  clearBookmarks()
})

describe('ChatMessages', () => {
  it('renders markdown in user and assistant messages', () => {
    renderMessages([
      {
        id: 'msg-user',
        role: 'user',
        content: '**Bold ask** with `code` and [docs](https://example.test/docs)',
        createdAt: 1,
      },
      {
        id: 'msg-assistant',
        role: 'assistant',
        content: '## Answer\n\n- first\n- second',
        createdAt: 2,
      },
    ])

    expect(textOf('strong')).toBe('Bold ask')
    expect(textOf('code')).toBe('code')
    expect(linkHref('docs')).toBe('https://example.test/docs')
    expect(textOf('h2')).toBe('Answer')
    expect(Array.from(document.querySelectorAll('li')).map(item => item.textContent)).toEqual(['first', 'second'])
  })

  it('renders markdown tables', () => {
    renderMessages([
      {
        id: 'msg-assistant',
        role: 'assistant',
        content: [
          '| Name | Count | Status |',
          '| :--- | ---: | :---: |',
          '| Apples | 12 | **ready** |',
          '| Pears | 3 | `hold` |',
        ].join('\n'),
        createdAt: 1,
      },
    ])

    expect(document.querySelector('table')).not.toBeNull()
    expect(Array.from(document.querySelectorAll('th')).map(cell => cell.textContent)).toEqual([
      'Name',
      'Count',
      'Status',
    ])
    expect(Array.from(document.querySelectorAll('td')).map(cell => cell.textContent)).toEqual([
      'Apples',
      '12',
      'ready',
      'Pears',
      '3',
      'hold',
    ])
    expect(document.querySelector('td strong')?.textContent).toBe('ready')
    expect(document.querySelector('td code')?.textContent).toBe('hold')
  })

  it('renders a bookmark badge on assistant messages present in the bookmark store', () => {
    addBookmark('msg-assistant')
    renderMessages([
      {
        id: 'msg-assistant',
        role: 'assistant',
        content: 'pinned answer',
        createdAt: 1,
      },
    ])
    const badge = Array.from(document.querySelectorAll('span'))
      .find(node => node.textContent === 'bookmarked')
    expect(badge).toBeDefined()
    expect(badge?.getAttribute('title')).toBe('Bookmarked via /bookmark')
  })

  it('does not render a bookmark badge for messages not in the bookmark store', () => {
    renderMessages([
      {
        id: 'msg-assistant',
        role: 'assistant',
        content: 'unbookmarked answer',
        createdAt: 1,
      },
    ])
    const badge = Array.from(document.querySelectorAll('span'))
      .find(node => node.textContent === 'bookmarked')
    expect(badge).toBeUndefined()
  })

  it('does not paint a badge on user messages even if their id collides with a bookmark', () => {
    addBookmark('msg-user')
    renderMessages([
      {
        id: 'msg-user',
        role: 'user',
        content: 'a question',
        createdAt: 1,
      },
    ])
    const badge = Array.from(document.querySelectorAll('span'))
      .find(node => node.textContent === 'bookmarked')
    expect(badge).toBeUndefined()
  })
})

function renderMessages(messages: ChatMessage[]): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root?.render(<ChatMessages messages={messages} isStreaming={false} />)
  })
}

function textOf(selector: string): string | null {
  return document.querySelector(selector)?.textContent ?? null
}

function linkHref(label: string): string | null {
  const links = Array.from(document.querySelectorAll('a'))
  const link = links.find(candidate => candidate.textContent === label)
  return link instanceof HTMLAnchorElement ? link.href : null
}
