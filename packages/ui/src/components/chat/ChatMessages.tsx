import React, { useEffect, useRef } from 'react'
import { cn } from '@telegraph/ui/lib/utils'
import type { ChatMessage } from './types'

interface Props {
  messages: ChatMessage[]
  isStreaming: boolean
}

export function ChatMessages({ messages, isStreaming }: Props) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const stickToBottomRef = useRef(true)

  useEffect(() => {
    const el = scrollerRef.current
    if (!el || !stickToBottomRef.current) return
    el.scrollTop = el.scrollHeight
  }, [messages, isStreaming])

  const onScroll = () => {
    const el = scrollerRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    stickToBottomRef.current = distance < 80
  }

  return (
    <div ref={scrollerRef} onScroll={onScroll} className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-6">
        {messages.map(m => (
          <MessageRow key={m.id} message={m} />
        ))}
      </div>
    </div>
  )
}

function MessageRow({ message }: { message: ChatMessage }) {
  if (message.role === 'user') return <UserMessage message={message} />
  if (message.role === 'assistant') return <AssistantMessage message={message} />
  return null
}

function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-tr-md bg-zinc-800/80 px-4 py-2.5 text-[13.5px] leading-relaxed text-zinc-50 shadow-sm">
        {message.content}
      </div>
    </div>
  )
}

function AssistantMessage({ message }: { message: ChatMessage }) {
  const isStreaming = message.status === 'streaming'
  const isError = message.status === 'error'
  const showCursor = isStreaming
  const showThinking = isStreaming && message.content.length === 0

  return (
    <div className="flex gap-3">
      <Avatar />
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="mb-1 flex items-center gap-2 text-[11px] text-zinc-500">
          <span className="font-medium text-zinc-400">Assistant</span>
          {isStreaming && <Pulse label="thinking" />}
          {isError && <span className="text-rose-400">error</span>}
        </div>

        {message.toolCalls?.map(call => (
          <div
            key={call.id}
            className="mb-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-[12px]"
          >
            <div className="flex items-center gap-2 text-zinc-400">
              <span className="text-zinc-500">tool</span>
              <span className="font-mono text-zinc-200">{call.name}</span>
              <span
                className={cn(
                  'ml-auto rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide',
                  call.status === 'running' && 'bg-amber-500/15 text-amber-300',
                  call.status === 'done' && 'bg-emerald-500/15 text-emerald-300',
                  call.status === 'error' && 'bg-rose-500/15 text-rose-300'
                )}
              >
                {call.status}
              </span>
            </div>
            {call.errorMessage && (
              <div className="mt-1 text-[11.5px] text-rose-300">{call.errorMessage}</div>
            )}
          </div>
        ))}

        {showThinking ? (
          <ThinkingIndicator />
        ) : (
          <div
            className={cn(
              'whitespace-pre-wrap text-[13.5px] leading-relaxed text-zinc-100',
              isError && 'text-rose-300'
            )}
          >
            {message.content}
            {showCursor && message.content.length > 0 && (
              <span className="ml-0.5 inline-block h-[1em] w-[1.5px] -translate-y-[1px] animate-pulse bg-zinc-200 align-middle" />
            )}
          </div>
        )}

        {isError && message.errorMessage && (
          <div className="mt-2 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[12px] text-rose-200">
            {message.errorMessage}
          </div>
        )}
      </div>
    </div>
  )
}

function Avatar() {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-violet-600 text-[11px] font-semibold text-white shadow-sm ring-1 ring-white/10">
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 2v4M5 5l3 3M19 5l-3 3M2 12h4M18 12h4M5 19l3-3M19 19l-3-3M12 18v4" />
        <circle cx="12" cy="12" r="4" />
      </svg>
    </div>
  )
}

function Pulse({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-zinc-500">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-sky-500" />
      </span>
      {label}
    </span>
  )
}

function ThinkingIndicator() {
  return (
    <div className="flex h-6 items-center gap-1">
      {[0, 150, 300].map(d => (
        <span
          key={d}
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-500"
          style={{ animationDelay: `${d}ms` }}
        />
      ))}
    </div>
  )
}
