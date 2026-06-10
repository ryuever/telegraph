import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, JSX, KeyboardEvent, PointerEvent } from 'react'
import { ArrowLeft, Bot, CheckCircle2, ChevronDown, CircleDashed, Layers3, SendHorizontal, Sparkles, Square, UserRound } from 'lucide-react'
import type { AgentEvent } from '@/packages/agent-protocol'
import {
  AgentActivity,
  AgentActivityItem,
  AgentReasoning,
  AgentResult,
  AgentToolCall,
  type AgentActivityStatus,
  type AgentActivityTone,
} from '@/packages/ui/components/ai-elements'
import { MarkdownMessage } from '@/packages/ui/components/MarkdownMessage'
import { Button } from '@/packages/ui/components/ui/button'
import { Textarea } from '@/packages/ui/components/ui/textarea'
import { cn } from '@/packages/ui/lib/utils'
import type {
  ComponentEditDirtyOperation,
  DesignConfiguredModelDescriptorSnapshot,
  DesignAgentStreamEvent,
  DesignExportFormat,
  DesignPatchFileOperation,
} from '@/apps/design/application/common'
import { createComponentEditContext } from '@/apps/design/application/common'
import {
  upsertDesignProjectedArtifact,
  type DesignProjectedArtifact,
} from './design-agent-projector'
import {
  DesignArtifactWorkbench,
  type ArtifactApplyState,
  type DesignSelectedComponent,
} from './DesignArtifactWorkbench'
import { DesignPromptControls } from './DesignPromptControls'
import { extractDesignPatchOperations } from './design-artifact-view'
import {
  reduceDesignSubagentItems,
  type DesignSubagentViewItem,
} from './design-subagent-projector'
import {
  reduceDesignSessionLogItems,
  type DesignSessionLogItem,
} from './design-session-log-projector'
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
    traceItems?: DesignTraceItem[]
    subagentItems?: DesignSubagentViewItem[]
    sessionLogItems?: DesignSessionLogItem[]
  }

export interface DesignWorkspaceInitialState {
  messages: Message[]
  status: DesignRunStatus
  artifacts: DesignProjectedArtifact[]
  activeArtifactId?: string | null
  traceEvents?: AgentEvent[]
  subagentItems?: DesignSubagentViewItem[]
}

interface DesignWorkspaceProps {
  initialPrompt: string
  sessionId?: string
  sessionTitle?: string
  initialState?: DesignWorkspaceInitialState
  isActive?: boolean
  onOpenSettings?: () => void
  configuredModels?: DesignConfiguredModelDescriptorSnapshot[]
  selectedProvider?: string
  selectedModelId?: string
  onModelSelect?: (provider: string, modelId: string) => void
  modelReady?: boolean
  modelsLoading?: boolean
  onReturnToEntry?: () => void
  onSessionUpdate?: (sessionId: string, summary: DesignWorkspaceSummary) => void
}

export interface DesignTraceItem {
  id: string
  label: string
  status: DesignRunStatus
  detail?: string
}

const GENERIC_COMPLETION_MESSAGE = '已完成。'
const OPERATION_CONTENT_PREVIEW_LIMIT = 320
const DEFAULT_AGENT_LOG_PANEL_WIDTH = 392
const MIN_AGENT_LOG_PANEL_WIDTH = 320
const MAX_AGENT_LOG_PANEL_WIDTH = 560
const ASSISTANT_TEXT_FLUSH_MS = 50

export function DesignWorkspace({
  initialPrompt,
  sessionId: providedSessionId,
  sessionTitle,
  initialState,
  isActive = true,
  onOpenSettings,
  configuredModels = [],
  selectedProvider,
  selectedModelId,
  onModelSelect,
  modelReady = false,
  modelsLoading = false,
  onReturnToEntry,
  onSessionUpdate,
}: DesignWorkspaceProps): JSX.Element {
  const sessionId = useMemo(() => providedSessionId ?? globalThis.crypto.randomUUID(), [providedSessionId])
  const initialUserMessageId = useMemo(() => globalThis.crypto.randomUUID(), [])
  const initialAssistantMessageId = useMemo(() => globalThis.crypto.randomUUID(), [])
  const agent = useMemo(() => new PageletDesignAgentService(), [])
  const initialRunStarted = useRef(Boolean(initialState))
  const activeControllers = useRef<Map<string, AbortController>>(new Map())
  const pendingAssistantText = useRef<Map<string, string>>(new Map())
  const assistantTextFlushTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const assistantArtifactTitles = useRef<Map<string, string>>(new Map())
  const artifactOperationBaselines = useRef<Map<string, DesignPatchFileOperation[]>>(new Map())
  const agentLogResizeStartRef = useRef({ pointerX: 0, width: DEFAULT_AGENT_LOG_PANEL_WIDTH })
  const [messages, setMessages] = useState<Message[]>(() => initialState?.messages ?? [
    { id: initialUserMessageId, role: 'user', content: initialPrompt },
    { id: initialAssistantMessageId, role: 'assistant', content: '', runStatus: 'running' },
  ])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<DesignRunStatus>(() => initialState?.status ?? 'running')
  const [artifacts, setArtifacts] = useState<DesignProjectedArtifact[]>(() => initialState?.artifacts ?? [])
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(() => initialState?.activeArtifactId ?? null)
  const [artifactMode, setArtifactMode] = useState<'preview' | 'code' | 'inspect'>('preview')
  const [selectedComponent, setSelectedComponent] = useState<DesignSelectedComponent | null>(null)
  const [dirtyArtifactOperations, setDirtyArtifactOperations] = useState<Map<string, DesignPatchFileOperation[]>>(() => new Map())
  const [requestedArtifactIds, setRequestedArtifactIds] = useState<Set<string>>(() => new Set())
  const [artifactApplyStates, setArtifactApplyStates] = useState<Map<string, ArtifactApplyState>>(() => new Map())
  const [agentLogPanelWidth, setAgentLogPanelWidth] = useState(DEFAULT_AGENT_LOG_PANEL_WIDTH)
  const [agentLogResizing, setAgentLogResizing] = useState(false)
  const headerSubagentItems = useMemo(() => flattenMessageSubagents(messages), [messages])

  const appendAssistantTextNow = (text: string, messageId?: string): void => {
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

  const flushAssistantText = (messageId: string): void => {
    const text = pendingAssistantText.current.get(messageId)
    if (!text) return
    pendingAssistantText.current.delete(messageId)
    const timer = assistantTextFlushTimers.current.get(messageId)
    if (timer) {
      clearTimeout(timer)
      assistantTextFlushTimers.current.delete(messageId)
    }
    appendAssistantTextNow(text, messageId)
  }

  const flushAllAssistantText = (): void => {
    for (const messageId of pendingAssistantText.current.keys()) {
      flushAssistantText(messageId)
    }
  }

  const appendAssistantText = (text: string, messageId?: string): void => {
    if (!messageId) {
      appendAssistantTextNow(text)
      return
    }
    pendingAssistantText.current.set(messageId, `${pendingAssistantText.current.get(messageId) ?? ''}${text}`)
    if (assistantTextFlushTimers.current.has(messageId)) return
    const timer = setTimeout(() => {
      assistantTextFlushTimers.current.delete(messageId)
      flushAssistantText(messageId)
    }, ASSISTANT_TEXT_FLUSH_MS)
    assistantTextFlushTimers.current.set(messageId, timer)
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

  const updateAssistantRunDetails = (
    messageId: string,
    update: (message: Extract<Message, { role: 'assistant' }>) => Partial<Extract<Message, { role: 'assistant' }>>,
  ): void => {
    setMessages(prev => prev.map(message => {
      if (message.role !== 'assistant' || message.id !== messageId) return message
      return { ...message, ...update(message) }
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
        flushAssistantText(assistantMessageId)
        setStatus(nextStatus)
        setAssistantRunStatus(assistantMessageId, nextStatus)
      },
      onAssistantText: text => { appendAssistantText(text, assistantMessageId) },
      onTraceEvent: event => {
        if (isHighFrequencyTraceEvent(event)) return
        updateAssistantRunDetails(assistantMessageId, message => ({
          traceItems: reduceTraceItems(message.traceItems ?? [], event),
          sessionLogItems: reduceDesignSessionLogItems(message.sessionLogItems ?? [], event),
          subagentItems: event.type === 'agent_event'
            ? reduceDesignSubagentItems(message.subagentItems ?? [], event)
            : message.subagentItems ?? [],
        }))
      },
      onSubagent: subagent => {
        const event: DesignAgentStreamEvent = {
          type: 'subagent_updated',
          runId: subagent.parentRunId,
          subagent,
        }
        updateAssistantRunDetails(assistantMessageId, message => ({
          subagentItems: reduceDesignSubagentItems(message.subagentItems ?? [], event),
          sessionLogItems: reduceDesignSessionLogItems(message.sessionLogItems ?? [], event),
        }))
      },
      onArtifact: artifact => {
        let committedArtifact = artifact
        setArtifacts((prev) => {
          const next = upsertDesignProjectedArtifact(prev, artifact)
          committedArtifact = next.find(item => item.id === artifact.id) ?? artifact
          artifactOperationBaselines.current.set(committedArtifact.id, extractDesignPatchOperations(committedArtifact) ?? [])
          return next
        })
        rememberAssistantArtifact(assistantMessageId, committedArtifact)
        setDirtyArtifactOperations((prev) => {
          if (!prev.has(artifact.id)) return prev
          const next = new Map(prev)
          next.delete(artifact.id)
          return next
        })
        setActiveArtifactId(artifact.id)
        setSelectedComponent(null)
      },
    }).catch((error: unknown) => {
      if (isCancelledError(error)) {
        flushAssistantText(assistantMessageId)
        setStatus('cancelled')
        return
      }
      flushAssistantText(assistantMessageId)
      setStatus('failed')
      setAssistantRunStatus(assistantMessageId, 'failed')
      appendAssistantText(`\n${error instanceof Error ? error.message : String(error)}`, assistantMessageId)
    }).finally(() => {
      flushAssistantText(assistantMessageId)
      activeControllers.current.delete(assistantMessageId)
    })
  }

  const stopAgentRuns = (): void => {
    flushAllAssistantText()
    for (const [messageId, controller] of activeControllers.current) {
      controller.abort()
      setAssistantRunStatus(messageId, 'cancelled')
    }
    activeControllers.current.clear()
    setStatus('cancelled')
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
      for (const timer of assistantTextFlushTimers.current.values()) {
        clearTimeout(timer)
      }
      assistantTextFlushTimers.current.clear()
      pendingAssistantText.current.clear()
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
    if (!input.trim() || !modelReady) return
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
      componentEdit: summarizeComponentEditContext({
        artifacts,
        activeArtifactId,
        selectedComponent,
        dirtyOperations: activeArtifactId ? dirtyArtifactOperations.get(activeArtifactId) : undefined,
        prompt,
      }),
    }, assistantMessageId)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    setInput(e.target.value)
  }

  const handleAgentLogResizePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    agentLogResizeStartRef.current = {
      pointerX: event.clientX,
      width: agentLogPanelWidth,
    }
    setAgentLogResizing(true)
  }

  const handleAgentLogResizePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!agentLogResizing) return
    const delta = event.clientX - agentLogResizeStartRef.current.pointerX
    setAgentLogPanelWidth(clampAgentLogPanelWidth(agentLogResizeStartRef.current.width + delta))
  }

  const handleAgentLogResizePointerEnd = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setAgentLogResizing(false)
  }

  const handleAgentLogResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setAgentLogPanelWidth(current => clampAgentLogPanelWidth(current - (event.shiftKey ? 40 : 16)))
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      setAgentLogPanelWidth(current => clampAgentLogPanelWidth(current + (event.shiftKey ? 40 : 16)))
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      setAgentLogPanelWidth(MIN_AGENT_LOG_PANEL_WIDTH)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      setAgentLogPanelWidth(MAX_AGENT_LOG_PANEL_WIDTH)
    }
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
    const currentArtifact = artifacts.find(artifact => artifact.id === artifactId)
    const baseline = artifactOperationBaselines.current.get(artifactId) ??
      (currentArtifact ? extractDesignPatchOperations(currentArtifact) : undefined) ??
      []
    if (!artifactOperationBaselines.current.has(artifactId)) {
      artifactOperationBaselines.current.set(artifactId, baseline)
    }
    const changedOperations = changedPatchOperations(baseline, operations)
    setDirtyArtifactOperations(prev => {
      const next = new Map(prev)
      if (changedOperations.length > 0) {
        next.set(artifactId, changedOperations)
      } else {
        next.delete(artifactId)
      }
      return next
    })
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

  const exportArtifact = (artifact: DesignProjectedArtifact, format: DesignExportFormat): void => {
    const assistantMessageId = globalThis.crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      {
        id: globalThis.crypto.randomUUID(),
        role: 'user',
        content: `导出 ${artifact.title ?? artifact.id} 为 ${format}`,
      },
      { id: assistantMessageId, role: 'assistant', content: '', runStatus: 'running' },
    ])
    setAssistantRunStatus(assistantMessageId, 'running')
    void agent.exportArtifact({
      artifactId: artifact.id,
      artifact: artifact.output,
      formats: [format],
      sessionId,
    }).then(result => {
      if (result.status !== 'exported' || !result.artifact) {
        throw new Error(result.error ?? 'Export failed')
      }
      const projected: DesignProjectedArtifact = {
        id: result.artifact.id,
        kind: result.artifact.kind,
        title: result.artifact.title,
        output: result.artifact,
        sourceEventType: 'tool_result',
      }
      setArtifacts(prev => upsertDesignProjectedArtifact(prev, projected))
      setActiveArtifactId(projected.id)
      rememberAssistantArtifact(assistantMessageId, projected)
      appendAssistantText(`已导出 ${format}。`, assistantMessageId)
      flushAssistantText(assistantMessageId)
      setAssistantRunStatus(assistantMessageId, 'completed')
    }).catch((error: unknown) => {
      appendAssistantText(`导出失败：${error instanceof Error ? error.message : String(error)}`, assistantMessageId)
      flushAssistantText(assistantMessageId)
      setAssistantRunStatus(assistantMessageId, 'failed')
    })
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
    <div className="flex h-full min-h-0 bg-background">
      <aside
        className={cn(
          'relative flex min-h-0 shrink-0 flex-col border-r border-border bg-card',
          agentLogResizing ? 'transition-none' : 'transition-[width] duration-200',
        )}
        style={{ width: agentLogPanelWidth }}
      >
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
                <SubagentsHeaderDropdown items={headerSubagentItems} />
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <StatusPill status={status} />
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.map((message) => (
            <Fragment key={message.id}>
              <MessageBubble message={message} />
              {message.role === 'assistant' && (
                <AssistantRunFeed message={message} />
              )}
            </Fragment>
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
              <div className="flex min-w-0 items-center gap-2">
                <DesignPromptControls
                  configuredModels={configuredModels}
                  provider={selectedProvider}
                  modelId={selectedModelId}
                  onModelSelect={onModelSelect}
                  onOpenSettings={onOpenSettings}
                  loading={modelsLoading}
                  compact
                />
                <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                  {status === 'running' ? <CircleDashed size={12} /> : <CheckCircle2 size={12} />}
                  <span className="truncate">{statusLabel(status)}</span>
                </div>
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
                <Button
                  size="sm"
                  onClick={handleSend}
                  disabled={!input.trim() || !modelReady}
                  title={modelReady ? 'Send design prompt' : 'Configure a provider model in Settings / Providers'}
                  aria-label="Send design prompt"
                  className="h-8"
                >
                  <SendHorizontal size={14} />
                  发送
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize design agent log"
          aria-valuemin={MIN_AGENT_LOG_PANEL_WIDTH}
          aria-valuemax={MAX_AGENT_LOG_PANEL_WIDTH}
          aria-valuenow={agentLogPanelWidth}
          tabIndex={0}
          onPointerDown={handleAgentLogResizePointerDown}
          onPointerMove={handleAgentLogResizePointerMove}
          onPointerUp={handleAgentLogResizePointerEnd}
          onPointerCancel={handleAgentLogResizePointerEnd}
          onDoubleClick={() => { setAgentLogPanelWidth(DEFAULT_AGENT_LOG_PANEL_WIDTH) }}
          onKeyDown={handleAgentLogResizeKeyDown}
          className={cn(
            'absolute -right-1 top-0 z-20 h-full w-2 cursor-col-resize touch-none outline-none',
            'after:absolute after:left-1/2 after:top-0 after:h-full after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors',
            'hover:after:bg-primary/45 focus-visible:after:bg-primary/70',
            agentLogResizing && 'after:bg-primary',
          )}
        />
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-soft/35">
        <DesignArtifactWorkbench
          artifacts={artifacts}
          activeArtifactId={activeArtifactId}
          requestedArtifactIds={requestedArtifactIds}
          applyStates={artifactApplyStates}
          isActive={isActive}
          mode={artifactMode}
          selectedComponent={selectedComponent}
          dirtyOperationCount={activeArtifactId ? dirtyArtifactOperations.get(activeArtifactId)?.length ?? 0 : 0}
          onSelectArtifact={handleSelectArtifact}
          onModeChange={setArtifactMode}
          onSelectComponent={handleSelectComponent}
          onClearSelectedComponent={() => { setSelectedComponent(null) }}
          onPatchOperationsChange={handlePatchOperationsChange}
          onExportArtifact={exportArtifact}
          onApplyArtifact={applyArtifact}
        />
      </section>
    </div>
  )
}

function clampAgentLogPanelWidth(width: number): number {
  return Math.min(MAX_AGENT_LOG_PANEL_WIDTH, Math.max(MIN_AGENT_LOG_PANEL_WIDTH, Math.round(width)))
}

function changedPatchOperations(
  baseline: DesignPatchFileOperation[],
  nextOperations: DesignPatchFileOperation[],
): DesignPatchFileOperation[] {
  const baselineByPath = new Map(baseline.map(operation => [operation.path, operation]))
  return nextOperations.filter(operation => {
    const previous = baselineByPath.get(operation.path)
    if (!previous) return true
    return previous.kind !== operation.kind ||
      previous.content !== operation.content ||
      previous.expectedOriginal !== operation.expectedOriginal
  })
}

function SubagentsHeaderDropdown({ items }: { items: DesignSubagentViewItem[] }): JSX.Element {
  const activeCount = items.filter(item => item.status === 'queued' || item.status === 'running').length
  const failedCount = items.filter(item => item.status === 'error').length

  return (
    <details className="group relative">
      <summary className="flex h-5 cursor-pointer list-none items-center gap-1 rounded-md bg-surface-soft px-1.5 text-[10px] text-muted-foreground transition-colors marker:hidden hover:bg-background hover:text-foreground">
        <Bot size={10} />
        <span>{String(items.length)} subagents</span>
        <ChevronDown size={10} className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute left-0 top-6 z-50 w-72 rounded-md border border-border bg-background p-2 shadow-lg">
        <div className="mb-2 flex items-center justify-between gap-2 border-b border-border pb-2">
          <div className="text-[11px] font-medium text-foreground">Subagents</div>
          <div className="text-[10px] text-muted-foreground">
            {String(activeCount)} active{failedCount > 0 ? ` / ${String(failedCount)} failed` : ''}
          </div>
        </div>
        {items.length === 0 ? (
          <div className="px-1 py-2 text-[11px] text-muted-foreground">No subagents yet</div>
        ) : (
          <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
            {items.map(item => (
              <div key={item.id} className="grid grid-cols-[10px_minmax(0,1fr)_auto] gap-2 rounded-md bg-surface-soft/55 px-2 py-1.5">
                <span className={subagentStatusDotClassName(item.status)} />
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-medium text-foreground">{item.label}</div>
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {item.detail ?? item.task ?? item.profileId ?? item.id}
                  </div>
                </div>
                <span className="rounded bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {subagentStatusLabel(item.status)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  )
}

function AssistantRunFeed({
  message,
}: {
  message: Extract<Message, { role: 'assistant' }>
}): JSX.Element {
  const sessionLogItems = message.sessionLogItems ?? []

  if (sessionLogItems.length === 0) return <></>

  return (
    <div className="flex gap-2">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
        <Bot size={14} />
      </div>
      <AgentActivity density="compact" className="min-w-0 max-w-[88%] flex-1">
        {coalesceSessionLogItems(sessionLogItems).map(item => (
          <DesignSessionActivityItem key={item.id} item={item} />
        ))}
      </AgentActivity>
    </div>
  )
}

type DesignSessionActivityEntry =
  | { type: 'single'; id: string; item: DesignSessionLogItem }
  | {
    type: 'tool'
    id: string
    toolName: string
    status: AgentActivityStatus
    call?: DesignSessionLogItem
    result?: DesignSessionLogItem
    error?: DesignSessionLogItem
  }
  | {
    type: 'diagnostic'
    id: string
    runId?: string
    status: AgentActivityStatus
    count: number
    detail?: string
  }

function DesignSessionActivityItem({ item }: { item: DesignSessionActivityEntry }): JSX.Element {
  if (item.type === 'tool') {
    const detail = item.error?.fullDetail ??
      item.error?.detail ??
      item.result?.fullDetail ??
      item.result?.detail ??
      item.call?.fullDetail ??
      item.call?.detail
    const hasToolDetail = Boolean(item.call?.detail || item.result?.detail || item.error?.detail)

    return (
      <AgentToolCall
        toolName={item.toolName}
        title={toolActivityTitle(item)}
        status={item.status}
        input={item.call?.detail}
        output={item.result?.detail}
        error={item.error?.detail}
        defaultOpen={hasToolDetail || item.status === 'running' || item.status === 'error'}
      >
        {detail && detail !== item.call?.detail && detail !== item.result?.detail && detail !== item.error?.detail ? (
          <SessionActivityDetail detail={detail} />
        ) : undefined}
      </AgentToolCall>
    )
  }

  if (item.type === 'diagnostic') {
    return (
      <AgentActivityItem
        title="Runtime activity"
        subtitle={`${String(item.count)} events`}
        tone="model"
        status={item.status}
        meta={item.runId ? [{ label: 'run', value: shortId(item.runId) }] : undefined}
        defaultOpen={item.status === 'error' || item.status === 'cancelled'}
      >
        {item.detail ? <SessionActivityDetail detail={item.detail} /> : undefined}
      </AgentActivityItem>
    )
  }

  const logItem = item.item
  if (logItem.label === 'Thinking') {
    return (
      <AgentReasoning
        title="Thinking"
        status={agentStatusFromSessionLog(logItem.status)}
        subtitle={logItem.kind}
        summary={logItem.detail}
        defaultOpen={logItem.status === 'running'}
      >
        {logItem.fullDetail && logItem.fullDetail !== logItem.detail ? (
          <SessionActivityDetail detail={logItem.fullDetail} />
        ) : undefined}
      </AgentReasoning>
    )
  }

  if (logItem.kind === 'artifact' || logItem.kind === 'review' || logItem.kind === 'snapshot') {
    return (
      <AgentResult
        title={logItem.label}
        status={agentStatusFromSessionLog(logItem.status)}
        subtitle={logItem.kind}
        description={logItem.detail}
        defaultOpen={Boolean(logItem.detail || logItem.fullDetail) || logItem.status === 'failed'}
      >
        {logItem.fullDetail && logItem.fullDetail !== logItem.detail ? (
          <SessionActivityDetail detail={logItem.fullDetail} />
        ) : undefined}
      </AgentResult>
    )
  }

  const detail = logItem.fullDetail ?? logItem.detail
  return (
    <AgentActivityItem
      title={logItem.label}
      subtitle={logItem.kind}
      tone={agentToneFromSessionLog(logItem.kind)}
      status={agentStatusFromSessionLog(logItem.status)}
      meta={sessionLogMeta(logItem)}
      defaultOpen={Boolean(detail) || logItem.status === 'running' || logItem.status === 'failed'}
    >
      {detail ? <SessionActivityDetail detail={detail} /> : undefined}
    </AgentActivityItem>
  )
}

function SessionActivityDetail({ detail }: { detail: string }): JSX.Element {
  return (
    <div className="whitespace-pre-wrap break-words text-[11.5px] leading-relaxed text-muted-foreground">
      {detail}
    </div>
  )
}

const MAX_DIAGNOSTIC_DETAIL_LINES = 10

function coalesceSessionLogItems(items: DesignSessionLogItem[]): DesignSessionActivityEntry[] {
  const toolEntries = new Map<string, Extract<DesignSessionActivityEntry, { type: 'tool' }>>()
  const diagnosticEntries = new Map<string, Extract<DesignSessionActivityEntry, { type: 'diagnostic' }>>()
  const subagentEntryIndexes = new Map<string, number>()
  const entries: DesignSessionActivityEntry[] = []

  for (const item of items) {
    const diagnostic = diagnosticEntryFromSessionLogItem(item, diagnosticEntries.get(diagnosticKeyFromSessionLogItem(item)))
    if (diagnostic) {
      const existing = diagnosticEntries.get(diagnostic.id)
      diagnosticEntries.set(diagnostic.id, diagnostic)
      if (existing) {
        const entryIndex = entries.findIndex(entry => entry.id === diagnostic.id)
        if (entryIndex >= 0) entries[entryIndex] = diagnostic
      } else {
        entries.push(diagnostic)
      }
      continue
    }

    const tool = toolEntryFromSessionLogItem(item)
    if (!tool) {
      const subagentKey = subagentMergeKey(item)
      if (subagentKey) {
        const existingIndex = subagentEntryIndexes.get(subagentKey)
        if (existingIndex !== undefined) {
          entries[existingIndex] = mergeSubagentEntry(entries[existingIndex], item)
          continue
        }
        subagentEntryIndexes.set(subagentKey, entries.length)
      }
      entries.push({ type: 'single', id: item.id, item })
      continue
    }

    const existing = toolEntries.get(tool.id)
    if (existing) {
      const next = mergeToolEntry(existing, tool)
      toolEntries.set(tool.id, next)
      const entryIndex = entries.findIndex(entry => entry.id === tool.id)
      if (entryIndex >= 0) entries[entryIndex] = next
      continue
    }

    toolEntries.set(tool.id, tool)
    entries.push(tool)
  }

  return entries
}

function diagnosticKeyFromSessionLogItem(item: DesignSessionLogItem): string {
  return `${item.runId ?? 'run'}:diagnostic`
}

function diagnosticEntryFromSessionLogItem(
  item: DesignSessionLogItem,
  previous: Extract<DesignSessionActivityEntry, { type: 'diagnostic' }> | undefined,
): Extract<DesignSessionActivityEntry, { type: 'diagnostic' }> | null {
  if (!isDiagnosticSessionLogItem(item)) return null
  const runId = item.runId ?? previous?.runId
  return {
    type: 'diagnostic',
    id: diagnosticKeyFromSessionLogItem(item),
    runId,
    status: aggregateDiagnosticStatus(previous?.status, item),
    count: (previous?.count ?? 0) + 1,
    detail: compactDiagnosticDetail(previous?.detail, item),
  }
}

function isDiagnosticSessionLogItem(item: DesignSessionLogItem): boolean {
  if (item.kind === 'run' || item.kind === 'snapshot') return true
  return item.kind === 'model' && item.label !== 'Thinking'
}

function compactSessionLogLine(item: DesignSessionLogItem): string {
  return [item.label, item.detail].filter(Boolean).join(': ')
}

function compactDiagnosticDetail(previousDetail: string | undefined, item: DesignSessionLogItem): string {
  return [
    ...(previousDetail ? previousDetail.split('\n') : []),
    compactSessionLogLine(item),
  ]
    .filter(Boolean)
    .slice(-MAX_DIAGNOSTIC_DETAIL_LINES)
    .join('\n')
}

function aggregateDiagnosticStatus(
  current: AgentActivityStatus | undefined,
  item: DesignSessionLogItem,
): AgentActivityStatus {
  const next = agentStatusFromSessionLog(item.status)
  if (current === 'error' || next === 'error') return 'error'
  if (current === 'cancelled' || next === 'cancelled') return 'cancelled'
  if (item.kind === 'run') return next
  if (item.kind === 'snapshot') return 'complete'
  return current ?? 'complete'
}

function subagentMergeKey(item: DesignSessionLogItem): string | undefined {
  if (!item.childRunId) return undefined
  if (item.kind !== 'subagent' && item.kind !== 'review') return undefined
  return item.childRunId
}

function mergeSubagentEntry(entry: DesignSessionActivityEntry, item: DesignSessionLogItem): DesignSessionActivityEntry {
  if (entry.type !== 'single') return entry
  const previous = entry.item
  const preferred = preferSubagentDisplayItem(previous, item)
  const fallback = preferred === item ? previous : item
  return {
    type: 'single',
    id: preferred.id,
    item: {
      ...preferred,
      detail: preferred.detail ?? fallback.detail,
      fullDetail: preferred.fullDetail ?? fallback.fullDetail,
    },
  }
}

function preferSubagentDisplayItem(previous: DesignSessionLogItem, next: DesignSessionLogItem): DesignSessionLogItem {
  if (isSubagentSnapshotLogItem(next) && !isSubagentSnapshotLogItem(previous)) return previous
  if (!isSubagentSnapshotLogItem(next) && isSubagentSnapshotLogItem(previous)) return next
  return isTerminalSessionLogStatus(next.status) ? next : previous
}

function isSubagentSnapshotLogItem(item: DesignSessionLogItem): boolean {
  return item.id.startsWith('subagent:')
}

function isTerminalSessionLogStatus(status: DesignSessionLogItem['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function toolEntryFromSessionLogItem(
  item: DesignSessionLogItem,
): Extract<DesignSessionActivityEntry, { type: 'tool' }> | null {
  if (item.kind !== 'tool') return null
  const callId = toolCallIdFromSessionLogItem(item)
  const toolName = toolNameFromSessionLogLabel(item.label)
  if (!callId || !toolName) return null
  const base = {
    type: 'tool' as const,
    id: `${item.runId ?? 'run'}:tool:${callId}`,
    toolName,
    status: 'running' as AgentActivityStatus,
  }
  if (item.label.startsWith('Tool result:')) return { ...base, status: 'complete', result: item }
  if (item.label.startsWith('Tool error:')) return { ...base, status: 'error', error: item }
  return { ...base, call: item }
}

function mergeToolEntry(
  previous: Extract<DesignSessionActivityEntry, { type: 'tool' }>,
  next: Extract<DesignSessionActivityEntry, { type: 'tool' }>,
): Extract<DesignSessionActivityEntry, { type: 'tool' }> {
  const error = next.error ?? previous.error
  const result = next.result ?? previous.result
  return {
    ...previous,
    call: next.call ?? previous.call,
    result,
    error,
    status: error ? 'error' : result ? 'complete' : next.status,
  }
}

function toolCallIdFromSessionLogItem(item: DesignSessionLogItem): string | undefined {
  const match = /:tool-(?:call|result|error):(.+)$/.exec(item.id)
  return match?.[1]
}

function toolNameFromSessionLogLabel(label: string): string | undefined {
  const match = /^Tool (?:call|result|error):\s*(.+)$/.exec(label)
  return match?.[1]
}

function toolActivityTitle(item: Extract<DesignSessionActivityEntry, { type: 'tool' }>): string {
  if (item.status === 'error') return 'Tool failed'
  if (item.status === 'complete') return 'Used tool'
  return 'Using tool'
}

function agentStatusFromSessionLog(status: DesignSessionLogItem['status']): AgentActivityStatus {
  if (status === 'running') return 'running'
  if (status === 'completed') return 'complete'
  if (status === 'failed') return 'error'
  if (status === 'cancelled') return 'cancelled'
  return 'complete'
}

function agentToneFromSessionLog(kind: DesignSessionLogItem['kind']): AgentActivityTone {
  switch (kind) {
    case 'model':
      return 'model'
    case 'tool':
      return 'tool'
    case 'artifact':
    case 'review':
    case 'snapshot':
      return 'result'
    case 'step':
    case 'run':
    case 'subagent':
      return 'workflow'
  }
}

function sessionLogMeta(item: DesignSessionLogItem): Array<{ label: string; value: string }> | undefined {
  const meta = [
    item.runId ? { label: 'run', value: shortId(item.runId) } : undefined,
    item.childRunId ? { label: 'child', value: shortId(item.childRunId) } : undefined,
  ].filter((entry): entry is { label: string; value: string } => Boolean(entry))

  return meta.length > 0 ? meta : undefined
}

function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 10)}...` : id
}

function MessageBubble({
  message,
}: {
  message: Message
}): JSX.Element {
  const isUser = message.role === 'user'
  const hasAssistantActivity = message.role === 'assistant' && (message.sessionLogItems?.length ?? 0) > 0
  if (message.role === 'assistant' && message.content.length === 0 && message.runStatus === 'running' && hasAssistantActivity) {
    return <></>
  }

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
          'min-w-0 max-w-[88%] break-words rounded-md px-3 py-2 text-sm leading-relaxed shadow-sm',
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'border border-border bg-background text-foreground',
        )}
      >
        <div className="whitespace-pre-wrap">
          {message.role === 'assistant' && content ? (
            <MarkdownMessage content={content} compact />
          ) : (
            content
          )}
        </div>
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

function subagentStatusDotClassName(status: DesignSubagentViewItem['status']): string {
  return cn(
    'mt-1 h-2 w-2 shrink-0 rounded-full',
    status === 'completed' && 'bg-emerald-500',
    status === 'error' && 'bg-destructive',
    status === 'stopped' && 'bg-muted-foreground',
    status === 'queued' && 'bg-sky-500',
    status === 'running' && 'bg-amber-500',
  )
}

function subagentStatusLabel(status: DesignSubagentViewItem['status']): string {
  if (status === 'queued') return '排队'
  if (status === 'running') return '运行中'
  if (status === 'completed') return '完成'
  if (status === 'error') return '失败'
  return '停止'
}

function flattenMessageSubagents(messages: Message[]): DesignSubagentViewItem[] {
  const byId = new Map<string, DesignSubagentViewItem>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const item of message.subagentItems ?? []) {
      byId.set(item.id, item)
    }
  }
  return Array.from(byId.values())
}

function reduceTraceItems(prev: DesignTraceItem[], event: DesignAgentStreamEvent): DesignTraceItem[] {
  const item = traceItemFromEvent(event, prev)
  if (!item) return prev
  const next = [...prev.filter(entry => entry.id !== item.id), item]
  return next.slice(-80)
}

function isHighFrequencyTraceEvent(event: DesignAgentStreamEvent): boolean {
  return event.type === 'agent_event' && (
    event.event.type === 'assistant_delta' ||
    event.event.type === 'model_event'
  )
}

export function initialDesignTraceItemsFromEvents(events: AgentEvent[], fallbackRunId: string): DesignTraceItem[] {
  return events.reduce<DesignTraceItem[]>((items, event) =>
    reduceTraceItems(items, {
      type: 'agent_event',
      runId: eventRunId(event) ?? fallbackRunId,
      event,
    }), [])
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

function eventRunId(event: AgentEvent): string | undefined {
  if ('runId' in event && typeof event.runId === 'string') return event.runId
  if ('parentRunId' in event && typeof event.parentRunId === 'string') return event.parentRunId
  return undefined
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

function summarizeComponentEditContext(input: {
  artifacts: DesignProjectedArtifact[]
  activeArtifactId: string | null
  selectedComponent: DesignSelectedComponent | null
  dirtyOperations?: DesignPatchFileOperation[]
  prompt: string
}): Record<string, unknown> | undefined {
  const artifact = input.artifacts.find(item => item.id === input.activeArtifactId) ?? input.artifacts.at(-1)
  if (!artifact) return undefined
  const selected = input.selectedComponent?.artifactId === artifact.id ? input.selectedComponent : null
  const dirtyOperations = input.dirtyOperations ?? []
  if (!selected && dirtyOperations.length === 0) return undefined
  const operations = extractDesignPatchOperations(artifact) ?? []

  return createComponentEditContext({
    artifactId: artifact.id,
    parentArtifactId: parentArtifactIdFromArtifact(artifact.output),
    revision: revisionFromArtifact(artifact.output),
    prompt: input.prompt,
    target: selected,
    artifactOperationPaths: operations.map(operation => operation.path),
    dirtyOperations: summarizeDirtyOperations(dirtyOperations),
  }) as unknown as Record<string, unknown>
}

function summarizeActiveArtifact(
  artifacts: DesignProjectedArtifact[],
  activeArtifactId: string | null,
): Record<string, unknown> | undefined {
  const artifact = artifacts.find(item => item.id === activeArtifactId) ?? artifacts.at(-1)
  if (!artifact) return undefined
  const operations = extractDesignPatchOperations(artifact) ?? []

  return {
    id: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    revision: revisionFromArtifact(artifact.output),
    operationPaths: operations.map(operation => operation.path),
    operationSummaries: summarizePatchOperations(operations),
  }
}

function summarizeDirtyOperations(
  operations: DesignPatchFileOperation[],
): ComponentEditDirtyOperation[] {
  return operations.map(operation => ({
    kind: operation.kind,
    path: operation.path,
    source: 'style-editor',
    contentLength: operation.content?.length,
    contentPreview: truncateOperationContent(operation.content),
    expectedOriginalLength: operation.expectedOriginal?.length,
  }))
}

function summarizePatchOperations(
  operations: DesignPatchFileOperation[],
): Array<Record<string, unknown>> {
  return operations
    .map(operation => ({
      kind: operation.kind,
      path: operation.path,
      content: operation.content,
      contentLength: operation.content?.length,
      contentPreview: truncateOperationContent(operation.content),
      expectedOriginal: operation.expectedOriginal,
      expectedOriginalLength: operation.expectedOriginal?.length,
    }))
}

function truncateOperationContent(value: string | undefined): string | undefined {
  if (!value) return undefined
  return value.length > OPERATION_CONTENT_PREVIEW_LIMIT
    ? `${value.slice(0, OPERATION_CONTENT_PREVIEW_LIMIT)}...`
    : value
}

function revisionFromArtifact(output: unknown): number | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined
  const revision = (output as { revision?: unknown }).revision
  return typeof revision === 'number' ? revision : undefined
}

function parentArtifactIdFromArtifact(output: unknown): string | undefined {
  if (!output || typeof output !== 'object' || Array.isArray(output)) return undefined
  const parentArtifactId = (output as { parentArtifactId?: unknown }).parentArtifactId
  return typeof parentArtifactId === 'string' ? parentArtifactId : undefined
}
