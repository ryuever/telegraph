import { useCallback, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Database,
  File,
  FileJson,
  Image,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react'
import { PageletAgentService } from '@/apps/chat/application/browser/pagelet-agent-service'
import type { ChatAgentRunRecordSnapshot } from '@/apps/chat/application/common'
import { PageletDesignAgentService } from '@/apps/design/application/browser/pagelet-design-agent-service'
import type { DesignAgentRunRecordSnapshot } from '@/apps/design/application/common'
import type { AgentRunEventRecord } from '@/packages/agent/persistence/AgentRunRepository'
import type { AgentEvent, RuntimeMessage } from '@/packages/agent-protocol'
import type { MainSwitchPagePayload } from '@/packages/services/pagelet-host/common'
import { cn } from '@/packages/ui/lib/utils'

const designAgentService = new PageletDesignAgentService()
const chatAgentService = new PageletAgentService()

type RunSource = 'design' | 'chat'
type SourceFilter = 'all' | RunSource

interface ConsoleRun {
  source: RunSource
  runId: string
  sessionId?: string
  status: string
  eventCount: number
  inputPreview?: string
  updatedAt: number
  createdAt: number
}

interface ConsoleEvent {
  source: RunSource
  runId: string
  seq: number
  ts: number
  event: AgentEvent
}

export interface ObservationArtifactPreview {
  kind?: string
  uri: string
  mediaType: string
  title?: string
}

interface SourceState {
  loading: boolean
  error?: string
  count: number
}

const SOURCE_LABELS: Record<RunSource, string> = {
  design: 'Design',
  chat: 'Chat',
}

const FILTERS: Array<{ id: SourceFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'design', label: 'Design' },
  { id: 'chat', label: 'Chat' },
]

export function RunConsolePanel({ focus }: { focus?: MainSwitchPagePayload } = {}): React.JSX.Element {
  const [runs, setRuns] = useState<ConsoleRun[]>([])
  const [sourceState, setSourceState] = useState<Record<RunSource, SourceState>>({
    design: { loading: true, count: 0 },
    chat: { loading: true, count: 0 },
  })
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [selectedRunKey, setSelectedRunKey] = useState<string | null>(null)
  const [events, setEvents] = useState<ConsoleEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [eventsError, setEventsError] = useState<string | undefined>()

  const selectedRun = useMemo(
    () => runs.find(run => runKey(run) === selectedRunKey) ?? null,
    [runs, selectedRunKey],
  )

  const visibleRuns = useMemo(() => {
    const filtered = sourceFilter === 'all'
      ? runs
      : runs.filter(run => run.source === sourceFilter)
    return filtered.sort((a, b) => b.updatedAt - a.updatedAt)
  }, [runs, sourceFilter])

  useEffect(() => {
    if (!focus?.runId) return
    const match = findFocusedRun(runs, focus)
    if (match) setSelectedRunKey(runKey(match))
  }, [focus, runs])

  const refreshRuns = useCallback(async () => {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      controller.abort()
    }, 4000)

    setSourceState({
      design: { loading: true, count: 0 },
      chat: { loading: true, count: 0 },
    })

    const [designResult, chatResult] = await Promise.allSettled([
      designAgentService.listAgentRuns(controller.signal),
      chatAgentService.listRuns({ limit: 80, signal: controller.signal }),
    ])
    window.clearTimeout(timeout)

    const nextRuns: ConsoleRun[] = []
    const nextSourceState: Record<RunSource, SourceState> = {
      design: { loading: false, count: 0 },
      chat: { loading: false, count: 0 },
    }

    if (designResult.status === 'fulfilled') {
      const designRuns = designResult.value.map(normalizeDesignRun)
      nextRuns.push(...designRuns)
      nextSourceState.design.count = designRuns.length
    } else {
      nextSourceState.design.error = statusError(designResult.reason)
    }

    if (chatResult.status === 'fulfilled') {
      const chatRuns = chatResult.value.map(normalizeChatRun)
      nextRuns.push(...chatRuns)
      nextSourceState.chat.count = chatRuns.length
    } else {
      nextSourceState.chat.error = statusError(chatResult.reason)
    }

    nextRuns.sort((a, b) => b.updatedAt - a.updatedAt)
    setRuns(nextRuns)
    setSourceState(nextSourceState)
    setSelectedRunKey((current) => {
      if (current && nextRuns.some(run => runKey(run) === current)) return current
      return nextRuns[0] ? runKey(nextRuns[0]) : null
    })
  }, [])

  useEffect(() => {
    void refreshRuns()
  }, [refreshRuns])

  useEffect(() => {
    if (!selectedRun) {
      setEvents([])
      setEventsError(undefined)
      setEventsLoading(false)
      return
    }

    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      controller.abort()
    }, 4000)
    setEventsLoading(true)
    setEventsError(undefined)

    const listEvents = selectedRun.source === 'design'
      ? designAgentService.listAgentRunEvents(selectedRun.runId, controller.signal)
      : chatAgentService.listRunEvents(selectedRun.runId, controller.signal)

    let active = true
    void listEvents
      .then((records) => {
        if (!active) return
        setEvents(records.map(record => normalizeEventRecord(selectedRun.source, record)))
      })
      .catch((error: unknown) => {
        if (active && !controller.signal.aborted) {
          setEventsError(statusError(error))
        }
      })
      .finally(() => {
        window.clearTimeout(timeout)
        if (active) setEventsLoading(false)
      })

    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [selectedRun])

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-teal-700 text-white">
            <Database size={17} />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold leading-5">Run Console</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <SourceBadge source="design" state={sourceState.design} />
              <SourceBadge source="chat" state={sourceState.chat} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex h-8 rounded-md border border-border bg-card p-0.5">
            {FILTERS.map(filter => (
              <button
                key={filter.id}
                type="button"
                onClick={() => { setSourceFilter(filter.id); }}
                className={cn(
                  'h-7 min-w-14 rounded px-2.5 text-xs font-medium transition-colors',
                  sourceFilter === filter.id
                    ? 'bg-surface-soft text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => { void refreshRuns(); }}
            className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-surface-soft hover:text-foreground"
            title="Refresh runs"
            aria-label="Refresh runs"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,420px)_minmax(0,1fr)] overflow-hidden max-lg:grid-cols-1">
        <section className="flex min-h-0 min-w-0 flex-col border-r border-border max-lg:border-b max-lg:border-r-0">
          <div className="grid h-9 shrink-0 grid-cols-[72px_minmax(0,1fr)_82px_64px] items-center border-b border-border bg-muted/40 px-3 text-[11px] font-medium uppercase text-muted-foreground">
            <span>Source</span>
            <span>Run</span>
            <span>Status</span>
            <span className="text-right">Events</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {visibleRuns.length === 0 ? (
              <div className="flex h-full min-h-40 items-center justify-center px-4 text-sm text-muted-foreground">
                No runs
              </div>
            ) : (
              visibleRuns.map(run => {
                const selected = runKey(run) === selectedRunKey
                return (
                  <button
                    key={runKey(run)}
                    type="button"
                    onClick={() => { setSelectedRunKey(runKey(run)); }}
                    className={cn(
                      'grid min-h-16 w-full grid-cols-[72px_minmax(0,1fr)_82px_64px] items-center border-b border-border px-3 text-left transition-colors',
                      selected ? 'bg-surface-soft' : 'hover:bg-muted/50',
                    )}
                  >
                    <span className="text-xs font-medium text-muted-foreground">{SOURCE_LABELS[run.source]}</span>
                    <span className="min-w-0 pr-3">
                      <span className="block truncate text-[13px] font-medium text-foreground">
                        {run.inputPreview || run.runId}
                      </span>
                      <span className="mt-1 block truncate text-[11px] text-muted-foreground">
                        {run.runId} · {formatTime(run.updatedAt)}
                      </span>
                    </span>
                    <StatusPill status={run.status} />
                    <span className="text-right text-xs tabular-nums text-muted-foreground">{run.eventCount}</span>
                  </button>
                )
              })
            )}
          </div>
        </section>

        <section className="flex min-h-0 min-w-0 flex-col">
          <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">
                {selectedRun ? selectedRun.inputPreview || selectedRun.runId : 'No run selected'}
              </div>
              {selectedRun ? (
                <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {SOURCE_LABELS[selectedRun.source]} · {selectedRun.runId}
                </div>
              ) : null}
            </div>
            {eventsLoading ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {eventsError ? (
              <div className="flex h-full min-h-40 items-center justify-center gap-2 px-4 text-sm text-destructive">
                <AlertCircle size={16} />
                <span>{eventsError}</span>
              </div>
            ) : events.length === 0 ? (
              <div className="flex h-full min-h-40 items-center justify-center px-4 text-sm text-muted-foreground">
                No events
              </div>
            ) : (
              <div className="divide-y divide-border">
                {events.map(event => {
                  const artifacts = extractObservationArtifacts(event.event)
                  return (
                    <article
                      key={`${event.source}:${event.runId}:${String(event.seq)}`}
                      className="grid min-h-14 grid-cols-[56px_150px_minmax(0,1fr)] gap-3 px-4 py-3 max-md:grid-cols-[48px_minmax(0,1fr)]"
                    >
                      <span className="text-xs tabular-nums text-muted-foreground">#{event.seq}</span>
                      <span className="text-xs text-muted-foreground max-md:hidden">{formatTime(event.ts)}</span>
                      <div className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-foreground">
                          {event.event.type}
                        </span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {eventSummary(event.event)}
                        </span>
                        {artifacts.length > 0 ? (
                          <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                            {artifacts.map(artifact => (
                              <ObservationArtifactCard key={artifact.uri} artifact={artifact} />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function SourceBadge({ source, state }: { source: RunSource; state: SourceState }): React.JSX.Element {
  if (state.loading) {
    return (
      <span className="inline-flex items-center gap-1">
        <Loader2 size={11} className="animate-spin" />
        {SOURCE_LABELS[source]}
      </span>
    )
  }
  if (state.error) {
    return (
      <span className="inline-flex items-center gap-1 text-amber-700">
        <AlertCircle size={11} />
        {SOURCE_LABELS[source]} not ready
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      <CheckCircle2 size={11} />
      {SOURCE_LABELS[source]} {state.count}
    </span>
  )
}

function ObservationArtifactCard({ artifact }: { artifact: ObservationArtifactPreview }): React.JSX.Element {
  const [imageFailed, setImageFailed] = useState(false)
  const Icon = artifactIcon(artifact.mediaType)
  const title = artifact.title || artifact.kind || artifact.mediaType
  const showImage = artifact.mediaType.startsWith('image/') && !imageFailed

  return (
    <div className="grid min-h-16 grid-cols-[56px_minmax(0,1fr)] overflow-hidden rounded-md border border-border bg-card">
      <div className="flex h-full min-h-16 items-center justify-center bg-muted/60 text-muted-foreground">
        {showImage ? (
          <img
            src={artifact.uri}
            alt={title}
            className="h-full min-h-16 w-full object-cover"
            onError={() => { setImageFailed(true); }}
          />
        ) : (
          <Icon size={18} />
        )}
      </div>
      <div className="min-w-0 px-2 py-1.5">
        <div className="truncate text-[12px] font-medium text-foreground">{title}</div>
        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{artifact.mediaType}</div>
        <div className="mt-1 truncate text-[10px] text-muted-foreground">{artifact.uri}</div>
      </div>
    </div>
  )
}

function artifactIcon(mediaType: string): typeof Image {
  if (mediaType.startsWith('image/')) return Image
  if (mediaType === 'application/json') return FileJson
  return File
}

function StatusPill({ status }: { status: string }): React.JSX.Element {
  const Icon = statusIcon(status)
  return (
    <span
      className={cn(
        'inline-flex h-6 max-w-[76px] items-center justify-center gap-1 rounded px-1.5 text-[11px] font-medium',
        statusClassName(status),
      )}
      title={status}
    >
      <Icon size={12} />
      <span className="truncate">{status}</span>
    </span>
  )
}

export function extractObservationArtifacts(event: AgentEvent): ObservationArtifactPreview[] {
  if (event.type !== 'tool_result') return []
  const output = event.output
  if (!isRecord(output) || !Array.isArray(output.observations)) return []

  return output.observations.flatMap((observation): ObservationArtifactPreview[] => {
    if (!isRecord(observation) || !isRecord(observation.artifactRef)) return []
    const ref = observation.artifactRef
    if (typeof ref.uri !== 'string' || typeof ref.mediaType !== 'string') return []
    return [{
      kind: typeof observation.kind === 'string' ? observation.kind : undefined,
      uri: ref.uri,
      mediaType: ref.mediaType,
      title: typeof ref.title === 'string' ? ref.title : undefined,
    }]
  })
}

function normalizeDesignRun(run: DesignAgentRunRecordSnapshot): ConsoleRun {
  return {
    source: 'design',
    runId: run.runId,
    sessionId: run.sessionId,
    status: run.status,
    eventCount: run.events.length,
    inputPreview: compactText(run.prompt),
    createdAt: run.startedAt,
    updatedAt: run.updatedAt || run.completedAt || run.startedAt,
  }
}

function normalizeChatRun(run: ChatAgentRunRecordSnapshot): ConsoleRun {
  return {
    source: 'chat',
    runId: run.runId,
    sessionId: run.sessionId,
    status: run.status,
    eventCount: run.eventCount,
    inputPreview: compactText(run.inputPreview ?? run.input?.message),
    createdAt: run.createdAt,
    updatedAt: run.lastEventAt ?? run.completedAt ?? run.startedAt ?? run.createdAt,
  }
}

function normalizeEventRecord(
  source: RunSource,
  record: AgentRunEventRecord,
): ConsoleEvent {
  return {
    source,
    runId: record.runId,
    seq: record.seq,
    ts: record.ts,
    event: record.event,
  }
}

function runKey(run: Pick<ConsoleRun, 'source' | 'runId'>): string {
  return `${run.source}:${run.runId}`
}

function findFocusedRun(runs: ConsoleRun[], focus: MainSwitchPagePayload): ConsoleRun | undefined {
  if (!focus.runId) return undefined
  const source = focus.pageletId === 'design' || focus.pageletId === 'chat'
    ? focus.pageletId
    : undefined
  return runs.find(run => run.runId === focus.runId && (!source || run.source === source)) ??
    runs.find(run => run.runId === focus.runId)
}

function statusClassName(status: string): string {
  if (status === 'completed') return 'bg-emerald-50 text-emerald-700'
  if (status === 'running' || status === 'queued') return 'bg-blue-50 text-blue-700'
  if (status === 'failed') return 'bg-red-50 text-red-700'
  if (status === 'cancelled' || status === 'stopped') return 'bg-slate-100 text-slate-600'
  return 'bg-muted text-muted-foreground'
}

function statusIcon(status: string): typeof CheckCircle2 {
  if (status === 'completed') return CheckCircle2
  if (status === 'running' || status === 'queued') return Clock3
  if (status === 'failed') return XCircle
  return AlertCircle
}

function eventSummary(event: AgentEvent): string {
  switch (event.type) {
    case 'assistant_delta':
      return compactText(event.text) || 'assistant delta'
    case 'assistant_message':
      return compactText(messageText(event.message)) || 'assistant message'
    case 'tool_call':
    case 'tool_result':
    case 'tool_error':
      return event.toolName
    case 'runtime_log':
      return compactText(event.message)
    case 'run_failed':
      return compactText(event.error.message)
    case 'permission_requested':
    case 'permission_resolved':
      return event.permission.type
    case 'step_started':
      return compactText(event.label)
    case 'child_run_started':
      return event.childRunId
    case 'extension_activated':
    case 'extension_deactivated':
      return event.extensionId
    default:
      return ''
  }
}

function messageText(message: RuntimeMessage): string {
  return message.content
}

function compactText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 140)
}

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return 'n/a'
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function statusError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'Not ready'
  if (error instanceof Error) return error.message
  return 'Not ready'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
