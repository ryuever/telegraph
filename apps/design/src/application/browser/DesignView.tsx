import { useCallback, useState } from 'react'
import type { JSX } from 'react'
import { DesignEntry } from './DesignEntry'
import { DesignSessionSidebar, type DesignSessionListItem } from './DesignSessionSidebar'
import { DesignWorkspace, type DesignWorkspaceSummary } from './DesignWorkspace'

interface DesignViewProps {
  onOpenSettings?: () => void
}

interface DesignSession extends DesignSessionListItem {
  prompt: string
  activeArtifactTitle?: string
  createdAt: number
  updatedAt: number
}

export function DesignView({ onOpenSettings }: DesignViewProps): JSX.Element {
  const [sessions, setSessions] = useState<DesignSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<'entry' | 'workspace'>('entry')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

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
