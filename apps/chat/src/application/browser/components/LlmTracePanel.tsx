import React, { useEffect, useMemo, useRef } from 'react'
import { cn } from '@/packages/ui/lib/utils'
import type { LlmTraceRow } from '../llm-trace-store'
import type { ChatAgentRunRecordSnapshot, ChatRunTraceBundle } from '@/apps/chat/application/common'
import type { AgentRunReplayMode } from '@/packages/agent/persistence/AgentRunRepository'
import {
  assertChatRunTraceBundle,
  taskCapabilityProfileSummary,
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
  if (eventType.startsWith('run_')) return 'bg-fuchsia-500/15 text-fuchsia-200'
  if (eventType.startsWith('permission_')) return 'bg-rose-500/15 text-rose-200'
  if (eventType.startsWith('extension_')) return 'bg-indigo-500/15 text-indigo-200'
  if (eventType.startsWith('model_')) return 'bg-amber-500/15 text-amber-200'
  if (eventType.startsWith('tool_')) return 'bg-cyan-500/15 text-cyan-200'
  if (eventType.startsWith('step_') || eventType.includes('child_run')) return 'bg-lime-500/15 text-lime-200'
  if (eventType === 'runtime_log') return 'bg-zinc-600/40 text-zinc-300'
  return 'bg-slate-500/15 text-slate-200'
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
      className="rounded-md border border-zinc-800/80 bg-zinc-900/35 p-2"
      key={`${row.sessionId}-${row.runId}-${String(row.ts)}-${String(rowIndex)}`}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-zinc-500">
        <span
          className={cn(
            'rounded px-1.5 py-0.5 font-mono text-[10px] uppercase',
            !event && trace.kind === 'telegraph_turn_context' && 'bg-violet-500/15 text-violet-200',
            !event && trace.kind === 'pi_cli_request' && 'bg-sky-500/15 text-sky-200',
            !event && trace.kind === 'pi_json_line' && 'bg-emerald-500/15 text-emerald-200',
            !event && trace.kind === 'pi_ai_request' && 'bg-amber-500/15 text-amber-200',
            !event && trace.kind === 'pi_ai_stream_event' && 'bg-orange-500/15 text-orange-200',
            event && runtimeEventBadgeClass(eventType)
          )}
        >
          {event ? eventType || 'runtime_event' : trace.kind}
        </span>
        <span>{new Date(row.ts).toLocaleTimeString()}</span>
        {scopeAllChats && (
          <span className="rounded bg-zinc-800/90 px-1 font-mono text-[9px] text-zinc-400">
            {row.sessionId.slice(0, 12)}
            {row.sessionId.length > 12 ? '...' : ''}
          </span>
        )}
      </div>
      <div className="mb-1 text-[11px] leading-relaxed text-zinc-300">
        {summary}
      </div>
      <details className="group">
        <summary className="cursor-pointer select-none text-[10px] text-zinc-500 group-open:mb-1 hover:text-zinc-300">
          Payload
        </summary>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded border border-zinc-800/60 bg-zinc-950/80 p-2 font-mono text-[10.5px] leading-relaxed text-zinc-300">
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
    <section className="border-l border-zinc-800/80 pl-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-zinc-200">{title}</span>
        {subtitle && <span className="font-mono text-[10px] text-zinc-500">{subtitle}</span>}
        <span className={cn('rounded px-1.5 py-0.5 text-[9px] uppercase', statusClass(status))}>{status}</span>
        <span className="text-[10px] text-zinc-500">{rows.length} event{rows.length === 1 ? '' : 's'}</span>
        {onFork && (
          <button
            type="button"
            onClick={onFork}
            className="ml-auto rounded border border-zinc-800 px-1.5 py-0.5 text-[9.5px] text-zinc-400 hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100"
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
  selectedRunId,
  selectedRunRows,
  runConsoleLoading,
  scopeAllChats,
  onScopeAllChatsChange,
  onSelectPersistedRun,
  onRefreshPersistedRuns,
  onReplayPersistedRun,
  onForkPersistedNode,
  onExportPersistedRun,
  onImportTraceBundle,
  onClear,
  onClose,
}: {
  open: boolean
  rows: LlmTraceRow[]
  storedTraceRowCount: number
  persistedRuns: ChatAgentRunRecordSnapshot[]
  selectedRunId: string | null
  selectedRunRows: LlmTraceRow[]
  runConsoleLoading: boolean
  scopeAllChats: boolean
  onScopeAllChatsChange: (value: boolean) => void
  onSelectPersistedRun: (runId: string | null) => void
  onRefreshPersistedRuns: () => void
  onReplayPersistedRun: (runId: string, mode: AgentRunReplayMode) => void
  onForkPersistedNode: (source: {
    sourceRunId: string
    sourceEventSeq?: number
    sourceChildRunId?: string
  }) => void
  onExportPersistedRun: (runId: string) => void
  onImportTraceBundle: (bundle: ChatRunTraceBundle) => void
  onClear: () => void
  onClose: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const visibleRows = selectedRunId ? selectedRunRows : rows
  useEffect(() => {
    if (!open) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [visibleRows.length, open])

  const timelineRuns = useMemo(() => buildTraceTimeline(visibleRows), [visibleRows])
  const selectedRun = selectedRunId
    ? persistedRuns.find(run => run.runId === selectedRunId)
    : null
  const compareRun = selectedRun
    ? findCompareRun(selectedRun, persistedRuns)
    : null
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
            {selectedRun
              ? `Persisted run · ${selectedRun.status} · ${selectedRun.eventCount} events`
              : scopeAllChats
                ? 'All chats · live trace + persisted runs'
                : 'Active chat · live trace + persisted runs'}
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
          onChange={e => { onScopeAllChatsChange(e.target.checked); }}
          className="rounded border-zinc-600 bg-zinc-900"
        />
        <span>
          All chats — idle/streaming does not clear traces; without this, only the{' '}
          <span className="text-zinc-300">active</span> conversation is shown.
        </span>
      </label>
      <div className="border-b border-zinc-800/60 px-2 py-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
            Run Console
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { onSelectPersistedRun(null); }}
              className={cn(
                'rounded px-2 py-1 text-[10.5px]',
                selectedRunId
                  ? 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
                  : 'bg-zinc-800 text-zinc-100'
              )}
            >
              Live
            </button>
            <button
              type="button"
              onClick={onRefreshPersistedRuns}
              className="rounded px-2 py-1 text-[10.5px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              {runConsoleLoading ? 'Loading' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={() => { importInputRef.current?.click(); }}
              className="rounded px-2 py-1 text-[10.5px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
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
        {selectedRun && (
          <>
            <div className="mb-2 grid grid-cols-4 gap-1">
              <RunActionButton onClick={() => { onReplayPersistedRun(selectedRun.runId, 'manual_rerun'); }}>
                Rerun
              </RunActionButton>
              <RunActionButton onClick={() => { onReplayPersistedRun(selectedRun.runId, 'retry'); }}>
                Retry
              </RunActionButton>
              <RunActionButton onClick={() => { onReplayPersistedRun(selectedRun.runId, 'fork'); }}>
                Fork
              </RunActionButton>
              <RunActionButton onClick={() => { onExportPersistedRun(selectedRun.runId); }}>
                Export
              </RunActionButton>
            </div>
            <RunComparePanel primary={selectedRun} compare={compareRun} />
          </>
        )}
        {persistedRuns.length === 0 ? (
          <div className="rounded-md border border-zinc-800/70 bg-zinc-900/25 px-2 py-2 text-[11px] text-zinc-500">
            No persisted runs yet.
          </div>
        ) : (
          <ul className="max-h-40 space-y-1 overflow-y-auto pr-1">
            {persistedRuns.map(run => (
              <li key={run.runId}>
                <button
                  type="button"
                  onClick={() => { onSelectPersistedRun(run.runId); }}
                  className={cn(
                    'w-full rounded-md border px-2 py-1.5 text-left transition-colors',
                    selectedRunId === run.runId
                      ? 'border-zinc-500 bg-zinc-800/70'
                      : 'border-zinc-800/70 bg-zinc-900/25 hover:border-zinc-700 hover:bg-zinc-900/60'
                  )}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-mono text-[10px] text-zinc-300">{shortId(run.runId)}</span>
                    <span className={cn('rounded px-1.5 py-0.5 text-[9px] uppercase', statusClass(runStatus(run.status)))}>
                      {run.status}
                    </span>
                    <span className="ml-auto text-[9.5px] text-zinc-500">{run.eventCount} ev</span>
                  </div>
                  <div className="truncate text-[10.5px] text-zinc-500">
                    {run.inputPreview ?? `${run.settings.backend ?? run.runtimeId} · ${run.settings.modelId ?? 'model'}`}
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
            <p className="px-2 py-6 text-center text-[12px] leading-relaxed text-zinc-400">
              {selectedRunId
                ? 'No persisted events were found for this run.'
                : (
                  <>
                    No traces for{' '}
                    <span className="text-zinc-300">this sidebar conversation</span>. Entries are scoped to the active
                    chat ({storedTraceRowCount} row{storedTraceRowCount === 1 ? '' : 's'} still in memory elsewhere —
                    switch chats in the sidebar, or enable <span className="text-zinc-300">All chats</span> above).
                  </>
                )}
            </p>
          ) : (
            <p className="px-2 py-6 text-center text-[12px] text-zinc-500">
              {selectedRunId
                ? 'No persisted events were found for this run.'
                : 'Send a message to capture turn context and backend LLM payloads for this chat.'}
            </p>
          )
        ) : (
          <ul className="flex flex-col gap-4">
            {timelineRuns.map(run => (
              <li key={run.id} className="rounded-lg border border-zinc-800/70 bg-zinc-950/30 p-2">
                <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-zinc-800/60 pb-1.5">
                  <span className="text-[10px] font-semibold uppercase text-zinc-400">Root run</span>
                  <span className="font-mono text-[11px] text-zinc-200">{shortId(run.id)}</span>
                  <span className={cn('rounded px-1.5 py-0.5 text-[9px] uppercase', statusClass(run.status))}>
                    {run.status}
                  </span>
                  {run.pattern && (
                    <span className="rounded bg-zinc-800/90 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400">
                      {run.pattern}
                    </span>
                  )}
                  <span className="text-[10px] text-zinc-500">
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
                      onFork={selectedRunId ? () => {
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
                      onFork={selectedRunId ? () => {
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

function RunActionButton({
  children,
  onClick,
}: {
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded border border-zinc-800 bg-zinc-900/35 px-2 py-1 text-[10px] text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800"
    >
      {children}
    </button>
  )
}

function RunComparePanel({
  primary,
  compare,
}: {
  primary: ChatAgentRunRecordSnapshot
  compare: ChatAgentRunRecordSnapshot | null
}) {
  if (!compare) {
    return (
      <div className="mb-2 rounded-md border border-zinc-800/70 bg-zinc-900/25 px-2 py-2 text-[10.5px] text-zinc-500">
        No comparable run found.
      </div>
    )
  }

  return (
    <div className="mb-2 rounded-md border border-zinc-800/70 bg-zinc-900/25 p-2">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-500">
        Compare
      </div>
      <div className="grid grid-cols-[5rem_1fr_1fr] gap-x-2 gap-y-1 text-[10.5px]">
        <CompareRow label="run" primary={shortId(primary.runId)} compare={shortId(compare.runId)} />
        <CompareRow label="status" primary={primary.status} compare={compare.status} />
        <CompareRow label="runtime" primary={primary.runtimeId} compare={compare.runtimeId} />
        <CompareRow label="model" primary={primary.settings.modelId ?? '-'} compare={compare.settings.modelId ?? '-'} />
        <CompareRow label="team" primary={primary.teamId ?? primary.settings.orchestration ?? '-'} compare={compare.teamId ?? compare.settings.orchestration ?? '-'} />
        <CompareRow label="profile" primary={taskCapabilityProfileSummary(primary)} compare={taskCapabilityProfileSummary(compare)} />
        <CompareRow label="events" primary={String(primary.eventCount)} compare={String(compare.eventCount)} />
      </div>
    </div>
  )
}

function CompareRow({
  label,
  primary,
  compare,
}: {
  label: string
  primary: string
  compare: string
}) {
  const changed = primary !== compare
  return (
    <>
      <div className="text-zinc-600">{label}</div>
      <div className={cn('truncate font-mono', changed ? 'text-amber-200' : 'text-zinc-300')}>{primary}</div>
      <div className="truncate font-mono text-zinc-500">{compare}</div>
    </>
  )
}

function findCompareRun(
  selectedRun: ChatAgentRunRecordSnapshot,
  runs: ChatAgentRunRecordSnapshot[],
): ChatAgentRunRecordSnapshot | null {
  const candidates = runs.filter(run => run.runId !== selectedRun.runId)
  return candidates.find(run => run.parentRunId === selectedRun.parentRunId && run.parentRunId) ??
    candidates.find(run => run.inputPreview === selectedRun.inputPreview) ??
    candidates[0] ??
    null
}

function firstSeq(rows: LlmTraceRow[]): number | undefined {
  return rows.find(row => typeof row.seq === 'number')?.seq
}

function runStatus(status: ChatAgentRunRecordSnapshot['status']): TimelineStatus {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'running' || status === 'queued') return 'running'
  return 'unknown'
}
