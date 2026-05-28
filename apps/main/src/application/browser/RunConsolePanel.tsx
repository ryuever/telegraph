import { useCallback, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import Editor from '@monaco-editor/react'
import type { OnMount } from '@monaco-editor/react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  Database,
  File,
  FileJson,
  Image,
  Loader2,
  MessagesSquare,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react'
import { PageletAgentService } from '@/apps/chat/application/browser/pagelet-agent-service'
import type { ChatAgentRunRecordSnapshot } from '@/apps/chat/application/common'
import { PageletDesignAgentService } from '@/apps/design/application/browser/pagelet-design-agent-service'
import type { DesignAgentRunRecordSnapshot } from '@/apps/design/application/common'
import { useIsPageletActive } from '@/apps/main/application/browser/pagelet-activity'
import type { AgentEvent, RuntimeMessage } from '@/packages/agent-protocol'
import type { MainSwitchPagePayload } from '@/packages/services/pagelet-host/common'
import { MarkdownMessage } from '@/packages/ui/components/MarkdownMessage'
import { cn } from '@/packages/ui/lib/utils'

const designAgentService = new PageletDesignAgentService()
const chatAgentService = new PageletAgentService()

type RunSource = 'design' | 'chat'
type SourceFilter = RunSource

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

interface ConsoleRunSession {
  key: string
  source: RunSource
  sessionId: string
  title: string
  status: string
  eventCount: number
  runCount: number
  updatedAt: number
  createdAt: number
  latestRunKey: string
  runs: ConsoleRun[]
}

interface ConsoleEvent {
  source: RunSource
  runId: string
  seq: number
  ts: number
  event: AgentEvent
}

interface ConsoleLogGroup {
  key: string
  marker: string
  ts: number
  title: string
  summary: string
  messages: ConsoleLogMessage[]
  event?: AgentEvent
}

interface ConsoleLogMessage {
  key: string
  role: 'system' | 'user' | 'assistant' | 'tool' | 'event'
  title: string
  content: string
}

type MessageContentView =
  | { kind: 'json'; content: string }
  | { kind: 'mixed-json'; prefix: string; content: string }
  | { kind: 'text' }

interface ConsoleRunEventRecord {
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
  { id: 'chat', label: 'Chat' },
  { id: 'design', label: 'Design' },
]

export function RunConsolePanel({ focus }: { focus?: MainSwitchPagePayload } = {}): React.JSX.Element {
  const isRunConsoleActive = useIsPageletActive('run-console')
  const [runs, setRuns] = useState<ConsoleRun[]>([])
  const [sourceState, setSourceState] = useState<Record<RunSource, SourceState>>({
    design: { loading: true, count: 0 },
    chat: { loading: true, count: 0 },
  })
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('chat')
  const [selectedRunKey, setSelectedRunKey] = useState<string | null>(null)
  const [events, setEvents] = useState<ConsoleEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [eventsError, setEventsError] = useState<string | undefined>()
  const [deleteError, setDeleteError] = useState<string | undefined>()
  const [selectedLogKey, setSelectedLogKey] = useState<string | null>(null)
  const [expandedSessionKeys, setExpandedSessionKeys] = useState<ReadonlySet<string>>(() => new Set())
  const [deletingSessionKeys, setDeletingSessionKeys] = useState<ReadonlySet<string>>(() => new Set())

  const selectedRun = useMemo(
    () => runs.find(run => runKey(run) === selectedRunKey) ?? null,
    [runs, selectedRunKey],
  )

  const logGroups = useMemo(
    () => events.flatMap(event => projectConsoleLogGroups(event)),
    [events],
  )

  const visibleRunSessions = useMemo(
    () => groupConsoleRuns(runs, sourceFilter),
    [runs, sourceFilter],
  )

  useEffect(() => {
    if (focus?.pageletId === 'chat' || focus?.pageletId === 'design') {
      setSourceFilter(focus.pageletId)
    }
  }, [focus?.pageletId])

  useEffect(() => {
    if (!focus?.runId) return
    const match = findFocusedRun(runs, focus)
    if (!match) return
    setSelectedRunKey(runKey(match))
    setExpandedSessionKeys(current => withSetValue(current, runSessionKey(match)))
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
    setDeleteError(undefined)

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
      const nextVisibleRuns = nextRuns.filter(run => run.source === sourceFilter)
      if (current && nextVisibleRuns.some(run => runKey(run) === current)) return current
      return nextVisibleRuns[0] ? runKey(nextVisibleRuns[0]) : null
    })
  }, [sourceFilter])

  useEffect(() => {
    if (!isRunConsoleActive) return
    void refreshRuns()
  }, [isRunConsoleActive, refreshRuns])

  useEffect(() => {
    setSelectedLogKey(current => {
      if (current && logGroups.some(group => group.key === current)) return current
      return logGroups[0]?.key ?? null
    })
  }, [logGroups])

  const toggleSession = useCallback((key: string) => {
    setExpandedSessionKeys(current => {
      const next = new Set(current)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }, [])

  const deleteRunSession = useCallback(async (session: ConsoleRunSession) => {
    setDeletingSessionKeys(current => withSetValue(current, session.key))
    setDeleteError(undefined)
    try {
      if (session.source === 'design') {
        await designAgentService.deleteAgentSessionRuns(session.sessionId)
      } else {
        await chatAgentService.deleteSessionRuns(session.sessionId)
      }

      const deletedRunKeys = new Set(session.runs.map(runKey))
      setRuns(current => current.filter(run => runSessionKey(run) !== session.key))
      setExpandedSessionKeys(current => withoutSetValue(current, session.key))
      setSelectedRunKey(current => (current && deletedRunKeys.has(current) ? null : current))
      setSourceState(current => ({
        ...current,
        [session.source]: {
          ...current[session.source],
          count: Math.max(0, current[session.source].count - session.runCount),
          error: undefined,
        },
      }))
    } catch (error) {
      setDeleteError(statusError(error))
    } finally {
      setDeletingSessionKeys(current => withoutSetValue(current, session.key))
    }
  }, [])

  useEffect(() => {
    if (!selectedRun) {
      setEvents([])
      setEventsError(undefined)
      setEventsLoading(false)
      setSelectedLogKey(null)
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
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background pb-8 text-foreground">
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
              {deleteError ? (
                <span className="inline-flex items-center gap-1 text-amber-700">
                  <AlertCircle size={11} />
                  Delete failed: {deleteError}
                </span>
              ) : null}
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
          <div className="grid h-12 shrink-0 grid-cols-[24px_minmax(0,1fr)_82px_64px_32px] items-center border-b border-border bg-muted/40 px-3 text-[11px] font-medium uppercase text-muted-foreground">
            <span aria-hidden="true" />
            <span>Run</span>
            <span>Status</span>
            <span className="text-right">Events</span>
            <span aria-hidden="true" />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {visibleRunSessions.length === 0 ? (
              <div className="flex h-full min-h-40 items-center justify-center px-4 text-sm text-muted-foreground">
                No runs
              </div>
            ) : (
              visibleRunSessions.map(session => {
                const expanded = expandedSessionKeys.has(session.key)
                const containsSelectedRun = selectedRun ? runSessionKey(selectedRun) === session.key : false
                const deletingSession = deletingSessionKeys.has(session.key)
                return (
                  <div
                    key={session.key}
                    className={cn(
                      'group border-b border-border bg-background',
                      containsSelectedRun && 'bg-surface-soft/45',
                    )}
                  >
                    <div
                      className={cn(
                        'grid min-h-10 w-full grid-cols-[24px_minmax(0,1fr)_82px_64px_32px] items-center px-3 transition-colors',
                        containsSelectedRun ? 'bg-surface-soft/70' : 'hover:bg-muted/35',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => { toggleSession(session.key); }}
                        aria-expanded={expanded}
                        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${SOURCE_LABELS[session.source]} session ${session.sessionId}`}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                        title={expanded ? 'Collapse session' : 'Expand session'}
                      >
                        {expanded ? (
                          <ChevronDown size={13} />
                        ) : (
                          <ChevronRight size={13} />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => { toggleSession(session.key); }}
                        className="col-span-3 grid h-full min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_82px_64px] items-center text-left"
                        title={session.title}
                      >
                        <span className="min-w-0 pr-3">
                          <span className="block truncate text-[13px] font-semibold text-foreground">
                            {session.title}
                          </span>
                        </span>
                        <StatusPill status={session.status} />
                        <span className="text-right text-xs tabular-nums text-muted-foreground">{session.eventCount}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { void deleteRunSession(session) }}
                        disabled={deletingSession}
                        aria-label={`Delete ${SOURCE_LABELS[session.source]} session ${session.sessionId}`}
                        title="Delete session"
                        className={cn(
                          'ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-colors hover:bg-background hover:text-destructive focus:opacity-100 group-hover:opacity-100',
                          (containsSelectedRun || deletingSession) && 'opacity-100',
                          deletingSession && 'cursor-wait hover:text-muted-foreground',
                        )}
                      >
                        {deletingSession ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Trash2 size={13} />
                        )}
                      </button>
                    </div>

                    {expanded ? (
                      <div className="border-t border-border/70 bg-muted/15">
                        {session.runs.map(run => {
                          const selected = runKey(run) === selectedRunKey
                          return (
                            <button
                              key={runKey(run)}
                              type="button"
                              onClick={() => { setSelectedRunKey(runKey(run)); }}
                              className={cn(
                                'grid min-h-9 w-full grid-cols-[40px_minmax(0,1fr)_82px_64px_32px] items-center px-3 text-left transition-colors',
                                selected ? 'bg-background' : 'hover:bg-background/75',
                              )}
                            >
                              <span className="flex h-full items-center justify-end pr-2">
                                <span className={cn(
                                  'h-1.5 w-1.5 rounded-full',
                                  selected ? 'bg-primary' : 'bg-muted-foreground/40',
                                )}
                                />
                              </span>
                              <span className="min-w-0 pr-3">
                                <span className="block truncate text-[12.5px] font-medium text-foreground">
                                  {run.inputPreview || run.runId}
                                </span>
                              </span>
                              <StatusPill status={run.status} />
                              <span className="text-right text-xs tabular-nums text-muted-foreground">{run.eventCount}</span>
                              <span aria-hidden="true" />
                            </button>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                )
              })
            )}
          </div>
        </section>

        <section className="flex min-h-0 min-w-0 flex-col">
          <RunLogInspector
            groups={logGroups}
            selectedKey={selectedLogKey}
            selectedRun={selectedRun}
            eventsLoading={eventsLoading}
            eventsError={eventsError}
            onSelect={setSelectedLogKey}
          />
        </section>
      </div>
    </div>
  )
}

function RunLogInspector({
  groups,
  selectedKey,
  selectedRun,
  eventsLoading,
  eventsError,
  onSelect,
}: {
  groups: ConsoleLogGroup[]
  selectedKey: string | null
  selectedRun: ConsoleRun | null
  eventsLoading: boolean
  eventsError?: string
  onSelect: (key: string) => void
}): React.JSX.Element {
  const selected = groups.find(group => group.key === selectedKey) ?? groups[0]
  const artifacts = selected?.event ? extractObservationArtifacts(selected.event) : []
  const [copied, setCopied] = useState(false)
  const selectedCopyContent = useMemo(() => (
    selected ? selected.messages.map(message => message.content).join('\n\n') : ''
  ), [selected])
  const handleCopySelected = useCallback(() => {
    if (!selectedCopyContent) return
    void navigator.clipboard.writeText(selectedCopyContent)
      .then(() => {
        setCopied(true)
      })
      .catch(() => {
        // Clipboard permission can be unavailable in test or restricted renderer contexts.
      })
  }, [selectedCopyContent])

  useEffect(() => {
    setCopied(false)
  }, [selected?.key])

  useEffect(() => {
    if (!copied) return undefined
    const timeout = window.setTimeout(() => {
      setCopied(false)
    }, 1200)
    return () => {
      window.clearTimeout(timeout)
    }
  }, [copied])

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(220px,300px)_minmax(0,1fr)] max-md:grid-cols-1">
      <aside className="flex min-h-0 min-w-0 flex-col border-r border-border bg-muted/20 max-md:max-h-56 max-md:border-b max-md:border-r-0">
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
          ) : groups.length === 0 ? (
            <div className="flex h-full min-h-40 items-center justify-center px-4 text-sm text-muted-foreground">
              No events
            </div>
          ) : (
            groups.map(group => {
              const selectedGroup = selected ? group.key === selected.key : false
              return (
                <button
                  key={group.key}
                  type="button"
                  onClick={() => { onSelect(group.key); }}
                  className={cn(
                    'grid min-h-14 w-full grid-cols-[46px_minmax(0,1fr)] gap-2 border-b border-border px-3 py-2 text-left transition-colors',
                    selectedGroup ? 'bg-background' : 'hover:bg-background/70',
                  )}
                >
                  <span className="pt-0.5 text-[11px] tabular-nums text-muted-foreground">{group.marker}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-foreground">{group.title}</span>
                    <span className="mt-1 block truncate text-[11px] text-muted-foreground">{group.summary}</span>
                  </span>
                </button>
              )
            })
          )}
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-col">
        {selected ? (
          <>
            <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <MessagesSquare size={15} className="shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-semibold">{selected.title}</span>
                </div>
                <div className="mt-1 truncate text-[11px] text-muted-foreground">
                  {selected.marker} · {formatTime(selected.ts)}
                </div>
              </div>
              <button
                type="button"
                onClick={handleCopySelected}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                title={copied ? 'Copied' : 'Copy'}
                aria-label={copied ? 'Copied log content' : 'Copy log content'}
              >
                {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <div className="flex h-full min-h-0 flex-col gap-3">
                {selected.messages.map(message => (
                  <MessageBlock key={message.key} message={message} />
                ))}
                {artifacts.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {artifacts.map(artifact => (
                      <ObservationArtifactCard key={artifact.uri} artifact={artifact} />
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </>
        ) : (
          <div className="flex h-full min-h-40 items-center justify-center px-4 text-sm text-muted-foreground">
            Select an event to inspect
          </div>
        )}
      </div>
    </div>
  )
}

function MessageBlock({ message }: { message: ConsoleLogMessage }): React.JSX.Element {
  const contentView = parseMessageContentView(message.content)
  const jsonContent = contentView.kind === 'text' ? undefined : contentView.content
  const handleJsonEditorMount = useCallback<OnMount>((editor) => {
    window.requestAnimationFrame(() => {
      editor.layout()
    })

    const parent = editor.getDomNode()?.parentElement
    if (!parent || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      editor.layout()
    })
    observer.observe(parent)
    editor.onDidDispose(() => {
      observer.disconnect()
    })
  }, [])

  return (
    <section className="flex h-full min-h-[220px] flex-1 flex-col overflow-hidden rounded-md border border-border bg-card">
      <span className="sr-only">{message.title}</span>
      {jsonContent ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {contentView.kind === 'mixed-json' ? (
            <pre className="shrink-0 whitespace-pre-wrap break-words border-b border-border px-3 py-2 text-xs leading-5 text-foreground">
              {contentView.prefix}
            </pre>
          ) : null}
          <div className="h-full min-h-0 flex-1 overflow-hidden">
            <Editor
              height="100%"
              language="json"
              value={jsonContent}
              theme="vs-dark"
              onMount={handleJsonEditorMount}
              options={{
                readOnly: true,
                domReadOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 12,
                lineNumbers: 'on',
                renderLineHighlight: 'line',
                padding: { top: 8, bottom: 8 },
                overviewRulerBorder: false,
                hideCursorInOverviewRuler: true,
                overviewRulerLanes: 0,
                scrollbar: {
                  verticalScrollbarSize: 8,
                  horizontalScrollbarSize: 8,
                },
                wordWrap: 'on',
                automaticLayout: true,
              }}
            />
          </div>
        </div>
      ) : (
        <div className="min-h-[120px] flex-1 overflow-auto px-3 py-2">
          <MarkdownMessage
            content={message.content}
            compact
            className="text-xs leading-5 [&_pre]:text-[11px]"
          />
        </div>
      )}
    </section>
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
  record: ConsoleRunEventRecord,
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

function runSessionKey(run: Pick<ConsoleRun, 'source' | 'sessionId' | 'runId'>): string {
  return `${run.source}:${run.sessionId ?? run.runId}`
}

export function groupConsoleRuns(runs: ConsoleRun[], sourceFilter: SourceFilter): ConsoleRunSession[] {
  const sessions = new Map<string, ConsoleRun[]>()
  const filteredRuns = runs.filter(run => run.source === sourceFilter)

  for (const run of filteredRuns) {
    const key = runSessionKey(run)
    const sessionRuns = sessions.get(key) ?? []
    sessionRuns.push(run)
    sessions.set(key, sessionRuns)
  }

  return Array.from(sessions.entries())
    .map(([key, sessionRuns]) => makeConsoleRunSession(key, sessionRuns))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

function makeConsoleRunSession(key: string, runs: ConsoleRun[]): ConsoleRunSession {
  const timelineRuns = [...runs].sort((a, b) => a.createdAt - b.createdAt)
  const firstRun = timelineRuns[0]
  const latestRun = runs.reduce((latest, run) => (
    run.updatedAt > latest.updatedAt ? run : latest
  ), firstRun)
  const sessionId = firstRun.sessionId ?? latestRun.sessionId ?? latestRun.runId

  return {
    key,
    source: latestRun.source,
    sessionId,
    title: consoleSessionTitle(firstRun, latestRun),
    status: consoleSessionStatus(timelineRuns, latestRun),
    eventCount: timelineRuns.reduce((total, run) => total + run.eventCount, 0),
    runCount: timelineRuns.length,
    updatedAt: latestRun.updatedAt,
    createdAt: firstRun.createdAt,
    latestRunKey: runKey(latestRun),
    runs: timelineRuns,
  }
}

function consoleSessionTitle(firstRun: ConsoleRun, latestRun: ConsoleRun): string {
  return firstRun.inputPreview ||
    latestRun.inputPreview ||
    `${SOURCE_LABELS[latestRun.source]} session`
}

function consoleSessionStatus(runs: ConsoleRun[], latestRun: ConsoleRun): string {
  if (runs.some(run => run.status === 'running')) return 'running'
  if (runs.some(run => run.status === 'queued')) return 'queued'
  return latestRun.status
}

function withSetValue(values: ReadonlySet<string>, value: string): ReadonlySet<string> {
  if (values.has(value)) return values
  const next = new Set(values)
  next.add(value)
  return next
}

function withoutSetValue(values: ReadonlySet<string>, value: string): ReadonlySet<string> {
  if (!values.has(value)) return values
  const next = new Set(values)
  next.delete(value)
  return next
}

function shortId(value: string): string {
  if (value.length <= 14) return value
  return `${value.slice(0, 6)}...${value.slice(-5)}`
}

export function projectConsoleLogGroups(item: ConsoleEvent): ConsoleLogGroup[] {
  const event = item.event
  if (isThinkingEvent(event)) return []

  if (event.type === 'model_request') {
    return [consoleLogGroup(item, {
      title: 'Model request',
      summary: modelRequestSummary(event),
      messages: [modelRequestPayloadMessage(event)],
      event,
    })]
  }

  if (event.type === 'run_completed') {
    const assistantText = textFromMessageLike(event.output)
    if (assistantText) {
      return [consoleLogGroup(item, {
        suffix: 'assistant-final',
        title: 'Assistant message',
        summary: assistantText,
        messages: [consoleLogMessage({
          key: 'assistant-final',
          role: 'assistant',
          title: 'Assistant',
          content: assistantText,
        })],
      })]
    }
  }

  const summary = eventSummary(event)
  return [consoleLogGroup(item, {
    title: eventTitle(event),
    summary,
    messages: [consoleLogMessage({
      key: event.type,
      role: eventRole(event),
      title: eventTitle(event),
      content: eventDetail(event),
    })],
    event,
  })]
}

function modelRequestPayloadMessage(event: Extract<AgentEvent, { type: 'model_request' }>): ConsoleLogMessage {
  const payload = recordValue(event.payload)
  const raw = recordValue(event.raw)
  const rawContext = recordValue(raw?.context)
  const content = payload ?? rawContext ?? event.payload
  return consoleLogMessage({
    key: 'model-request-payload',
    role: 'event',
    title: 'Request payload',
    content: formatJson(content),
  })
}

function modelRequestSummary(event: Extract<AgentEvent, { type: 'model_request' }>): string {
  const payload = recordValue(event.payload)
  const raw = recordValue(event.raw)
  const rawContext = recordValue(raw?.context)
  const messages = arrayField(payload, 'messages').length > 0
    ? arrayField(payload, 'messages')
    : arrayField(rawContext, 'messages')
  if (messages.length > 0) {
    return `${String(messages.length)} messages`
  }
  return event.requestId
}

function consoleLogGroup(
  item: ConsoleEvent,
  input: { suffix?: string; title: string; summary: string; messages: ConsoleLogMessage[]; event?: AgentEvent },
): ConsoleLogGroup {
  const suffix = input.suffix ? `:${input.suffix}` : ''
  return {
    key: `${item.source}:${item.runId}:${String(item.seq)}${suffix}`,
    marker: input.suffix ? `#${String(item.seq)}.${entrySuffixMarker(input.suffix)}` : `#${String(item.seq)}`,
    ts: item.ts,
    title: input.title,
    summary: input.summary,
    messages: input.messages,
    event: input.event,
  }
}

function consoleLogMessage(input: ConsoleLogMessage): ConsoleLogMessage {
  return input
}

function entrySuffixMarker(suffix: string): string {
  if (suffix === 'system') return 's'
  if (suffix === 'assistant-final') return 'a'
  const parts = suffix.split(':')
  const role = parts[0] ?? ''
  const index = parts.length > 1 ? parts[1] : ''
  const first = role.slice(0, 1)
  return `${first}${index}`
}

function eventTitle(event: AgentEvent): string {
  switch (event.type) {
    case 'assistant_delta':
    case 'assistant_message':
      return 'Assistant message'
    case 'model_request':
      return 'Model request'
    case 'model_event':
      return 'Model event'
    case 'runtime_log':
      return `Runtime ${event.level}`
    case 'run_started':
      return 'Run started'
    case 'run_completed':
      return 'Run completed'
    case 'run_failed':
      return 'Run failed'
    case 'run_cancelled':
      return 'Run cancelled'
    case 'tool_call':
      return `Tool call: ${event.toolName}`
    case 'tool_result':
      return `Tool result: ${event.toolName}`
    case 'tool_error':
      return `Tool error: ${event.toolName}`
    case 'permission_requested':
      return 'Permission requested'
    case 'permission_resolved':
      return 'Permission resolved'
    case 'step_started':
      return 'Step started'
    case 'step_completed':
      return 'Step completed'
    case 'edge_taken':
      return 'Edge taken'
    case 'child_run_started':
      return 'Child run started'
    case 'child_run_completed':
      return 'Child run completed'
    case 'extension_activated':
      return 'Extension activated'
    case 'extension_deactivated':
      return 'Extension deactivated'
  }
}

function eventRole(event: AgentEvent): ConsoleLogMessage['role'] {
  if (event.type === 'assistant_delta' || event.type === 'assistant_message' || event.type === 'run_completed') return 'assistant'
  if (event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'tool_error') return 'tool'
  return 'event'
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
    case 'run_started':
      return [
        event.pattern,
        event.origin?.runtimeId,
      ].filter(Boolean).join(' / ') || 'Run started'
    case 'run_completed':
      return summarizeRunOutput(event.output) ?? 'Run completed'
    case 'run_cancelled':
      return event.reason ?? 'Run cancelled'
    case 'model_request':
      return event.requestId
    case 'model_event':
      return rawEventType(event.raw) || event.requestId
    case 'assistant_delta':
      return event.text || 'assistant delta'
    case 'assistant_message':
      return messageText(event.message) || 'assistant message'
    case 'tool_call':
      return summarizeToolPayload(event.toolName, event.input)
    case 'tool_result':
      return summarizeToolPayload(event.toolName, event.output)
    case 'tool_error':
      return `${event.toolName}: ${event.error.message}`
    case 'runtime_log':
      return compactText(event.message)
    case 'run_failed':
      return compactText(event.error.message)
    case 'permission_requested':
    case 'permission_resolved':
      return event.permission.type
    case 'step_started':
      return compactText(event.label)
    case 'step_completed':
      return summarizeToolPayload(event.stepId, event.output)
    case 'edge_taken':
      return event.condition
        ? `${event.from} -> ${event.to} (${event.condition})`
        : `${event.from} -> ${event.to}`
    case 'child_run_started':
      return event.label ?? event.childRunId
    case 'child_run_completed':
      return summarizeToolPayload(event.childRunId, event.output)
    case 'extension_activated':
    case 'extension_deactivated':
      return event.extensionId
  }
}

function messageText(message: RuntimeMessage): string {
  return message.content
}

function eventDetail(event: AgentEvent): string {
  switch (event.type) {
    case 'run_started':
      return lines([
        `Run: ${event.runId}`,
        event.pattern ? `Pattern: ${event.pattern}` : undefined,
        event.origin?.runtimeId ? `Runtime: ${event.origin.runtimeId}` : undefined,
        event.producerVersion ? `Producer: ${event.producerVersion}` : undefined,
      ])
    case 'run_completed':
      return summarizeRunOutput(event.output) ?? formatJson(event.output)
    case 'run_cancelled':
      return event.reason ?? 'Cancelled'
    case 'run_failed':
      return lines([
        event.error.message,
        event.error.code ? `Code: ${event.error.code}` : undefined,
        event.error.details ? formatJson(event.error.details) : undefined,
      ])
    case 'model_request': {
      return modelRequestPayloadMessage(event).content
    }
    case 'model_event':
      return formatJson(event.raw)
    case 'assistant_delta':
      return event.text || 'assistant delta'
    case 'assistant_message':
      return messageText(event.message) || 'assistant message'
    case 'tool_call':
      return formatJson(event.input)
    case 'tool_result':
      return formatJson(event.output)
    case 'tool_error':
      return lines([
        event.error.message,
        event.error.code ? `Code: ${event.error.code}` : undefined,
        event.error.details ? formatJson(event.error.details) : undefined,
      ])
    case 'runtime_log':
      return event.raw ? `${event.message}\n\n${formatJson(event.raw)}` : event.message
    case 'permission_requested':
      return formatJson(event.permission)
    case 'permission_resolved':
      return `${event.granted ? 'Granted' : 'Denied'}\n\n${formatJson(event.permission)}`
    case 'step_started':
      return lines([
        event.label,
        `Step: ${event.stepId}`,
        event.kind ? `Kind: ${event.kind}` : undefined,
      ])
    case 'step_completed':
      return formatJson(event.output ?? { stepId: event.stepId })
    case 'edge_taken':
      return eventSummary(event)
    case 'child_run_started':
      return lines([
        event.label,
        `Child run: ${event.childRunId}`,
        `Parent run: ${event.parentRunId}`,
      ])
    case 'child_run_completed':
      return formatJson(event.output)
    case 'extension_activated':
    case 'extension_deactivated':
      return event.extensionId
  }
}

function isThinkingEvent(event: AgentEvent): boolean {
  if (event.type === 'runtime_log') {
    return event.message === 'thinking_delta' || rawEventType(event.raw).includes('thinking')
  }
  if (event.type === 'model_event') {
    const type = rawEventType(event.raw)
    return type.includes('thinking') || type.includes('reasoning')
  }
  return false
}

function rawEventType(value: unknown): string {
  const type = recordValue(value)?.type
  return typeof type === 'string' ? type : ''
}

function textFromMessageLike(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  const record = recordValue(value)
  if (!record) return undefined
  const direct = stringField(record, 'content') ?? stringField(record, 'text') ?? stringField(record, 'reply')
  if (direct) return direct
  const message = recordValue(record.message)
  if (message) {
    return stringField(message, 'content') ?? stringField(message, 'text')
  }
  const content = record.content
  if (Array.isArray(content)) {
    const parts = content
      .map(part => stringField(recordValue(part), 'text'))
      .filter((part): part is string => Boolean(part))
    if (parts.length > 0) return parts.join('\n')
  }
  return undefined
}

function summarizeRunOutput(output: unknown): string | undefined {
  const artifact = recordField(output, 'artifact')
  const artifactTitle = stringField(artifact, 'title')
  if (artifactTitle) return `Artifact: ${artifactTitle}`
  const direct = textFromMessageLike(output)
  if (direct) return compactText(direct)
  const orchestration = recordField(output, 'orchestration')
  const childRuns = arrayField(orchestration, 'childRuns')
  if (childRuns.length > 0) return `${String(childRuns.length)} child runs completed`
  return undefined
}

function summarizeToolPayload(label: string, payload: unknown): string {
  const text = textFromMessageLike(payload)
  if (text) return `${label}: ${compactText(text)}`
  const artifact = recordField(payload, 'artifact')
  const artifactTitle = stringField(artifact, 'title')
  if (artifactTitle) return `${label}: ${artifactTitle}`
  if (isRecord(payload)) {
    const keys = Object.keys(payload).slice(0, 3)
    if (keys.length > 0) return `${label}: ${keys.join(', ')}`
  }
  return label
}

function lines(values: Array<string | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).join('\n')
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return ''
  }
}

function parseMessageContentView(content: string): MessageContentView {
  const trimmed = content.trim()
  if (!trimmed) return { kind: 'text' }

  const wholeJson = parseJsonContent(trimmed)
  if (wholeJson) return { kind: 'json', content: wholeJson }

  const jsonBlock = parseTrailingJsonBlock(trimmed)
  if (jsonBlock) {
    return {
      kind: 'mixed-json',
      prefix: jsonBlock.prefix,
      content: jsonBlock.content,
    }
  }

  return { kind: 'text' }
}

function parseJsonContent(content: string): string | undefined {
  try {
    return JSON.stringify(JSON.parse(content) as unknown, null, 2)
  } catch {
    return undefined
  }
}

function parseTrailingJsonBlock(content: string): { prefix: string; content: string } | undefined {
  for (let index = 0; index < content.length; index++) {
    const char = content[index]
    if (char !== '{' && char !== '[') continue

    const json = parseJsonContent(content.slice(index).trim())
    if (!json) continue

    const prefix = content.slice(0, index).trimEnd()
    if (!prefix) return { prefix: '', content: json }
    return { prefix, content: json }
  }

  return undefined
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

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function arrayField(value: unknown, key: string): unknown[] {
  const field = recordValue(value)?.[key]
  return Array.isArray(field) ? field : []
}

function recordField(value: unknown, key: string): Record<string, unknown> | undefined {
  return recordValue(recordValue(value)?.[key])
}

function stringField(value: unknown, key: string): string | undefined {
  const field = recordValue(value)?.[key]
  return typeof field === 'string' && field.length > 0 ? field : undefined
}
