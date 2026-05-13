import type { JSX } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Home, Palette, MessageSquare } from 'lucide-react'
import { cn } from '@telegraph/ui/lib/utils'

export type PanelId = 'home' | 'design' | 'chat'

interface NavItem {
  id: PanelId
  icon: LucideIcon
  label: string
}

const NAV_ITEMS: NavItem[] = [
  { id: 'home', icon: Home, label: 'Home' },
  { id: 'design', icon: Palette, label: 'Design' },
  { id: 'chat', icon: MessageSquare, label: 'Chat' },
]

interface SidebarProps {
  current: PanelId
  onSwitch: (id: PanelId) => void
}

export function Sidebar({ current, onSwitch }: SidebarProps): JSX.Element {
  return (
    <nav
      className="flex w-16 shrink-0 flex-col items-center border-r border-border bg-zinc-950/60 pt-10 gap-2"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => { onSwitch(item.id); }}
            title={item.label}
            className={cn(
              'group relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors cursor-pointer',
              current === item.id
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )}
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <Icon size={16} />
            <span className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md opacity-0 transition-opacity group-hover:opacity-100">
              {item.label}
            </span>
          </button>
        )
      })}
    </nav>
  )
}
