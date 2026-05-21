import React, { useState } from 'react'
import { cn } from '@/packages/ui/lib/utils'
import type { ChatConversation } from '@/apps/chat/application/common'

interface Props {
  conversations: ChatConversation[]
  activeId: string
  collapsed: boolean
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onRename: (id: string, title: string) => void
  onToggleCollapse: () => void
}

export function ChatSidebar({
  conversations,
  activeId,
  collapsed,
  onSelect,
  onCreate,
  onDelete,
  onRename,
  onToggleCollapse,
}: Props) {
  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r border-border bg-card/70 transition-[width] duration-200',
        collapsed ? 'w-12' : 'w-64'
      )}
    >
      <div className="flex items-center gap-1 px-2 py-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-soft hover:text-foreground"
        >
          <Icon name="panel" />
        </button>
        {!collapsed && (
          <button
            type="button"
            onClick={onCreate}
            className="ml-1 flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-background text-[12px] font-medium text-foreground transition-colors hover:bg-surface-soft"
          >
            <Icon name="plus" />
            New chat
          </button>
        )}
      </div>

      {collapsed ? (
        <button
          type="button"
          onClick={onCreate}
          aria-label="New chat"
          className="mx-2 mb-2 flex h-8 items-center justify-center rounded-md border border-border bg-background text-foreground hover:bg-surface-soft"
        >
          <Icon name="plus" />
        </button>
      ) : (
        <ul className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2 pt-1">
          {conversations.map(c => (
            <ConversationRow
              key={c.id}
              conversation={c}
              active={c.id === activeId}
              onSelect={() => { onSelect(c.id); }}
              onDelete={() => { onDelete(c.id); }}
              onRename={title => { onRename(c.id, title); }}
            />
          ))}
        </ul>
      )}

      {!collapsed && (
        <div className="border-t border-border px-3 py-2 text-[10px] uppercase text-muted-foreground">
          Telegraph · Chat
        </div>
      )}
    </aside>
  )
}

function ConversationRow({
  conversation,
  active,
  onSelect,
  onDelete,
  onRename,
}: {
  conversation: ChatConversation
  active: boolean
  onSelect: () => void
  onDelete: () => void
  onRename: (title: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(conversation.title)

  const commit = () => {
    setEditing(false)
    if (draft.trim() && draft !== conversation.title) onRename(draft.trim())
    else setDraft(conversation.title)
  }

  return (
    <li
      className={cn(
        'group flex h-9 items-center gap-1 rounded-md px-2 text-[12.5px] transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
          : 'text-muted-foreground hover:bg-surface-soft hover:text-foreground'
      )}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground">
        <Icon name="message" />
      </span>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={e => { setDraft(e.target.value); }}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') {
              setDraft(conversation.title)
              setEditing(false)
            }
          }}
          className="min-w-0 flex-1 truncate rounded bg-card px-1.5 py-0.5 text-[12.5px] text-foreground outline-none ring-1 ring-border"
        />
      ) : (
        <button
          type="button"
          onClick={onSelect}
          onDoubleClick={() => { setEditing(true); }}
          className="min-w-0 flex-1 truncate text-left"
          title={conversation.title}
        >
          {conversation.title}
        </button>
      )}
      <button
        type="button"
        onClick={onDelete}
        aria-label="Delete chat"
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-surface-soft hover:text-destructive group-hover:opacity-100',
          active && 'opacity-100'
        )}
      >
        <Icon name="trash" />
      </button>
    </li>
  )
}

function Icon({ name }: { name: 'plus' | 'panel' | 'message' | 'trash' }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (name) {
    case 'plus':
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      )
    case 'panel':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18" />
        </svg>
      )
    case 'message':
      return (
        <svg {...common}>
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      )
    case 'trash':
      return (
        <svg {...common}>
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        </svg>
      )
  }
}
