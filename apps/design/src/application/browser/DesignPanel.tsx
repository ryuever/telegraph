import { useState } from 'react'
import type { JSX } from 'react'
import { Palette, Link2 } from 'lucide-react'
import { cn } from '@telegraph/ui/lib/utils'
import { ConnectionsTab } from './connections/ConnectionsTab'
import { DesignView } from './DesignView'

type SubPanelId = 'design' | 'connections'

interface SubNavItem {
  id: SubPanelId
  icon: typeof Palette
  label: string
}

const SUB_NAV: SubNavItem[] = [
  { id: 'design', icon: Palette, label: 'Design' },
  { id: 'connections', icon: Link2, label: 'Connections' },
]

export function DesignPanel(): JSX.Element {
  const [active, setActive] = useState<SubPanelId>('design')

  return (
    <div className="flex h-full">
      <nav className="flex w-12 flex-col items-center gap-1 border-r border-border bg-zinc-950 py-3">
        {SUB_NAV.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => { setActive(item.id); }}
              title={item.label}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-md transition-colors',
                active === item.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
              )}
            >
              <Icon size={18} />
            </button>
          )
        })}
      </nav>
      <main className="flex-1 overflow-hidden">
        {active === 'design' && <DesignView />}
        {active === 'connections' && <ConnectionsTab />}
      </main>
    </div>
  )
}
