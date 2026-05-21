import { useState } from 'react'
import type { JSX } from 'react'
import { DesignRuntimeSettingsDialog } from './DesignRuntimeSettingsDialog'
import { DesignView } from './DesignView'
import {
  loadDesignRuntimeSettings,
  saveDesignRuntimeSettings,
  type DesignRuntimeSettings,
} from './design-runtime-settings'

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
    <div className="flex h-full bg-background text-foreground">
      <main className="min-w-0 flex-1 overflow-hidden">
        <DesignView onOpenSettings={() => { setSettingsOpen(true) }} />
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
