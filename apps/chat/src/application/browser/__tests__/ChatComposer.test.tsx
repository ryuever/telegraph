import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatComposer } from '../components/ChatComposer'

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
})

describe('ChatComposer', () => {
  it('accepts pasted text even before a session id exists', () => {
    const onSendMessage = vi.fn()
    renderComposer({ sessionId: '', onSendMessage })

    const textarea = getTextarea()
    paste(textarea, 'please run parallel subagents')

    expect(textarea.value).toBe('please run parallel subagents')
  })

  it('sends pasted text and lets useChat create the session', () => {
    const onSendMessage = vi.fn()
    renderComposer({ sessionId: '', onSendMessage })

    const textarea = getTextarea()
    paste(textarea, 'please run parallel subagents')
    pressEnter(textarea)

    expect(onSendMessage).toHaveBeenCalledWith('please run parallel subagents')
    expect(textarea.value).toBe('')
  })
})

function renderComposer({
  sessionId,
  onSendMessage,
}: {
  sessionId: string
  onSendMessage: (text: string) => void
}): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root?.render(
      <ChatComposer
        sessionId={sessionId}
        seedText=""
        modelValue="openai::gpt-4o-mini"
        modelOptions={[{ value: 'openai::gpt-4o-mini', label: 'OpenAI · GPT-4o mini' }]}
        onSelectModel={() => {}}
        onPersistSessionDraft={() => {}}
        onSendMessage={onSendMessage}
        onStop={() => {}}
        isStreaming={false}
      />,
    )
  })
}

function getTextarea(): HTMLTextAreaElement {
  const textarea = document.querySelector('textarea')
  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error('Composer textarea not found')
  }
  return textarea
}

function paste(textarea: HTMLTextAreaElement, text: string): void {
  act(() => {
    textarea.dispatchEvent(createPasteEvent(text))
  })
}

function pressEnter(textarea: HTMLTextAreaElement): void {
  act(() => {
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })
}

function createPasteEvent(text: string): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData: (type: string) => (type === 'text/plain' ? text : ''),
    },
  })
  return event
}
