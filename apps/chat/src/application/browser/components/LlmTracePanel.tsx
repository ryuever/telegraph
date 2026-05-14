import React, { useEffect, useMemo, useRef } from 'react'
import { cn } from '@/packages/ui/lib/utils'
import type { LlmTracePayload } from '@/apps/chat/application/common'
import type { LlmTraceRow } from '../llm-trace-store'

export type { LlmTraceRow }

function formatJson(trace: LlmTracePayload): string {
  try {
    return JSON.stringify(trace, null, 2)
  } catch {
    return String(trace)
  }
}

function runtimeEventBadgeClass(eventType: string): string {
  if (eventType.startsWith('run_')) return 'bg-fuchsia-500/15 text-fuchsia-200'
  if (eventType.startsWith('model_')) return 'bg-amber-500/15 text-amber-200'
  if (eventType.startsWith('tool_')) return 'bg-cyan-500/15 text-cyan-200'
  if (eventType.startsWith('step_') || eventType.includes('child_run')) return 'bg-lime-500/15 text-lime-200'
  if (eventType === 'runtime_log') return 'bg-zinc-600/40 text-zinc-300'
  return 'bg-slate-500/15 text-slate-200'
}

export function LlmTracePanel({
  open,
  rows,
  storedTraceRowCount,
  scopeAllChats,
  onScopeAllChatsChange,
  onClear,
  onClose,
}: {
  open: boolean
  rows: LlmTraceRow[]
  storedTraceRowCount: number
  scopeAllChats: boolean
  onScopeAllChatsChange: (value: boolean) => void
  onClear: () => void
  onClose: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [rows.length, open])

  const rowsByRun = useMemo(() => {
    const m = new Map<string, LlmTraceRow[]>()
    for (const r of rows) {
      const list = m.get(r.runId) ?? []
      list.push(r)
      m.set(r.runId, list)
    }
    return m
  }, [rows])

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-zinc-800/80 bg-zinc-950/95 transition-[width,opacity,border-color] duration-200 ease-out',
        open
          ? 'w-[min(26rem,38vw)] border-l opacity-100'
          : 'pointer-events-none w-0 overflow-hidden border-l-0 opacity-0'
      )}
      aria-hidden={!open}
    >
      <div className="flex items-center justify-between gap-2 border-b border-zinc-800/80 px-3 py-2">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold tracking-tight text-zinc-100">LLM trace</div>
          <div className="truncate text-[10px] text-zinc-500">
            {scopeAllChats
              ? 'All chats · legacy trace + RuntimeEvent (v1)'
              : 'Active chat · legacy trace + RuntimeEvent (v1)'}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={onClear}
            className="rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close LLM trace panel"
            className="rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            ✕
          </button>
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-2 border-b border-zinc-800/60 px-3 py-1.5 text-[10px] text-zinc-400 hover:bg-zinc-900/40">
        <input
          type="checkbox"
          checked={scopeAllChats}
          onChange={e => onScopeAllChatsChange(e.target.checked)}
          className="rounded border-zinc-600 bg-zinc-900"
        />
        <span>
          All chats — idle/streaming does not clear traces; without this, only the{' '}
          <span className="text-zinc-300">active</span> conversation is shown.
        </span>
      </label>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {rows.length === 0 ? (
          storedTraceRowCount > 0 ? (
            <p className="px-2 py-6 text-center text-[12px] leading-relaxed text-zinc-400">
              No traces for{' '}
              <span className="text-zinc-300">this sidebar conversation</span>. Entries are scoped to the active
              chat ({storedTraceRowCount} row{storedTraceRowCount === 1 ? '' : 's'} still in memory elsewhere —
              switch chats in the sidebar, or enable <span className="text-zinc-300">All chats</span> above).
            </p>
          ) : (
            <p className="px-2 py-6 text-center text-[12px] text-zinc-500">
              Send a message to capture turn context and backend LLM payloads for this chat.
            </p>
          )
        ) : (
          <ul className="flex flex-col gap-4">
            {[...rowsByRun.entries()].map(([runId, runRows]) => (
              <li key={runId} className="rounded-lg border border-zinc-800/70 bg-zinc-950/30 p-2">
                <div className="mb-2 flex flex-wrap items-baseline gap-2 border-b border-zinc-800/60 pb-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Run</span>
                  <span className="font-mono text-[11px] text-zinc-200">{runId.slice(0, 10)}…</span>
                  <span className="text-[10px] text-zinc-500">{runRows.length} row{runRows.length === 1 ? '' : 's'}</span>
                </div>
                <ul className="flex flex-col gap-2">
                  {runRows.map((row, i) => {
                    const tr = row.trace
                    const isContract = tr.kind === 'runtime_event'
                    let evType = ''
                    if (isContract) {
                      const ev = (tr as { kind: 'runtime_event'; event: { type?: string } }).event
                      evType = typeof ev?.type === 'string' ? ev.type : ''
                    }
                    return (
                      <li
                        key={`${row.sessionId}-${row.runId}-${row.ts}-${i}`}
                        className="rounded-md border border-zinc-800/80 bg-zinc-900/40 p-2"
                      >
                        <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
                          <span
                            className={cn(
                              'rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide',
                              !isContract && row.trace.kind === 'telegraph_turn_context' && 'bg-violet-500/15 text-violet-200',
                              !isContract && row.trace.kind === 'pi_cli_request' && 'bg-sky-500/15 text-sky-200',
                              !isContract && row.trace.kind === 'pi_json_line' && 'bg-emerald-500/15 text-emerald-200',
                              !isContract && row.trace.kind === 'pi_ai_request' && 'bg-amber-500/15 text-amber-200',
                              !isContract && row.trace.kind === 'pi_ai_stream_event' && 'bg-orange-500/15 text-orange-200',
                              isContract && runtimeEventBadgeClass(evType)
                            )}
                          >
                            {isContract ? evType || 'runtime_event' : row.trace.kind}
                          </span>
                          <span>{new Date(row.ts).toLocaleTimeString()}</span>
                          {scopeAllChats && (
                            <span className="rounded bg-zinc-800/90 px-1 font-mono text-[9px] text-zinc-400">
                              {row.sessionId.slice(0, 12)}
                              {row.sessionId.length > 12 ? '…' : ''}
                            </span>
                          )}
                        </div>
                        <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border border-zinc-800/60 bg-zinc-950/80 p-2 font-mono text-[10.5px] leading-relaxed text-zinc-300">
                          {formatJson(row.trace)}
                        </pre>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}
