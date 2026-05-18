import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Button } from '@/packages/ui/components/ui/button'
import { Textarea } from '@/packages/ui/components/ui/textarea'
import type { DesignProjectedArtifact } from './design-agent-projector'
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
  const [messages, setMessages] = useState<Message[]>([
    { role: 'user', content: initialPrompt },
    { role: 'assistant', content: '' },
  ])
  const [input, setInput] = useState('')
  const [status, setStatus] = useState<'running' | 'completed' | 'failed'>('running')
  const [artifacts, setArtifacts] = useState<DesignProjectedArtifact[]>([])

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
      },
    }).catch((error: unknown) => {
      setStatus('failed')
      appendAssistantText(`\n${error instanceof Error ? error.message : String(error)}`)
    })
  }

  useEffect(() => {
    if (initialRunStarted.current) return
    initialRunStarted.current = true
    runAgent(initialPrompt, { surface: 'design-workspace', initial: true })
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
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col">
        <div className="flex h-10 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2">
            <button className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent">
              预览
            </button>
            <button className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent">
              代码
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
              {status}
            </span>
            <button className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent">
              ↗ 新窗口
            </button>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center bg-background p-8">
          {artifacts.length > 0 ? (
            <div className="w-full max-w-3xl space-y-3">
              {artifacts.map(artifact => (
                <div key={artifact.id} className="rounded-lg border border-border bg-card p-4 shadow-sm">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-foreground">{artifact.title ?? artifact.id}</div>
                      <div className="text-xs text-muted-foreground">{artifact.kind}</div>
                    </div>
                    <span className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
                      {artifact.sourceEventType}
                    </span>
                  </div>
                  <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap rounded border border-border bg-background p-3 text-xs text-muted-foreground">
                    {JSON.stringify(artifact.output, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-card p-8 shadow-sm">
              <p className="text-center text-sm text-muted-foreground">
                生成的界面将在这里预览
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
