import { useState } from 'react'
import type { JSX } from 'react'

import { HomePage } from './application/browser/HomePage'
import { Sidebar } from './application/browser/Sidebar'
import type { PanelId } from './application/browser/Sidebar'

import { DesignPanel } from '@design/application/browser/DesignPanel'

function PanelContent({ panel }: { panel: PanelId }): JSX.Element {
  switch (panel) {
    case 'design':
      return <DesignPanel />
    case 'chat':
      return <div className="flex h-full items-center justify-center text-muted-foreground text-sm">Chat — coming soon</div>
    default:
      return <HomePage />
  }
}

export function App(): JSX.Element {
  const [currentPanel, setCurrentPanel] = useState<PanelId>('home')

  return (
    <div className="flex h-screen bg-background">
      <Sidebar current={currentPanel} onSwitch={setCurrentPanel} />
      <div className="flex-1 overflow-hidden">
        <PanelContent panel={currentPanel} />
      </div>
    </div>
  )
}
