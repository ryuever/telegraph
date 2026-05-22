import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { ArrowLeft, Bot, CheckCircle2, ChevronDown, CircleDashed, Layers3, SendHorizontal, Settings, Sparkles, Square, UserRound } from 'lucide-react'
import { MarkdownMessage } from '@/packages/ui/components/MarkdownMessage'
import { Button } from '@/packages/ui/components/ui/button'
import { Textarea } from '@/packages/ui/components/ui/textarea'
import { cn } from '@/packages/ui/lib/utils'
import type { DesignAgentStreamEvent } from '@/apps/design/application/common'
import type { DesignProjectedArtifact } from './design-agent-projector'
import {
  DesignArtifactWorkbench,
  type ArtifactApplyState,
  type DesignSelectedComponent,
} from './DesignArtifactWorkbench'
import { extractDesignPatchOperations } from './design-artifact-view'
import {
  reduceDesignSubagentItems,
  type DesignSubagentViewItem,
} from './design-subagent-projector'
import { DesignSubagentPanel } from './DesignSubagentPanel'
import { PageletDesignAgentService } from './pagelet-design-agent-service'

export type DesignRunStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface DesignWorkspaceSummary {
  status: DesignRunStatus
  artifactCount: number
  activeArtifactTitle?: string
}

type Message =
  | {
    id: string
    role: 'user'
    content: string
  }
  | {
    id: string
    role: 'assistant'
    content: string
    runStatus?: DesignRunStatus
  }

interface DesignWorkspaceProps {
  initialPrompt: string
  sessionId?: string
  sessionTitle?: string
  onOpenSettings?: () => void
  onReturnToEntry?: () => void
  onSessionUpdate?: (sessionId: string, summary: DesignWorkspaceSummary) => void
}

interface DesignTraceItem {
  id: string
  label: string
  status: DesignRunStatus
  detail?: string
}

const GENERIC_COMPLETION_MESSAGE = '已完成。'

export function DesignWorkspace({
  initialPrompt,
  sessionId: providedSessionId,
  sessionTitle,
  onOpenSettings,
  onReturnToEntry,
  onSessionUpdate,
}: DesignWorkspaceProps): JSX.Element {
  const sessionId = useMemo(() => providedSessionId ?? globalThis.crypto.randomUUID(), [providedSessionId])
  const initialUserMessageId = useMemo(() => globalThis.crypto.randomUUID(), [])
  const initialAssistantMessageId = useMemo(() => globalThis.crypto.randomUUID(), [])
  const agent = useMemo(() => new PageletDesignAgentService(), [])
  const initialRunStarted = useRef(false)
  const activeControllers = useRef<Map<string, AbortController>>(new Map())
  const assistantArtifactTitles = useRef<Map<string, string>>(new Map())
  const [messages, setMessages] = useState<Message[]>([
    { id: initialUserMessageId, role: 'user', content: initialPrompt },
    { id: initialAssistantMessageId, role: 'assistant', content: '', runStatus: 'running' },
  ])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<DesignRunStatus>('running')
  const [artifacts, setArtifacts] = useState<DesignProjectedArtifact[]>([])
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null)
  const [artifactMode, setArtifactMode] = useState<'preview' | 'code' | 'inspect'>('preview')
  const [selectedComponent, setSelectedComponent] = useState<DesignSelectedComponent | null>(null)
  const [requestedArtifactIds, setRequestedArtifactIds] = useState<Set<string>>(() => new Set())
  const [artifactApplyStates, setArtifactApplyStates] = useState<Map<string, ArtifactApplyState>>(() => new Map())
  const [traceItems, setTraceItems] = useState<DesignTraceItem[]>([])
  const [subagentItems, setSubagentItems] = useState<DesignSubagentViewItem[]>([])

  const appendAssistantText = (text: string, messageId?: string): void => {
    setMessages((prev) => {
      const next = [...prev]
      const targetIndex = messageId
        ? next.findIndex(message => message.role === 'assistant' && message.id === messageId)
        : findLastAssistantIndex(next)
      const target = targetIndex >= 0 ? next[targetIndex] : undefined
      if (target?.role === 'assistant') {
        next[targetIndex] = { ...target, content: `${target.content}${text}` }
        return next
      }
      return [...next, { id: messageId ?? globalThis.crypto.randomUUID(), role: 'assistant', content: text }]
    })
  }

  const setAssistantRunStatus = (messageId: string, nextStatus: DesignRunStatus): void => {
    setMessages(prev => prev.map(message => {
      if (message.role !== 'assistant' || message.id !== messageId) return message
      const content = nextStatus === 'completed' && message.content.trim().length === 0
        ? assistantCompletionMessage(assistantArtifactTitles.current.get(messageId))
        : message.content
      return { ...message, runStatus: nextStatus, content }
    }))
  }

  const rememberAssistantArtifact = (messageId: string, artifact: DesignProjectedArtifact): void => {
    const title = artifact.title ?? artifact.id
    assistantArtifactTitles.current.set(messageId, title)
    setMessages(prev => prev.map(message => {
      if (
        message.role !== 'assistant' ||
        message.id !== messageId ||
        message.runStatus !== 'completed' ||
        message.content !== GENERIC_COMPLETION_MESSAGE
      ) {
        return message
      }
      return { ...message, content: assistantCompletionMessage(title) }
    }))
  }

  const runAgent = (prompt: string, context?: Record<string, unknown>, assistantMessageId = globalThis.crypto.randomUUID()): void => {
    const abortController = new AbortController()
    activeControllers.current.set(assistantMessageId, abortController)
    setStatus('running')
    setAssistantRunStatus(assistantMessageId, 'running')
    void agent.send({
      prompt,
      sessionId,
      context,
      signal: abortController.signal,
      onStatus: nextStatus => {
        setStatus(nextStatus)
        setAssistantRunStatus(assistantMessageId, nextStatus)
      },
      onAssistantText: text => { appendAssistantText(text, assistantMessageId) },
      onTraceEvent: event => {
        setTraceItems(prev => reduceTraceItems(prev, event))
        if (event.type === 'agent_event') {
          setSubagentItems(prev => reduceDesignSubagentItems(prev, event))
        }
      },
      onSubagent: subagent => {
        setSubagentItems(prev => reduceDesignSubagentItems(prev, {
          type: 'subagent_updated',
          runId: subagent.parentRunId,
          subagent,
        }))
      },
      onArtifact: artifact => {
        rememberAssistantArtifact(assistantMessageId, artifact)
        setArtifacts((prev) => [...prev.filter(item => item.id !== artifact.id), artifact])
        setActiveArtifactId(artifact.id)
        setSelectedComponent(null)
      },
    }).catch((error: unknown) => {
      if (isCancelledError(error)) {
        setStatus('cancelled')
        return
      }
      setStatus('failed')
      setAssistantRunStatus(assistantMessageId, 'failed')
      appendAssistantText(`\n${error instanceof Error ? error.message : String(error)}`, assistantMessageId)
    }).finally(() => {
      activeControllers.current.delete(assistantMessageId)
    })
  }

  const stopAgentRuns = (): void => {
    for (const [messageId, controller] of activeControllers.current) {
      controller.abort()
      setAssistantRunStatus(messageId, 'cancelled')
    }
    activeControllers.current.clear()
    setStatus('cancelled')
  }

  const cancelSubagent = (childRunId: string): void => {
    setSubagentItems(prev => prev.map(item => {
      if (item.id !== childRunId) return item
      return { ...item, status: 'stopped', cancellable: false }
    }))
    void agent.cancelSubagent(childRunId).catch(() => {})
  }

  useEffect(() => {
    if (initialRunStarted.current) return
    initialRunStarted.current = true
    runAgent(initialPrompt, { surface: 'design-workspace', initial: true }, initialAssistantMessageId)
    return () => {
      for (const controller of activeControllers.current.values()) {
        controller.abort()
      }
      activeControllers.current.clear()
    }
  }, [initialPrompt])

  useEffect(() => {
    const activeArtifact = artifacts.find(artifact => artifact.id === activeArtifactId)
    onSessionUpdate?.(sessionId, {
      status,
      artifactCount: artifacts.length,
      activeArtifactTitle: activeArtifact?.title ?? activeArtifact?.id,
    })
  }, [activeArtifactId, artifacts, onSessionUpdate, sessionId, status])

  const handleSend = () => {
    if (!input.trim()) return
    const prompt = input.trim()
    const assistantMessageId = globalThis.crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      { id: globalThis.crypto.randomUUID(), role: 'user', content: prompt },
      { id: assistantMessageId, role: 'assistant', content: '', runStatus: 'running' },
    ])
    setInput('')
    runAgent(prompt, {
      surface: 'design-workspace',
      artifactCount: artifacts.length,
      prompt,
      activeArtifact: summarizeActiveArtifact(artifacts, activeArtifactId),
      selectedComponent: summarizeSelectedComponent(selectedComponent, activeArtifactId),
    }, assistantMessageId)
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setInput(e.target.value)
  }

  const handleSelectArtifact = (artifactId: string): void => {
    setActiveArtifactId(artifactId)
    setSelectedComponent((prev) => prev?.artifactId === artifactId ? prev : null)
  }

  const handleSelectComponent = (component: DesignSelectedComponent): void => {
    setSelectedComponent(component)
    if (component.source !== 'preview-dom') {
      setArtifactMode('inspect')
    }
  }

  const handlePatchOperationsChange = (
    artifactId: string,
    operations: NonNullable<ReturnType<typeof extractDesignPatchOperations>>,
  ): void => {
    setArtifacts(prev => prev.map(artifact => {
      if (artifact.id !== artifactId || !artifact.output || typeof artifact.output !== 'object' || Array.isArray(artifact.output)) {
        return artifact
      }
      return {
        ...artifact,
        output: {
          ...artifact.output,
          operations,
        },
      }
    }))
  }

  const applyArtifact = (artifact: DesignProjectedArtifact): void => {
    const operations = extractDesignPatchOperations(artifact)
    if (operations) {
      void applyPatchArtifact(artifact, operations)
      return
    }

    setRequestedArtifactIds(prev => new Set(prev).add(artifact.id))
    const assistantMessageId = globalThis.crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      {
        id: globalThis.crypto.randomUUID(),
        role: 'user',
        content: `应用 ${artifact.title ?? artifact.id}`,
      },
      { id: assistantMessageId, role: 'assistant', content: '', runStatus: 'running' },
    ])
    runAgent(`Apply design artifact "${artifact.title ?? artifact.id}".`, {
      surface: 'design-workspace',
      action: 'apply-artifact',
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      artifact: artifact.output,
    }, assistantMessageId)
  }

  const applyPatchArtifact = async (
    artifact: DesignProjectedArtifact,
    operations: NonNullable<ReturnType<typeof extractDesignPatchOperations>>,
  ): Promise<void> => {
    const state = artifactApplyStates.get(artifact.id)

    if (state?.stage === 'previewed') {
      setArtifactApplyState(artifact.id, { ...state, stage: 'applying', error: undefined })
      const result = await agent.applyArtifactPatch({
        artifactId: artifact.id,
        operations,
        sessionId,
      }).catch((error: unknown) => ({
        runId: '',
        artifactId: artifact.id,
        status: 'failed' as const,
        error: error instanceof Error ? error.message : String(error),
      }))
      if (result.status === 'applied') {
        setArtifactApplyState(artifact.id, {
          stage: 'applied',
          preview: result.preview ?? state.preview,
        })
        appendAssistantText(`\n已应用 ${artifact.title ?? artifact.id}`)
        return
      }
      setArtifactApplyState(artifact.id, {
        stage: 'failed',
        preview: state.preview,
        error: result.error ?? 'Patch apply failed',
      })
      return
    }

    setArtifactApplyState(artifact.id, { stage: 'previewing' })
    const result = await agent.previewArtifactPatch({
      artifactId: artifact.id,
      operations,
      sessionId,
    }).catch((error: unknown) => ({
      runId: '',
      artifactId: artifact.id,
      status: 'failed' as const,
      error: error instanceof Error ? error.message : String(error),
    }))
    if (result.status === 'previewed' && result.preview) {
      setArtifactApplyState(artifact.id, {
        stage: 'previewed',
        preview: result.preview,
      })
      return
    }
    setArtifactApplyState(artifact.id, {
      stage: 'failed',
      error: result.error ?? 'Patch preview failed',
    })
  }

  const setArtifactApplyState = (artifactId: string, state: ArtifactApplyState): void => {
    setArtifactApplyStates(prev => {
      const next = new Map(prev)
      next.set(artifactId, state)
      return next
    })
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(300px,340px)_minmax(0,1fr)] bg-background">
      <aside className="flex min-h-0 flex-col border-r border-border bg-card">
        <div className="shrink-0 border-b border-border px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                {onReturnToEntry && (
                  <button
                    type="button"
                    title="Back to design entry"
                    aria-label="Back to design entry"
                    onClick={onReturnToEntry}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-surface-soft hover:text-foreground"
                  >
                    <ArrowLeft size={14} />
                  </button>
                )}
                <Sparkles size={15} className="shrink-0" />
                <span className="truncate">{sessionTitle ?? 'Design'}</span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                <Layers3 size={12} />
                <span>{String(artifacts.length)} artifacts</span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {onOpenSettings && (
                <button
                  type="button"
                  title="Design settings"
                  aria-label="Design settings"
                  onClick={onOpenSettings}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-surface-soft hover:text-foreground"
                >
                  <Settings size={14} />
                </button>
              )}
              <StatusPill status={status} />
            </div>
          </div>
        </div>
        <TraceTimeline items={traceItems} />
        <DesignSubagentPanel items={subagentItems} onCancel={cancelSubagent} />
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
        </div>
        <div className="shrink-0 border-t border-border bg-card px-3 py-3">
          <div className="rounded-md border border-border bg-background shadow-sm">
            <Textarea
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="追问或修改需求..."
              className="max-h-[140px] min-h-[74px] resize-none border-0 bg-transparent px-3 py-3 text-sm shadow-none focus-visible:ring-0"
              rows={3}
            />
            <div className="flex items-center justify-between gap-2 border-t border-border/70 px-2.5 py-2">
              <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                {status === 'running' ? <CircleDashed size={12} /> : <CheckCircle2 size={12} />}
                <span className="truncate">{statusLabel(status)}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={stopAgentRuns}
                  disabled={status !== 'running'}
                  aria-label="Stop design generation"
                  className="h-8 px-2"
                >
                  <Square size={13} />
                  停止
                </Button>
                <Button size="sm" onClick={handleSend} disabled={!input.trim()} aria-label="Send design prompt" className="h-8">
                  <SendHorizontal size={14} />
                  发送
                </Button>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col bg-surface-soft/35">
        <DesignArtifactWorkbench
          artifacts={artifacts}
          activeArtifactId={activeArtifactId}
          requestedArtifactIds={requestedArtifactIds}
          applyStates={artifactApplyStates}
          mode={artifactMode}
          selectedComponent={selectedComponent}
          onSelectArtifact={handleSelectArtifact}
          onModeChange={setArtifactMode}
          onSelectComponent={handleSelectComponent}
          onClearSelectedComponent={() => { setSelectedComponent(null) }}
          onPatchOperationsChange={handlePatchOperationsChange}
          onApplyArtifact={applyArtifact}
        />
      </section>
    </div>
  )
}

function TraceTimeline({ items }: { items: DesignTraceItem[] }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!expanded) return
    const ownerDocument = containerRef.current?.ownerDocument ?? document
    const handlePointerOutside = (event: MouseEvent | TouchEvent): void => {
      const target = event.target
      if (target instanceof Node && containerRef.current?.contains(target)) return
      setExpanded(false)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setExpanded(false)
    }
    ownerDocument.addEventListener('mousedown', handlePointerOutside)
    ownerDocument.addEventListener('touchstart', handlePointerOutside)
    ownerDocument.addEventListener('keydown', handleKeyDown)
    return () => {
      ownerDocument.removeEventListener('mousedown', handlePointerOutside)
      ownerDocument.removeEventListener('touchstart', handlePointerOutside)
      ownerDocument.removeEventListener('keydown', handleKeyDown)
    }
  }, [expanded])
  if (items.length === 0) return <></>
  const latestRunning = [...items].reverse().find(item => item.status === 'running')
  const latestItem = latestRunning ?? items.at(-1)
  const completedCount = items.filter(item => item.status === 'completed').length
  const failedCount = items.filter(item => item.status === 'failed').length

  return (
    <div ref={containerRef} className="relative z-20 shrink-0 border-b border-border bg-surface-soft/55 px-3 py-2">
      <button
        type="button"
        aria-expanded={expanded}
        aria-label="Toggle build progress"
        onClick={() => { setExpanded(current => !current) }}
        className="flex w-full items-center gap-2 rounded-md border border-border bg-background px-2.5 py-2 text-left shadow-sm transition-colors hover:bg-card"
      >
        <span className={traceStatusDotClassName(latestItem?.status ?? 'running')} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-foreground">
            {latestItem?.label ?? 'Build progress'}
          </span>
          <span className="block truncate text-[10px] text-muted-foreground">
            {traceSummary({ total: items.length, completed: completedCount, failed: failedCount, detail: latestItem?.detail })}
          </span>
        </span>
        <ChevronDown
          size={14}
          className={cn(
            'shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>
      {expanded && (
        <div className="absolute left-3 right-3 top-[calc(100%-4px)] z-50 max-h-72 overflow-y-auto rounded-md border border-border bg-background px-2 py-2 shadow-lg">
          <div className="mb-2 flex items-center justify-between border-b border-border px-1 pb-2">
            <div className="text-xs font-medium text-foreground">Build progress</div>
            <div className="text-[10px] text-muted-foreground">{String(completedCount)}/{String(items.length)} steps</div>
          </div>
          <div className="space-y-1.5">
            {items.map((item, index) => (
              <div key={item.id} className="grid grid-cols-[14px_minmax(0,1fr)] gap-2">
                <div className="flex flex-col items-center pt-1">
                  <span className={traceStatusDotClassName(item.status)} />
                  {index < items.length - 1 && <span className="mt-1 h-full min-h-4 w-px bg-border" />}
                </div>
                <div className="min-w-0 pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 truncate text-xs font-medium text-foreground">{item.label}</div>
                    <span className="shrink-0 rounded bg-surface-soft px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {statusLabel(item.status)}
                    </span>
                  </div>
                  {item.detail && (
                    <div className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
                      {item.detail}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function traceSummary({
  total,
  completed,
  failed,
  detail,
}: {
  total: number
  completed: number
  failed: number
  detail?: string
}): string {
  const parts = [`${String(completed)}/${String(total)} steps`]
  if (failed > 0) parts.push(`${String(failed)} failed`)
  if (detail) parts.push(detail)
  return parts.join(' / ')
}

function MessageBubble({ message }: { message: Message }): JSX.Element {
  const isUser = message.role === 'user'
  const content = message.role === 'assistant' && message.content.length === 0 && message.runStatus === 'running'
    ? '正在生成...'
    : message.content

  return (
    <div className={cn('flex gap-2', isUser && 'justify-end')}>
      {!isUser && (
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
          <Bot size={14} />
        </div>
      )}
      <div
        className={cn(
          'min-w-0 max-w-[88%] whitespace-pre-wrap break-words rounded-md px-3 py-2 text-sm leading-relaxed shadow-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'border border-border bg-background text-foreground',
        )}
      >
        {message.role === 'assistant' && content ? (
          <MarkdownMessage content={content} compact />
        ) : (
          content
        )}
      </div>
      {isUser && (
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <UserRound size={14} />
        </div>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: DesignRunStatus }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium',
        status === 'running' && 'border-amber-400/30 bg-amber-400/10 text-amber-700',
        status === 'completed' && 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700',
        status === 'failed' && 'border-destructive/30 bg-destructive/10 text-destructive',
        status === 'cancelled' && 'border-border bg-surface-soft text-muted-foreground',
      )}
    >
      {status === 'running' ? <CircleDashed size={12} /> : <CheckCircle2 size={12} />}
      {statusLabel(status)}
    </span>
  )
}

function statusLabel(status: DesignRunStatus): string {
  if (status === 'running') return '生成中'
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  return '已停止'
}

function findLastAssistantIndex(messages: Message[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') return index
  }
  return -1
}

function assistantCompletionMessage(title: string | undefined): string {
  return title ? `已生成「${title}」预览。` : GENERIC_COMPLETION_MESSAGE
}

function traceStatusDotClassName(status: DesignTraceItem['status']): string {
  const base = 'h-2 w-2 shrink-0 rounded-full'
  if (status === 'completed') return `${base} bg-emerald-500`
  if (status === 'failed') return `${base} bg-destructive`
  if (status === 'cancelled') return `${base} bg-muted-foreground`
  return `${base} bg-amber-500`
}

function reduceTraceItems(prev: DesignTraceItem[], event: DesignAgentStreamEvent): DesignTraceItem[] {
  const item = traceItemFromEvent(event, prev)
  if (!item) return prev
  const next = [...prev.filter(entry => entry.id !== item.id), item]
  return next.slice(-80)
}

function traceItemFromEvent(
  event: DesignAgentStreamEvent,
  prev: DesignTraceItem[],
): DesignTraceItem | null {
  if (event.type === 'run_queued') {
    return { id: `${event.runId}:queued`, label: 'Run queued', status: 'running' }
  }
  if (event.type === 'run_failed') {
    return { id: `${event.runId}:terminal`, label: 'Run failed', status: 'failed', detail: event.error }
  }
  if (event.type !== 'agent_event') return null

  const runtimeEvent = event.event
  switch (runtimeEvent.type) {
    case 'run_started':
      return { id: `${runtimeEvent.runId}:run`, label: 'Run started', status: 'running' }
    case 'run_completed':
      return {
        id: `${runtimeEvent.runId}:terminal`,
        label: 'Run completed',
        status: 'completed',
        detail: summarizeTraceOutput(runtimeEvent.output),
      }
    case 'run_failed':
      return {
        id: `${runtimeEvent.runId}:terminal`,
        label: 'Run failed',
        status: 'failed',
        detail: runtimeEvent.error.message,
      }
    case 'run_cancelled':
      return {
        id: `${runtimeEvent.runId}:terminal`,
        label: 'Run cancelled',
        status: 'cancelled',
        detail: runtimeEvent.reason,
      }
    case 'step_started':
      return {
        id: runtimeEvent.stepId,
        label: runtimeEvent.label,
        status: 'running',
      }
    case 'step_completed': {
      const existing = prev.find(item => item.id === runtimeEvent.stepId)
      return {
        id: runtimeEvent.stepId,
        label: existing?.label ?? runtimeEvent.stepId,
        status: 'completed',
        detail: summarizeTraceOutput(runtimeEvent.output),
      }
    }
    case 'child_run_started':
      return {
        id: runtimeEvent.childRunId,
        label: runtimeEvent.label ?? runtimeEvent.childRunId,
        status: 'running',
      }
    case 'child_run_completed': {
      const existing = prev.find(item => item.id === runtimeEvent.childRunId)
      return {
        id: runtimeEvent.childRunId,
        label: existing?.label ?? runtimeEvent.childRunId,
        status: 'completed',
        detail: summarizeTraceOutput(runtimeEvent.output),
      }
    }
    default:
      return null
  }
}

function summarizeTraceOutput(output: unknown): string | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined
  const record = output as Record<string, unknown>

  const artifact = record.artifact
  if (artifact && typeof artifact === 'object' && !Array.isArray(artifact)) {
    const artifactRecord = artifact as Record<string, unknown>
    const title = stringValue(artifactRecord.title)
    const kind = stringValue(artifactRecord.kind)
    return [kind, title].filter(Boolean).join(' / ') || undefined
  }

  const review = record.review
  if (review && typeof review === 'object' && !Array.isArray(review)) {
    const verdict = stringValue((review as Record<string, unknown>).verdict)
    return verdict ? `review ${verdict}` : undefined
  }

  const brief = record.brief
  if (brief && typeof brief === 'object' && !Array.isArray(brief)) {
    return truncateTraceDetail(stringValue((brief as Record<string, unknown>).summary))
  }

  const components = record.components
  if (Array.isArray(components)) {
    return `${String(components.length)} components`
  }

  const summary = stringValue(record.summary)
  if (summary) return truncateTraceDetail(summary)

  const artifactId = stringValue(record.artifactId)
  const kind = stringValue(record.kind)
  if (artifactId || kind) return [kind, artifactId].filter(Boolean).join(' / ')

  const verdict = stringValue(record.verdict)
  if (verdict) return `review ${verdict}`

  return undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function truncateTraceDetail(value: string | undefined): string | undefined {
  if (!value) return undefined
  return value.length > 72 ? `${value.slice(0, 69)}...` : value
}

function isCancelledError(error: unknown): boolean {
  return error instanceof Error && error.message === 'Cancelled'
}

function summarizeSelectedComponent(
  selectedComponent: DesignSelectedComponent | null,
  activeArtifactId: string | null,
): Record<string, unknown> | null {
  if (!selectedComponent || selectedComponent.artifactId !== activeArtifactId) return null
  return {
    id: selectedComponent.id,
    artifactId: selectedComponent.artifactId,
    label: selectedComponent.label,
    source: selectedComponent.source,
    path: selectedComponent.path,
    operationKind: selectedComponent.operationKind,
    elementTag: selectedComponent.elementTag,
    className: selectedComponent.className,
    attributes: selectedComponent.attributes,
    sourceLocation: selectedComponent.sourceLocation,
  }
}

function summarizeActiveArtifact(
  artifacts: DesignProjectedArtifact[],
  activeArtifactId: string | null,
): Record<string, unknown> | undefined {
  const artifact = artifacts.find(item => item.id === activeArtifactId) ?? artifacts.at(-1)
  if (!artifact) return undefined

  return {
    id: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    revision: revisionFromArtifact(artifact.output),
    operationPaths: operationPathsFromArtifact(artifact.output),
  }
}

function operationPathsFromArtifact(output: unknown): string[] {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return []
  const operations = (output as { operations?: unknown }).operations
  if (!Array.isArray(operations)) return []
  return operations
    .map(operation => {
      if (!operation || typeof operation !== 'object' || Array.isArray(operation)) return undefined
      const path = (operation as { path?: unknown }).path
      return typeof path === 'string' ? path : undefined
    })
    .filter((path): path is string => Boolean(path))
}

function revisionFromArtifact(output: unknown): number | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined
  const revision = (output as { revision?: unknown }).revision
  return typeof revision === 'number' ? revision : undefined
}
