import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import PageView from '@/apps/connection/application/browser/PageView'
import MonitorPage from '@/apps/monitor/application/browser/MonitorPage'
import { DesignPanel } from '@/apps/design/application/browser/DesignPanel'
import ChatPage from '@/apps/chat/application/browser/ChatPage'
import { RunConsolePanel } from '@/apps/main/application/browser/RunConsolePanel'
import {
  ALL_PAGES,
  CONNECTION_PAGE,
  type PageConfig,
} from '@/apps/main/application/common/cp-config'
import type { MainSwitchPagePayload } from '@/packages/services/pagelet-host/common'
import { PageletActivityProvider, type PageletId } from './pagelet-activity'

type PageRenderer = () => React.ReactNode

const PAGE_RENDERERS: Record<PageletId, PageRenderer> = {
  connection: () => <PageView page={CONNECTION_PAGE} />,
  monitor: () => <MonitorPage />,
  design: () => <DesignPanel />,
  chat: () => <ChatPage />,
  'run-console': () => <RunConsolePanel />,
}

export function PageletHost({
  activePage,
  runConsoleFocus,
}: {
  activePage: PageConfig
  runConsoleFocus?: MainSwitchPagePayload
}): React.JSX.Element {
  const [visitedPageIds, setVisitedPageIds] = useState<Set<PageletId>>(
    () => new Set([activePage.id])
  )

  useEffect(() => {
    setVisitedPageIds((prev) => {
      if (prev.has(activePage.id)) return prev
      const next = new Set(prev)
      next.add(activePage.id)
      return next
    })
  }, [activePage.id])

  const pages = useMemo(() => ALL_PAGES, [])

  return (
    <div
      style={{
        position: 'relative',
        flex: 1,
        width: '100%',
        height: '100%',
        minWidth: 0,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {pages.map((page) => {
        if (!visitedPageIds.has(page.id)) return null

        const isActive = activePage.id === page.id
        return (
          <PageletActivityProvider
            key={page.id}
            activePageId={activePage.id}
            pageId={page.id}
          >
            <section
              aria-hidden={!isActive}
              hidden={!isActive}
              style={{
                position: 'absolute',
                inset: 0,
                display: isActive ? 'flex' : 'none',
                flexDirection: 'column',
                minWidth: 0,
                minHeight: 0,
                overflow: 'hidden',
              }}
            >
              {page.id === 'run-console'
                ? <RunConsolePanel focus={runConsoleFocus} />
                : PAGE_RENDERERS[page.id]()}
            </section>
          </PageletActivityProvider>
        )
      })}
    </div>
  )
}
