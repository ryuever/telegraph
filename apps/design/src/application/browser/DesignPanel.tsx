import { useState } from 'react'
import type { JSX } from 'react'
import { Palette, Settings } from 'lucide-react'
import { cn } from '@/packages/ui/lib/utils'
import { DesignRuntimeSettingsDialog } from './DesignRuntimeSettingsDialog'
import { DesignView } from './DesignView'
import {
  loadDesignRuntimeSettings,
  saveDesignRuntimeSettings,
  type DesignRuntimeSettings,
} from './design-runtime-settings'

type SubPanelId = 'design'

interface SubNavItem {
  id: SubPanelId
  icon: typeof Palette
  label: string
}

const SUB_NAV: SubNavItem[] = [
  { id: 'design', icon: Palette, label: 'Design' },
]

export function DesignPanel(): JSX.Element {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [runtimeSettings, setRuntimeSettings] = useState<DesignRuntimeSettings>(() =>
    loadDesignRuntimeSettings()
  )

  const saveRuntimeSettings = (next: DesignRuntimeSettings): void => {
    saveDesignRuntimeSettings(next)
    setRuntimeSettings(next)
  }

  return (
    <div className="flex h-full">
      <nav className="flex w-12 flex-col items-center border-r border-border bg-zinc-950 py-3">
        <div className="flex flex-1 flex-col items-center gap-1">
          {SUB_NAV.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                title={item.label}
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-md transition-colors',
                  'bg-accent text-accent-foreground',
                )}
              >
                <Icon size={18} />
              </button>
            )
          })}
        </div>
        <button
          type="button"
          title="Design settings"
          aria-label="Design settings"
          onClick={() => { setSettingsOpen(true) }}
          className={cn(
            'flex h-9 w-9 items-center justify-center rounded-md transition-colors',
            'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100',
          )}
        >
          <Settings size={18} />
        </button>
      </nav>
      <main className="flex-1 overflow-hidden">
        <DesignView />
      </main>
      <DesignRuntimeSettingsDialog
        open={settingsOpen}
        settings={runtimeSettings}
        onClose={() => { setSettingsOpen(false) }}
        onSave={saveRuntimeSettings}
      />
    </div>
  )
}
