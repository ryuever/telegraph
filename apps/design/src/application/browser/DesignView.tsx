import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { DesignEntry } from './DesignEntry'
import type { DesignAgentRunRecordSnapshot } from '@/apps/design/application/common'
import {
  PageletDesignAgentService,
} from './pagelet-design-agent-service'
import type {
  DesignAgentRunProjection,
} from './design-agent-projector'
import { DesignSessionSidebar, type DesignSessionListItem } from './DesignSessionSidebar'
import { DesignWorkspace, type DesignWorkspaceInitialState, type DesignWorkspaceSummary } from './DesignWorkspace'

interface DesignViewProps {
  onOpenSettings?: () => void
}

interface DesignSession extends DesignSessionListItem {
  prompt: string
  activeArtifactTitle?: string
  initialState?: DesignWorkspaceInitialState
  createdAt: number
  updatedAt: number
}

export function DesignView({ onOpenSettings }: DesignViewProps): JSX.Element {
  const agent = useMemo(() => new PageletDesignAgentService(), [])
  const [sessions, setSessions] = useState<DesignSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<'entry' | 'workspace'>('entry')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    void hydrateDesignSessions(agent, controller.signal)
      .then(hydratedSessions => {
        if (cancelled || hydratedSessions.length === 0) return
        setSessions(current => mergeHydratedSessions(current, hydratedSessions))
      })
      .catch(() => {})

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [agent])

  const startWorkspace = (nextPrompt: string): void => {
    const now = Date.now()
    const session: DesignSession = {
      id: globalThis.crypto.randomUUID(),
      title: deriveSessionTitle(nextPrompt),
      prompt: nextPrompt,
      status: 'running',
      artifactCount: 0,
      createdAt: now,
      updatedAt: now,
    }
    setSessions(current => [session, ...current])
    setActiveSessionId(session.id)
    setActiveView('workspace')
  }

  const openSession = (sessionId: string): void => {
    setActiveSessionId(sessionId)
    setActiveView('workspace')
  }

  const createDesignDraft = (): void => {
    setActiveSessionId(null)
    setActiveView('entry')
  }

  const deleteSession = (sessionId: string): void => {
    setSessions(current => current.filter(session => session.id !== sessionId))
    if (activeSessionId === sessionId) {
      setActiveSessionId(null)
      setActiveView('entry')
    }
  }

  const renameSession = (sessionId: string, title: string): void => {
    setSessions(current => current.map(session => {
      if (session.id !== sessionId) return session
      return { ...session, title, updatedAt: Date.now() }
    }))
  }

  const updateSessionSummary = useCallback((sessionId: string, summary: DesignWorkspaceSummary): void => {
    setSessions(current => current.map(session => {
      if (session.id !== sessionId) return session
      if (
        session.status === summary.status &&
        session.artifactCount === summary.artifactCount &&
        session.activeArtifactTitle === summary.activeArtifactTitle
      ) {
        return session
      }
      return {
        ...session,
        status: summary.status,
        artifactCount: summary.artifactCount,
        activeArtifactTitle: summary.activeArtifactTitle,
        updatedAt: Date.now(),
      }
    }))
  }, [])

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-background">
      <DesignSessionSidebar
        sessions={sessions}
        activeId={activeSessionId}
        collapsed={sidebarCollapsed}
        onSelect={openSession}
        onCreate={createDesignDraft}
        onDelete={deleteSession}
        onRename={renameSession}
        onToggleCollapse={() => { setSidebarCollapsed(current => !current) }}
      />
      <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {activeView === 'entry' && (
          <DesignEntry
            onSubmit={startWorkspace}
            onOpenSettings={onOpenSettings}
          />
        )}
        {sessions.map(session => (
          <div
            key={session.id}
            className={activeView === 'workspace' && activeSessionId === session.id ? 'absolute inset-0' : 'hidden'}
          >
            <DesignWorkspace
              initialPrompt={session.prompt}
              sessionId={session.id}
              sessionTitle={session.title}
              initialState={session.initialState}
              onOpenSettings={onOpenSettings}
              onSessionUpdate={updateSessionSummary}
            />
          </div>
        ))}
      </main>
    </div>
  )
}

function deriveSessionTitle(prompt: string): string {
  const title = prompt.replace(/\s+/g, ' ').trim()
  if (title.length === 0) return '未命名设计'
  if (title.length <= 40) return title
  return `${title.slice(0, 40)}...`
}

interface DesignRunHistory {
  run: DesignAgentRunRecordSnapshot
  projection: DesignAgentRunProjection
}

async function hydrateDesignSessions(
  agent: PageletDesignAgentService,
  signal: AbortSignal,
): Promise<DesignSession[]> {
  const runs = await agent.listAgentRuns(signal)
  const histories = await Promise.all(runs.map(async run => ({
    run,
    projection: await agent.getAgentRunProjection(run.runId, signal).catch(() => emptyRunProjection()),
  })))

  const groups = new Map<string, DesignRunHistory[]>()
  for (const history of histories) {
    const sessionId = history.run.sessionId ?? history.run.runId
    groups.set(sessionId, [...(groups.get(sessionId) ?? []), history])
  }

  return Array.from(groups.entries())
    .map(([sessionId, group]) => designSessionFromHistory(sessionId, group))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

function designSessionFromHistory(sessionId: string, group: DesignRunHistory[]): DesignSession {
  const ordered = group.slice().sort((a, b) => a.run.startedAt - b.run.startedAt)
  const first = ordered[0]
  const latest = ordered.at(-1) ?? first
  const artifacts = mergeArtifacts(ordered.flatMap(item => item.projection.artifacts))
  const subagentItems = mergeById(ordered.flatMap(item => item.projection.subagents), item => item.id)
  const traceEvents = ordered.flatMap(item => item.projection.traceEvents)
  const activeArtifact = artifacts.at(-1)
  const status = latest.projection.status ?? latest.run.status
  const initialState: DesignWorkspaceInitialState = {
    messages: ordered.flatMap(item => [
      {
        id: `${item.run.runId}:user`,
        role: 'user' as const,
        content: item.run.prompt,
      },
      {
        id: `${item.run.runId}:assistant`,
        role: 'assistant' as const,
        content: item.projection.assistantText || fallbackAssistantMessage(item.run, item.projection),
        runStatus: item.projection.status ?? item.run.status,
      },
    ]),
    status,
    artifacts,
    activeArtifactId: activeArtifact?.id,
    traceEvents,
    subagentItems,
  }

  return {
    id: sessionId,
    title: deriveSessionTitle(first.run.prompt),
    prompt: first.run.prompt,
    status,
    artifactCount: artifacts.length,
    activeArtifactTitle: activeArtifact?.title ?? activeArtifact?.id,
    createdAt: first.run.startedAt,
    updatedAt: Math.max(...ordered.map(item => item.run.updatedAt)),
    initialState,
  }
}

function mergeHydratedSessions(current: DesignSession[], hydrated: DesignSession[]): DesignSession[] {
  const currentIds = new Set(current.map(session => session.id))
  return [
    ...current,
    ...hydrated.filter(session => !currentIds.has(session.id)),
  ]
}

function emptyRunProjection(): DesignAgentRunProjection {
  return {
    assistantText: '',
    artifacts: [],
    subagents: [],
    traceEvents: [],
  }
}

function mergeArtifacts<T extends { id: string }>(items: T[]): T[] {
  return mergeById(items, item => item.id)
}

function mergeById<T>(items: T[], getId: (item: T) => string): T[] {
  const map = new Map<string, T>()
  for (const item of items) {
    map.set(getId(item), item)
  }
  return Array.from(map.values())
}

function fallbackAssistantMessage(
  run: DesignAgentRunRecordSnapshot,
  projection: DesignAgentRunProjection,
): string {
  const artifact = projection.artifacts.at(-1)
  if (run.status === 'completed') {
    return artifact?.title ? `已生成「${artifact.title}」预览。` : '已完成。'
  }
  if (run.status === 'failed') return run.error ?? '运行失败。'
  if (run.status === 'cancelled') return '已停止。'
  return ''
}
