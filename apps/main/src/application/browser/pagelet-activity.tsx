import { createContext, useContext } from 'react'
import type React from 'react'
import type { PageConfig } from '@/apps/main/application/common/cp-config'

export type PageletId = PageConfig['id']

interface PageletActivityContextValue {
  activePageId: PageletId
  pageId: PageletId
  isActive: boolean
}

const PageletActivityContext = createContext<PageletActivityContextValue | null>(null)

export function PageletActivityProvider({
  activePageId,
  pageId,
  children,
}: {
  activePageId: PageletId
  pageId: PageletId
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <PageletActivityContext.Provider
      value={{
        activePageId,
        pageId,
        isActive: activePageId === pageId,
      }}
    >
      {children}
    </PageletActivityContext.Provider>
  )
}

export function usePageletActivity(): PageletActivityContextValue {
  const context = useContext(PageletActivityContext)
  if (!context) {
    throw new Error('usePageletActivity must be used inside PageletActivityProvider')
  }
  return context
}

export function useIsPageletActive(pageId?: PageletId): boolean {
  const context = useContext(PageletActivityContext)
  if (!context) return true
  return pageId ? context.activePageId === pageId : context.isActive
}
