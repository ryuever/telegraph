import { useCallback, useEffect, useState } from 'react';
import type React from 'react';
import { Activity, Cable, ListTree, MessageCircle, Palette, Settings, Sparkles } from 'lucide-react';
import { mainWindowClient } from '@/apps/main/application/browser/rpc-clients';
import { PageletHost } from '@/apps/main/application/browser/PageletHost';
import { cn } from '@/packages/ui/lib/utils';
import type { MainSwitchPagePayload } from '@/packages/services/pagelet-host/common';

import {
  DESIGN_PAGE,
  ALL_PAGES,
  type PageConfig,
} from '@/apps/main/application/common/cp-config';

export type { PageConfig };

const PAGE_ICONS: Record<PageConfig['id'], typeof Palette> = {
  design: Palette,
  chat: MessageCircle,
  'run-console': ListTree,
  monitor: Activity,
  connection: Cable,
};

const PAGE_ACCENTS: Record<PageConfig['id'], string> = {
  design: 'bg-accent-lilac text-white',
  chat: 'bg-accent-coral text-white',
  'run-console': 'bg-teal-700 text-white',
  monitor: 'bg-accent-mint text-slate-900',
  connection: 'bg-primary text-primary-foreground',
};

const ACTIVE_PAGE_STORAGE_KEY = 'telegraph.activePageId';

function findPageById(pageId: string | null): PageConfig | undefined {
  if (!pageId) return undefined;
  return ALL_PAGES.find((page) => page.id === pageId);
}

function loadInitialPage(): PageConfig {
  try {
    return findPageById(globalThis.localStorage.getItem(ACTIVE_PAGE_STORAGE_KEY)) ?? DESIGN_PAGE;
  } catch {
    return DESIGN_PAGE;
  }
}

function persistActivePage(page: PageConfig): void {
  try {
    globalThis.localStorage.setItem(ACTIVE_PAGE_STORAGE_KEY, page.id);
  } catch {
    // Ignore storage failures; navigation should still work in restricted contexts.
  }
}

function App(): React.JSX.Element {
  const [activePage, setActivePage] = useState<PageConfig>(loadInitialPage);
  const [runConsoleFocus, setRunConsoleFocus] = useState<MainSwitchPagePayload | undefined>();
  const selectPage = useCallback((page: PageConfig) => {
    setActivePage(page);
    persistActivePage(page);
  }, []);

  useEffect(() => {
    mainWindowClient.onSwitchPage((pageId: string, payload?: MainSwitchPagePayload) => {
      const page = findPageById(pageId);
      if (pageId === 'run-console' && payload?.runId) {
        setRunConsoleFocus(payload);
      }
      if (page) selectPage(page);
    });
  }, [selectPage]);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside className="flex w-[216px] shrink-0 flex-col border-r border-border bg-card/90">
        <div className="border-b border-border px-4 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
              <Sparkles size={16} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">Telegraph</div>
              <div className="text-[11px] text-muted-foreground">AI Agent Desktop</div>
            </div>
          </div>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
          <div className="space-y-1">
            {ALL_PAGES.map((page) => {
              const Icon = PAGE_ICONS[page.id];
              const isActive = activePage.id === page.id;
              return (
                <button
                  key={page.id}
                  type="button"
                  onClick={() => { selectPage(page); }}
                  className={cn(
                    'group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
                    isActive
                      ? 'bg-surface-soft text-foreground shadow-sm ring-1 ring-border'
                      : 'text-muted-foreground hover:bg-surface-soft/70 hover:text-foreground',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors',
                      isActive ? PAGE_ACCENTS[page.id] : 'bg-muted text-muted-foreground group-hover:bg-card',
                    )}
                  >
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium leading-4">{page.label}</span>
                    <span className="block truncate text-[10.5px] leading-4 text-muted-foreground">
                      {page.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className="border-t border-border p-2.5">
          <button
            type="button"
            onClick={() => { void mainWindowClient.openSettingWindow(); }}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-muted-foreground transition-colors hover:bg-surface-soft hover:text-foreground"
            title="Open Settings Window"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Settings size={15} />
            </span>
            <span>Settings</span>
          </button>
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 bg-background">
        <PageletHost activePage={activePage} runConsoleFocus={runConsoleFocus} />
      </main>
    </div>
  );
}

export default App;
