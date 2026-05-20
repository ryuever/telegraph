import React, { useEffect, useRef, useState } from 'react'
import { cn } from '@/packages/ui/lib/utils'

export interface ChatComposerProps {
  sessionId: string
  seedText: string
  onPersistSessionDraft: (sessionId: string, text: string) => void
  onSendMessage: (text: string) => void
  onStop: () => void
  isStreaming: boolean
  placeholder?: string
}

const MAX_HEIGHT = 220

export const ChatComposer = React.memo(function ChatComposer({
  sessionId,
  seedText,
  onPersistSessionDraft,
  onSendMessage,
  onStop,
  isStreaming,
  placeholder = 'Message the agent…  (⏎ to send, ⇧⏎ for newline)',
}: ChatComposerProps) {
  const [text, setText] = useState(seedText)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const textRef = useRef(text)
  textRef.current = text

  useEffect(() => {
    return () => {
      if (sessionId) {
        onPersistSessionDraft(sessionId, textRef.current)
      }
    }
  }, [sessionId, onPersistSessionDraft])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = '0px'
    const next = Math.min(MAX_HEIGHT, el.scrollHeight)
    el.style.height = String(next) + 'px'
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden'
  }, [text])

  const handleSend = () => {
    const t = text.trim()
    if (!t || isStreaming) return
    onSendMessage(t)
    setText('')
    if (sessionId) {
      onPersistSessionDraft(sessionId, '')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      handleSend()
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = e.clipboardData.getData('text/plain')
    if (!pastedText) return

    e.preventDefault()
    const target = e.currentTarget
    const selectionStart = target.selectionStart
    const selectionEnd = target.selectionEnd
    setText(current => {
      const next = current.slice(0, selectionStart) + pastedText + current.slice(selectionEnd)
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (!el) return
        const caret = selectionStart + pastedText.length
        el.setSelectionRange(caret, caret)
      })
      return next
    })
  }

  const canSend = text.trim().length > 0 && !isStreaming

  return (
    <div className="border-t border-zinc-800/80 bg-zinc-950/80 px-4 pb-4 pt-3">
      <div className="mx-auto max-w-3xl">
        <div
          className={cn(
            'group relative flex items-end gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/70 px-3 py-2.5 shadow-sm transition-colors',
            'focus-within:border-zinc-600 focus-within:bg-zinc-900'
          )}
        >
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => { setText(e.target.value); }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder}
            rows={1}
            className="min-h-[24px] flex-1 resize-none border-0 bg-transparent text-[13.5px] leading-6 text-zinc-100 outline-none placeholder:text-zinc-500"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-zinc-700 text-zinc-100 shadow transition-colors hover:bg-zinc-600"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                <rect x="5" y="5" width="14" height="14" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send message"
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow transition-all',
                canSend
                  ? 'bg-zinc-100 text-zinc-900 hover:bg-white'
                  : 'cursor-not-allowed bg-zinc-800 text-zinc-600'
              )}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          )}
        </div>
        <p className="mt-1.5 text-center text-[10.5px] text-zinc-600">
          Chat via x-oasis RPC pagelet — connect a real agent service for live AI responses.
        </p>
      </div>
    </div>
  )
})
