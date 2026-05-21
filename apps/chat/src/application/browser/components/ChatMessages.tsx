import React, { useEffect, useRef } from 'react'
import { MarkdownMessage } from '@/packages/ui/components/MarkdownMessage'
import { cn } from '@/packages/ui/lib/utils'
import type { ChatMessage, ChatSubagentGroup, ChatSubagentStatus } from '@/apps/chat/application/common'

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
      <div className="max-w-[80%] whitespace-pre-wrap rounded-md bg-primary px-4 py-2.5 text-[13.5px] leading-relaxed text-primary-foreground shadow-sm">
        {message.content}
      </div>
    </div>
  )
}

function AssistantMessage({ message }: { message: ChatMessage }) {
  const isStreaming = message.status === 'streaming' || message.status === 'pending'
  const isError = message.status === 'error'
  const showCursor = isStreaming
  const showThinking = isStreaming && message.content.length === 0

  return (
    <div className="flex gap-3">
      <Avatar />
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-muted-foreground">Assistant</span>
          {isStreaming && <Pulse label="thinking" />}
          {isError && <span className="text-destructive">error</span>}
        </div>

        {message.toolCalls?.map(call => (
          <div
            key={call.id}
            className="mb-2 rounded-md border border-border bg-card px-3 py-2 text-[12px] shadow-sm"
          >
            <div className="flex items-center gap-2 text-muted-foreground">
              <span>tool</span>
              <span className="font-mono text-foreground">{call.name}</span>
              <span
                className={cn(
                  'ml-auto rounded px-1.5 py-0.5 text-[10px] uppercase',
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
            {call.output !== undefined && (
              <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-border bg-slate-950 p-2 font-mono text-[11px] leading-relaxed text-slate-100">
                {formatToolOutput(call.output)}
              </pre>
            )}
          </div>
        ))}

        {message.subagentGroups?.map(group => (
          <SubagentGroupCard key={group.id} group={group} />
        ))}

        {showThinking ? (
          <ThinkingIndicator />
        ) : (
          <div
            className={cn(
              'rounded-md border border-border bg-card/70 px-4 py-3 shadow-sm',
              isError && 'border-destructive/30 bg-destructive/10'
            )}
          >
            <MarkdownMessage
              content={message.content}
              className={cn(isError && 'text-destructive [&_*]:text-destructive')}
            />
            {showCursor && message.content.length > 0 && (
              <span className="mt-2 inline-block h-[1em] w-[1.5px] animate-pulse bg-primary align-middle" />
            )}
          </div>
        )}

        {isError && message.errorMessage && (
          <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
            {message.errorMessage}
          </div>
        )}
      </div>
    </div>
  )
}

function SubagentGroupCard({ group }: { group: ChatSubagentGroup }) {
  const total = group.agents.length
  const completed = group.agents.filter(agent => agent.status === 'completed').length
  const failed = group.agents.filter(agent => agent.status === 'failed' || agent.status === 'cancelled').length
  const active = group.agents.some(agent => agent.status === 'running' || agent.status === 'queued')
  const statusLabel = active
    ? `${String(completed)}/${String(total)} done`
    : failed > 0
      ? `${String(failed)} need attention`
      : 'complete'

  return (
    <div className="mb-3 overflow-hidden rounded-md border border-border bg-card text-[12px] shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="font-medium text-foreground">{group.title}</span>
        <span className="rounded bg-surface-soft px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
          {statusLabel}
        </span>
      </div>
      <div className="divide-y divide-border">
        {group.agents.map(agent => (
          <div key={agent.runId} className="grid grid-cols-[auto_1fr_auto] gap-2 px-3 py-2">
            <StatusDot status={agent.status} />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium text-foreground">{agent.name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{agent.status}</span>
              </div>
              {agent.task && (
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{agent.task}</div>
              )}
              {(agent.summary || agent.lastUpdate) && (
                <div className="mt-1 max-h-[2.9em] overflow-hidden text-[11.5px] leading-relaxed text-muted-foreground">
                  {agent.summary ?? agent.lastUpdate}
                </div>
              )}
            </div>
            <div className="pt-0.5 text-[11px] tabular-nums text-muted-foreground">
              {agent.elapsedMs !== undefined ? formatElapsed(agent.elapsedMs) : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function StatusDot({ status }: { status: ChatSubagentStatus }) {
  return (
    <span
      className={cn(
        'mt-1.5 h-2 w-2 rounded-full',
        (status === 'queued' || status === 'running') && 'bg-sky-400 shadow-[0_0_0_3px_rgba(56,189,248,0.12)]',
        status === 'completed' && 'bg-emerald-400',
        status === 'failed' && 'bg-rose-400',
        status === 'cancelled' && 'bg-muted-foreground'
      )}
    />
  )
}

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${String(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatToolOutput(output: unknown): string {
  if (typeof output === 'string') return output
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
}

function Avatar() {
  return (
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent-lilac text-[11px] font-semibold text-white shadow-sm">
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
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-mint opacity-75" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent-mint" />
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
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground"
          style={{ animationDelay: `${String(d)}ms` }}
        />
      ))}
    </div>
  )
}
