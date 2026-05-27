import React, { useEffect, useMemo, useRef } from 'react'
import { cn } from '@/packages/ui/lib/utils'
import type { LlmTraceRow } from '../llm-trace-store'
import type { ChatAgentRunRecordSnapshot, ChatRunTraceBundle } from '@/apps/chat/application/common'
import { groupPersistedRuns } from '../persisted-run-groups'
import {
  assertChatRunTraceBundle,
} from '@/apps/chat/application/common/trace-bundle'
import {
  buildTraceTimeline,
  formatTraceJson,
  runtimeEventForRow,
  shortId,
  statusClass,
  traceRowSummary,
  type TimelineStatus,
} from '../trace-timeline'

export type { LlmTraceRow }

function runtimeEventBadgeClass(eventType: string): string {
  if (eventType.startsWith('run_')) return 'bg-fuchsia-100 text-fuchsia-700'
  if (eventType.startsWith('permission_')) return 'bg-rose-100 text-rose-700'
  if (eventType.startsWith('extension_')) return 'bg-indigo-100 text-indigo-700'
  if (eventType.startsWith('model_')) return 'bg-amber-100 text-amber-700'
  if (eventType.startsWith('tool_')) return 'bg-cyan-100 text-cyan-700'
  if (eventType.startsWith('step_') || eventType.includes('child_run')) return 'bg-lime-100 text-lime-700'
  if (eventType === 'runtime_log') return 'bg-muted text-muted-foreground'
  return 'bg-slate-100 text-slate-700'
}

function TraceRowItem({
  row,
  rowIndex,
  scopeAllChats,
}: {
  row: LlmTraceRow
  rowIndex: number
  scopeAllChats: boolean
}) {
  const trace = row.trace
  const event = runtimeEventForRow(row)
  const eventType = event?.type ?? ''
  const summary = traceRowSummary(row)

  return (
    <li
      className="rounded-md border border-border bg-card p-2 shadow-sm"
      key={`${row.sessionId}-${row.runId}-${String(row.ts)}-${String(rowIndex)}`}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        <span
          className={cn(
            'rounded px-1.5 py-0.5 font-mono text-[10px] uppercase',
            !event && trace.kind === 'telegraph_turn_context' && 'bg-accent text-primary',
            !event && trace.kind === 'pi_cli_request' && 'bg-sky-100 text-sky-700',
            !event && trace.kind === 'pi_json_line' && 'bg-emerald-100 text-emerald-700',
            !event && trace.kind === 'pi_ai_request' && 'bg-amber-100 text-amber-700',
            !event && trace.kind === 'pi_ai_stream_event' && 'bg-orange-100 text-orange-700',
            event && runtimeEventBadgeClass(eventType)
          )}
        >
          {event ? eventType || 'runtime_event' : trace.kind}
        </span>
        <span>{new Date(row.ts).toLocaleTimeString()}</span>
        {scopeAllChats && (
          <span className="rounded bg-muted px-1 font-mono text-[9px] text-muted-foreground">
            {row.sessionId.slice(0, 12)}
            {row.sessionId.length > 12 ? '...' : ''}
          </span>
        )}
      </div>
      <div className="mb-1 text-[11px] leading-relaxed text-foreground">
        {summary}
      </div>
      <details className="group">
        <summary className="cursor-pointer select-none text-[10px] text-muted-foreground group-open:mb-1 hover:text-foreground">
          Payload
        </summary>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-border bg-slate-950 p-2 font-mono text-[10.5px] leading-relaxed text-slate-100">
          {formatTraceJson(trace)}
        </pre>
      </details>
    </li>
  )
}

function TraceEventList({
  rows,
  scopeAllChats,
}: {
  rows: LlmTraceRow[]
  scopeAllChats: boolean
}) {
  if (rows.length === 0) return null
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row, i) => (
        <TraceRowItem
          key={`${row.sessionId}-${row.runId}-${String(row.ts)}-${String(i)}`}
          row={row}
          rowIndex={i}
          scopeAllChats={scopeAllChats}
        />
      ))}
    </ul>
  )
}

function TraceNodeSection({
  title,
  subtitle,
  status,
  rows,
  scopeAllChats,
  onFork,
}: {
  title: string
  subtitle?: string
  status: TimelineStatus
  rows: LlmTraceRow[]
  scopeAllChats: boolean
  onFork?: () => void
}) {
  return (
    <section className="border-l border-border pl-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-foreground">{title}</span>
        {subtitle && <span className="font-mono text-[10px] text-muted-foreground">{subtitle}</span>}
        <span className={cn('rounded px-1.5 py-0.5 text-[9px] uppercase', statusClass(status))}>{status}</span>
        <span className="text-[10px] text-muted-foreground">{rows.length} event{rows.length === 1 ? '' : 's'}</span>
        {onFork && (
          <button
            type="button"
            onClick={onFork}
            className="ml-auto rounded border border-border px-1.5 py-0.5 text-[9.5px] text-muted-foreground hover:border-primary/35 hover:bg-accent hover:text-foreground"
          >
            Fork
          </button>
        )}
      </div>
      <TraceEventList rows={rows} scopeAllChats={scopeAllChats} />
    </section>
  )
}

export function LlmTracePanel({
  open,
  rows,
  storedTraceRowCount,
  persistedRuns,
  selectedPersistedSessionId,
  selectedRunRows,
  runConsoleLoading,
  scopeAllChats,
  onScopeAllChatsChange,
  onSelectPersistedRunGroup,
  onRefreshPersistedRuns,
  onForkPersistedNode,
  onImportTraceBundle,
  onClear,
  onClose,
}: {
  open: boolean
  rows: LlmTraceRow[]
  storedTraceRowCount: number
  persistedRuns: ChatAgentRunRecordSnapshot[]
  selectedPersistedSessionId: string | null
  selectedRunRows: LlmTraceRow[]
  runConsoleLoading: boolean
  scopeAllChats: boolean
  onScopeAllChatsChange: (value: boolean) => void
  onSelectPersistedRunGroup: (sessionId: string | null) => void
  onRefreshPersistedRuns: () => void
  onForkPersistedNode: (source: {
    sourceRunId: string
    sourceEventSeq?: number
    sourceChildRunId?: string
  }) => void
  onImportTraceBundle: (bundle: ChatRunTraceBundle) => void
  onClear: () => void
  onClose: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const visibleRows = selectedPersistedSessionId ? selectedRunRows : rows
  const persistedRunGroups = useMemo(() => groupPersistedRuns(persistedRuns), [persistedRuns])
  const selectedGroup = selectedPersistedSessionId
    ? persistedRunGroups.find(group => group.sessionId === selectedPersistedSessionId)
    : null
  useEffect(() => {
    if (!open) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [visibleRows.length, open])

  const timelineRuns = useMemo(() => buildTraceTimeline(visibleRows), [visibleRows])
  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const bundle = assertChatRunTraceBundle(JSON.parse(await file.text()))
      onImportTraceBundle(bundle)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <aside
      className={cn(
        'flex h-full shrink-0 flex-col border-border bg-card transition-[width,opacity,border-color] duration-200 ease-out',
        open
          ? 'w-[min(26rem,38vw)] border-l opacity-100'
          : 'pointer-events-none w-0 overflow-hidden border-l-0 opacity-0'
      )}
      aria-hidden={!open}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-foreground">LLM trace</div>
          <div className="truncate text-[10px] text-muted-foreground">
            {selectedGroup
              ? `Persisted session · ${String(selectedGroup.eventCount)} events`
              : scopeAllChats
                ? 'All chats · live trace + persisted runs'
                : 'Active chat · live trace + persisted runs'}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={onClear}
            className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close LLM trace panel"
            className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            ✕
          </button>
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-1.5 text-[10px] text-muted-foreground hover:bg-accent/70">
        <input
          type="checkbox"
          checked={scopeAllChats}
          onChange={e => { onScopeAllChatsChange(e.target.checked); }}
          className="rounded border-border bg-background"
        />
        <span>
          All chats — idle/streaming does not clear traces; without this, only the{' '}
          <span className="text-foreground">active</span> conversation is shown.
        </span>
      </label>
      <div className="border-b border-border px-2 py-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-[10px] font-semibold uppercase text-muted-foreground">
            Run Console
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { onSelectPersistedRunGroup(null); }}
              className={cn(
                'rounded px-2 py-1 text-[10.5px]',
                selectedPersistedSessionId
                  ? 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  : 'bg-accent text-foreground'
              )}
            >
              Live
            </button>
            <button
              type="button"
              onClick={onRefreshPersistedRuns}
              className="rounded px-2 py-1 text-[10.5px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {runConsoleLoading ? 'Loading' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={() => { importInputRef.current?.click(); }}
              className="rounded px-2 py-1 text-[10.5px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Import
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              onChange={event => { void handleImportFile(event); }}
              className="hidden"
            />
          </div>
        </div>
        {persistedRunGroups.length === 0 ? (
          <div className="rounded-md border border-border bg-muted px-2 py-2 text-[11px] text-muted-foreground">
            No persisted runs yet.
          </div>
        ) : (
          <ul className="max-h-40 space-y-1 overflow-y-auto pr-1">
            {persistedRunGroups.map(group => (
              <li key={group.id}>
                <button
                  type="button"
                  onClick={() => { onSelectPersistedRunGroup(group.sessionId); }}
                  className={cn(
                    'w-full rounded-md border px-2 py-1.5 text-left transition-colors',
                    selectedPersistedSessionId === group.sessionId
                      ? 'border-primary/35 bg-accent'
                      : 'border-border bg-background hover:border-primary/25 hover:bg-accent/70'
                  )}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-mono text-[10px] text-foreground">{shortId(group.sessionId)}</span>
                    <span className={cn('rounded px-1.5 py-0.5 text-[9px] uppercase', statusClass(runStatus(group.status)))}>
                      {group.status}
                    </span>
                    <span className="ml-auto text-[9.5px] text-muted-foreground">
                      {group.eventCount} ev
                    </span>
                  </div>
                  <div className="truncate text-[10.5px] text-muted-foreground">
                    {group.title}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {visibleRows.length === 0 ? (
          storedTraceRowCount > 0 ? (
            <p className="px-2 py-6 text-center text-[12px] leading-relaxed text-muted-foreground">
              {selectedPersistedSessionId
                ? 'No persisted events were found for this session.'
                : (
                  <>
                    No traces for{' '}
                    <span className="text-foreground">this sidebar conversation</span>. Entries are scoped to the active
                    chat ({storedTraceRowCount} row{storedTraceRowCount === 1 ? '' : 's'} still in memory elsewhere —
                    switch chats in the sidebar, or enable <span className="text-foreground">All chats</span> above).
                  </>
                )}
            </p>
          ) : (
            <p className="px-2 py-6 text-center text-[12px] text-muted-foreground">
              {selectedPersistedSessionId
                ? 'No persisted events were found for this session.'
                : 'Send a message to capture turn context and backend LLM payloads for this chat.'}
            </p>
          )
        ) : selectedPersistedSessionId ? (
          <section className="rounded-md border border-border bg-background p-2">
            <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-border pb-1.5">
              <span className="text-[10px] font-semibold uppercase text-muted-foreground">Session</span>
              <span className="font-mono text-[11px] text-foreground">{shortId(selectedPersistedSessionId)}</span>
              <span className="text-[10px] text-muted-foreground">
                {visibleRows.length} event{visibleRows.length === 1 ? '' : 's'}
              </span>
            </div>
            <TraceEventList rows={visibleRows} scopeAllChats={scopeAllChats} />
          </section>
        ) : (
          <ul className="flex flex-col gap-4">
            {timelineRuns.map(run => (
              <li key={run.id} className="rounded-md border border-border bg-background p-2">
                <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-border pb-1.5">
                  <span className="text-[10px] font-semibold uppercase text-muted-foreground">Root run</span>
                  <span className="font-mono text-[11px] text-foreground">{shortId(run.id)}</span>
                  <span className={cn('rounded px-1.5 py-0.5 text-[9px] uppercase', statusClass(run.status))}>
                    {run.status}
                  </span>
                  {run.pattern && (
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                      {run.pattern}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    {run.childRuns.length} child / {run.steps.length} step / {run.rows.length} event
                    {run.rows.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="flex flex-col gap-3">
                  <TraceEventList rows={run.directRows} scopeAllChats={scopeAllChats} />
                  {run.childRuns.map(childRun => (
                    <TraceNodeSection
                      key={childRun.id}
                      title={childRun.label}
                      subtitle={shortId(childRun.id)}
                      status={childRun.status}
                      rows={childRun.rows}
                      scopeAllChats={scopeAllChats}
                      onFork={selectedPersistedSessionId ? () => {
                        onForkPersistedNode({
                          sourceRunId: run.id,
                          sourceChildRunId: childRun.id,
                        })
                      } : undefined}
                    />
                  ))}
                  {run.steps.map(step => (
                    <TraceNodeSection
                      key={step.id}
                      title={step.label}
                      subtitle={step.kind ? `${step.kind} / ${shortId(step.id)}` : shortId(step.id)}
                      status={step.status}
                      rows={step.rows}
                      scopeAllChats={scopeAllChats}
                      onFork={selectedPersistedSessionId ? () => {
                        onForkPersistedNode({
                          sourceRunId: run.id,
                          sourceEventSeq: firstSeq(step.rows),
                        })
                      } : undefined}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  )
}

function firstSeq(rows: LlmTraceRow[]): number | undefined {
  return rows.find(row => typeof row.seq === 'number')?.seq
}

function runStatus(status: ChatAgentRunRecordSnapshot['status']): TimelineStatus {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'queued') return 'running'
  return 'unknown'
}
