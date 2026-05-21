import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Button } from '@/packages/ui/components/ui/button'
import { Textarea } from '@/packages/ui/components/ui/textarea'
import type { DesignAgentStreamEvent } from '@/apps/design/application/common'
import type { DesignProjectedArtifact } from './design-agent-projector'
import {
  DesignArtifactWorkbench,
  type ArtifactApplyState,
  type DesignSelectedComponent,
} from './DesignArtifactWorkbench'
import { extractDesignPatchOperations } from './design-artifact-view'
import { PageletDesignAgentService } from './pagelet-design-agent-service'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface DesignWorkspaceProps {
  initialPrompt: string
}

interface DesignTraceItem {
  id: string
  label: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  detail?: string
}

export function DesignWorkspace({ initialPrompt }: DesignWorkspaceProps): JSX.Element {
  const sessionId = useMemo(() => globalThis.crypto.randomUUID(), [])
  const agent = useMemo(() => new PageletDesignAgentService(), [])
  const initialRunStarted = useRef(false)
  const activeControllers = useRef<Set<AbortController>>(new Set())
  const [messages, setMessages] = useState<Message[]>([
    { role: 'user', content: initialPrompt },
    { role: 'assistant', content: '' },
  ])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<'running' | 'completed' | 'failed' | 'cancelled'>('running')
  const [artifacts, setArtifacts] = useState<DesignProjectedArtifact[]>([])
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null)
  const [artifactMode, setArtifactMode] = useState<'preview' | 'code' | 'inspect'>('preview')
  const [selectedComponent, setSelectedComponent] = useState<DesignSelectedComponent | null>(null)
  const [requestedArtifactIds, setRequestedArtifactIds] = useState<Set<string>>(() => new Set())
  const [artifactApplyStates, setArtifactApplyStates] = useState<Map<string, ArtifactApplyState>>(() => new Map())
  const [traceItems, setTraceItems] = useState<DesignTraceItem[]>([])

  const appendAssistantText = (text: string): void => {
    setMessages((prev) => {
      const next = [...prev]
      const last = next.at(-1)
      if (last?.role === 'assistant') {
        next[next.length - 1] = { ...last, content: `${last.content}${text}` }
        return next
      }
      return [...next, { role: 'assistant', content: text }]
    })
  }

  const runAgent = (prompt: string, context?: Record<string, unknown>): void => {
    const abortController = new AbortController()
    activeControllers.current.add(abortController)
    setStatus('running')
    void agent.send({
      prompt,
      sessionId,
      context,
      signal: abortController.signal,
      onStatus: nextStatus => { setStatus(nextStatus) },
      onAssistantText: appendAssistantText,
      onTraceEvent: event => {
        setTraceItems(prev => reduceTraceItems(prev, event))
      },
      onArtifact: artifact => {
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
      appendAssistantText(`\n${error instanceof Error ? error.message : String(error)}`)
    }).finally(() => {
      activeControllers.current.delete(abortController)
    })
  }

  const stopAgentRuns = (): void => {
    for (const controller of activeControllers.current) {
      controller.abort()
    }
    activeControllers.current.clear()
    setStatus('cancelled')
  }

  useEffect(() => {
    if (initialRunStarted.current) return
    initialRunStarted.current = true
    runAgent(initialPrompt, { surface: 'design-workspace', initial: true })
    return () => {
      for (const controller of activeControllers.current) {
        controller.abort()
      }
      activeControllers.current.clear()
    }
  }, [initialPrompt])

  const handleSend = () => {
    if (!input.trim()) return
    const prompt = input.trim()
    setMessages((prev) => [...prev, { role: 'user', content: prompt }, { role: 'assistant', content: '' }])
    setInput('')
    runAgent(prompt, {
      surface: 'design-workspace',
      artifactCount: artifacts.length,
      prompt,
      activeArtifact: summarizeActiveArtifact(artifacts, activeArtifactId),
      selectedComponent: summarizeSelectedComponent(selectedComponent, activeArtifactId),
    })
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
    setArtifactMode('inspect')
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
    setMessages((prev) => [
      ...prev,
      {
        role: 'user',
        content: `应用 ${artifact.title ?? artifact.id}`,
      },
      { role: 'assistant', content: '' },
    ])
    runAgent(`Apply design artifact "${artifact.title ?? artifact.id}".`, {
      surface: 'design-workspace',
      action: 'apply-artifact',
      artifactId: artifact.id,
      artifactKind: artifact.kind,
      artifact: artifact.output,
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
    <div className="flex h-full">
      <div className="flex w-[400px] shrink-0 flex-col border-r border-border">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={msg.role === 'user' ? 'flex justify-end' : ''}>
              <div
                className={
                  msg.role === 'user'
                    ? 'max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground'
                    : 'text-sm text-foreground whitespace-pre-wrap'
                }
              >
                {msg.content || (msg.role === 'assistant' && status === 'running' ? '正在生成...' : '')}
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="追问或修改需求..."
              className="min-h-[40px] max-h-[120px] resize-none text-sm"
              rows={1}
            />
            <Button size="sm" onClick={handleSend} disabled={!input.trim()}>
              发送
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={stopAgentRuns}
              disabled={status !== 'running'}
            >
              停止
            </Button>
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 shrink-0 items-center justify-end border-b border-border px-4">
            <span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
              {status}
            </span>
        </div>
        <TraceTimeline items={traceItems} />
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
      </div>
    </div>
  )
}

function TraceTimeline({ items }: { items: DesignTraceItem[] }): JSX.Element {
  if (items.length === 0) return <></>
  return (
    <div className="shrink-0 border-b border-border bg-muted/20 px-4 py-2">
      <div className="flex gap-2 overflow-x-auto">
        {items.map(item => (
          <div
            key={item.id}
            className="min-w-36 max-w-56 shrink-0 rounded-md border border-border bg-background px-2.5 py-2"
          >
            <div className="flex items-center gap-2">
              <span className={traceStatusDotClassName(item.status)} />
              <span className="min-w-0 truncate text-xs font-medium text-foreground">{item.label}</span>
            </div>
            {item.detail && (
              <div className="mt-1 truncate text-[10px] text-muted-foreground">{item.detail}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
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
