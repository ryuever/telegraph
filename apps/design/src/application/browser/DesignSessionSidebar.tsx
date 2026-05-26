import { useRef, useState } from 'react'
import type { JSX, KeyboardEvent, PointerEvent } from 'react'
import { FileText, PanelLeft, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/packages/ui/lib/utils'
import type { DesignRunStatus } from './DesignWorkspace'

const COLLAPSED_SESSION_SIDEBAR_WIDTH = 56
const DEFAULT_SESSION_SIDEBAR_WIDTH = 304
const MIN_SESSION_SIDEBAR_WIDTH = 264
const MAX_SESSION_SIDEBAR_WIDTH = 440

export interface DesignSessionListItem {
  id: string
  title: string
  status: DesignRunStatus
  artifactCount: number
}

interface DesignSessionSidebarProps {
  sessions: DesignSessionListItem[]
  activeId: string | null
  collapsed: boolean
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  onToggleCollapse: () => void
}

export function DesignSessionSidebar({
  sessions,
  activeId,
  collapsed,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  onToggleCollapse,
}: DesignSessionSidebarProps): JSX.Element {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SESSION_SIDEBAR_WIDTH)
  const [resizing, setResizing] = useState(false)
  const resizeStartRef = useRef({ pointerX: 0, width: DEFAULT_SESSION_SIDEBAR_WIDTH })
  const renderedWidth = collapsed ? COLLAPSED_SESSION_SIDEBAR_WIDTH : sidebarWidth

  const handleResizePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (collapsed) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeStartRef.current = {
      pointerX: event.clientX,
      width: sidebarWidth,
    }
    setResizing(true)
  }

  const handleResizePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!resizing) return
    const delta = event.clientX - resizeStartRef.current.pointerX
    setSidebarWidth(clampSessionSidebarWidth(resizeStartRef.current.width + delta))
  }

  const handleResizePointerEnd = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setResizing(false)
  }

  const handleResizeKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (collapsed) return
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setSidebarWidth(current => clampSessionSidebarWidth(current - (event.shiftKey ? 32 : 12)))
      return
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      setSidebarWidth(current => clampSessionSidebarWidth(current + (event.shiftKey ? 32 : 12)))
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      setSidebarWidth(MIN_SESSION_SIDEBAR_WIDTH)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      setSidebarWidth(MAX_SESSION_SIDEBAR_WIDTH)
    }
  }

  return (
    <aside
      className={cn(
        'relative flex h-full shrink-0 flex-col border-r border-border bg-card/80',
        resizing ? 'transition-none' : 'transition-[width] duration-200',
      )}
      style={{ width: renderedWidth }}
    >
      <div className="flex items-center gap-1 px-2 py-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand design sessions' : 'Collapse design sessions'}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-soft hover:text-foreground"
        >
          <PanelLeft size={14} />
        </button>
        {!collapsed && (
          <button
            type="button"
            onClick={onCreate}
            className="ml-1 flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-background text-[12px] font-medium text-foreground transition-colors hover:bg-surface-soft"
          >
            <Plus size={14} />
            New design
          </button>
        )}
      </div>

      {collapsed ? (
        <button
          type="button"
          onClick={onCreate}
          aria-label="New design"
          className="mx-2 mb-2 flex h-9 items-center justify-center rounded-md border border-border bg-background text-foreground hover:border-primary/35 hover:bg-surface-soft"
        >
          <Plus size={14} />
        </button>
      ) : (
        <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2 pt-1">
          {sessions.map(session => (
            <DesignSessionRow
              key={session.id}
              session={session}
              active={session.id === activeId}
              onSelect={() => { onSelect(session.id) }}
              onDelete={() => { onDelete(session.id) }}
              onRename={title => { onRename(session.id, title) }}
            />
          ))}
        </ul>
      )}

      {!collapsed && (
        <div className="border-t border-border px-3 py-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Telegraph · Design
        </div>
      )}

      {!collapsed && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize design session list"
          aria-valuemin={MIN_SESSION_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SESSION_SIDEBAR_WIDTH}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerEnd}
          onPointerCancel={handleResizePointerEnd}
          onDoubleClick={() => { setSidebarWidth(DEFAULT_SESSION_SIDEBAR_WIDTH) }}
          onKeyDown={handleResizeKeyDown}
          className={cn(
            'absolute -right-1 top-0 z-20 h-full w-2 cursor-col-resize touch-none outline-none',
            'after:absolute after:left-1/2 after:top-0 after:h-full after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors',
            'hover:after:bg-primary/45 focus-visible:after:bg-primary/70',
            resizing && 'after:bg-primary',
          )}
        />
      )}
    </aside>
  )
}

function clampSessionSidebarWidth(width: number): number {
  return Math.min(MAX_SESSION_SIDEBAR_WIDTH, Math.max(MIN_SESSION_SIDEBAR_WIDTH, Math.round(width)))
}

function DesignSessionRow({
  session,
  active,
  onSelect,
  onDelete,
  onRename,
}: {
  session: DesignSessionListItem
  active: boolean
  onSelect: () => void
  onDelete: () => void
  onRename: (title: string) => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(session.title)

  const commit = (): void => {
    setEditing(false)
    if (draft.trim() && draft !== session.title) {
      onRename(draft.trim())
      return
    }
    setDraft(session.title)
  }

  return (
    <li
      className={cn(
        'group flex h-9 items-center gap-1 rounded-md px-2 text-[12.5px] transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm ring-1 ring-primary/25'
          : 'text-muted-foreground hover:bg-surface-soft hover:text-foreground',
      )}
    >
      {active && <span className="mr-0.5 h-5 w-0.5 rounded-full bg-primary" />}
      <span className="relative flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
        <FileText size={14} />
        <span className={cn('absolute right-0 top-0 h-1.5 w-1.5 rounded-full', statusDotClassName(session.status))} />
      </span>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={e => { setDraft(e.target.value) }}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') {
              setDraft(session.title)
              setEditing(false)
            }
          }}
          className="min-w-0 flex-1 truncate rounded bg-card px-1.5 py-0.5 text-[12.5px] text-foreground outline-none ring-1 ring-border"
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          onDoubleClick={() => { setEditing(true) }}
          aria-label={`Open design session: ${session.title}`}
          className="min-w-0 flex-1 truncate text-left"
          title={`${session.title} · ${statusLabel(session.status)} · ${String(session.artifactCount)} artifacts`}
        >
          {session.title}
        </button>
      )}
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete design session"
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-surface-soft hover:text-destructive group-hover:opacity-100',
          active && 'opacity-100',
        )}
      >
        <Trash2 size={13} />
      </button>
    </li>
  )
}

function statusLabel(status: DesignRunStatus): string {
  if (status === 'running') return '生成中'
  if (status === 'completed') return '已完成'
  if (status === 'failed') return '失败'
  return '已停止'
}

function statusDotClassName(status: DesignRunStatus): string {
  if (status === 'running') return 'bg-amber-500'
  if (status === 'completed') return 'bg-emerald-500'
  if (status === 'failed') return 'bg-destructive'
  return 'bg-muted-foreground'
}
