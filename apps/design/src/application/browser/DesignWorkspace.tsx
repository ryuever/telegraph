import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Button } from '@/packages/ui/components/ui/button'
import { Textarea } from '@/packages/ui/components/ui/textarea'
import type { DesignProjectedArtifact } from './design-agent-projector'
import { DesignArtifactWorkbench, type ArtifactApplyState } from './DesignArtifactWorkbench'
import { extractDesignPatchOperations } from './design-artifact-view'
import { PageletDesignAgentService } from './pagelet-design-agent-service'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface DesignWorkspaceProps {
  initialPrompt: string
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
  const [artifactMode, setArtifactMode] = useState<'preview' | 'code'>('preview')
  const [requestedArtifactIds, setRequestedArtifactIds] = useState<Set<string>>(() => new Set())
  const [artifactApplyStates, setArtifactApplyStates] = useState<Map<string, ArtifactApplyState>>(() => new Map())

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
      onArtifact: artifact => {
        setArtifacts((prev) => [...prev.filter(item => item.id !== artifact.id), artifact])
        setActiveArtifactId(artifact.id)
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
    runAgent(prompt, { surface: 'design-workspace', artifactCount: artifacts.length })
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
        <DesignArtifactWorkbench
          artifacts={artifacts}
          activeArtifactId={activeArtifactId}
          requestedArtifactIds={requestedArtifactIds}
          applyStates={artifactApplyStates}
          mode={artifactMode}
          onSelectArtifact={setActiveArtifactId}
          onModeChange={setArtifactMode}
          onApplyArtifact={applyArtifact}
        />
      </div>
    </div>
  )
}

function isCancelledError(error: unknown): boolean {
  return error instanceof Error && error.message === 'Cancelled'
}
