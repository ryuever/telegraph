import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';
import { Activity, Cable, ChevronUp, Code2, ListTree, MessageCircle, Palette, Settings, UserRound } from 'lucide-react';
import { mainWindowClient } from '@/apps/main/application/browser/rpc-clients';
import { PageletHost } from '@/apps/main/application/browser/PageletHost';
import { cn } from '@/packages/ui/lib/utils';
import { useTelegraphTheme } from '@/packages/ui/theme';
import type { MainSwitchPagePayload } from '@/packages/services/pagelet-host/common';
import telegraphIconUrl from '@/docs/assets/telegraph-icon.svg';

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

const ACTIVE_PAGE_STORAGE_KEY = 'telegraph.activePageId';
const SETTING_WINDOW_PAGE_STORAGE_KEY = 'telegraph.settingWindowPage';
const SETTING_WINDOW_PAGE_BROADCAST_CHANNEL = 'telegraph-setting-window-page';

type SettingWindowPage = 'settings' | 'dev';

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

function persistSettingWindowPage(page: SettingWindowPage): void {
  try {
    globalThis.localStorage.setItem(SETTING_WINDOW_PAGE_STORAGE_KEY, page);
  } catch {
    // Ignore storage failures; the setting window will fall back to its default page.
  }
}

function broadcastSettingWindowPage(page: SettingWindowPage): void {
  if (typeof BroadcastChannel === 'undefined') return;

  const channel = new BroadcastChannel(SETTING_WINDOW_PAGE_BROADCAST_CHANNEL);
  try {
    channel.postMessage({ page });
  } finally {
    channel.close();
  }
}

function App(): React.JSX.Element {
  useTelegraphTheme();

  const [activePage, setActivePage] = useState<PageConfig>(loadInitialPage);
  const [runConsoleFocus, setRunConsoleFocus] = useState<MainSwitchPagePayload | undefined>();
  const selectPage = useCallback((page: PageConfig) => {
    setActivePage(page);
    persistActivePage(page);
  }, []);
  const openSettingWindowPage = useCallback((page: SettingWindowPage) => {
    persistSettingWindowPage(page);
    broadcastSettingWindowPage(page);
    void mainWindowClient.openSettingWindow();
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
      <aside className="flex w-[60px] shrink-0 flex-col items-center border-r border-sidebar-border bg-sidebar/95 text-sidebar-foreground">
        <div className="flex h-12 w-full items-center justify-center border-b border-border">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-md border border-primary/30 bg-primary/10 shadow-[var(--shadow-primary-glow)]"
            title="Telegraph"
          >
            <img src={telegraphIconUrl} alt="Telegraph" className="h-7 w-7 rounded-[5px]" />
          </div>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <div className="space-y-1">
            {ALL_PAGES.map((page) => {
              const Icon = PAGE_ICONS[page.id];
              const isActive = activePage.id === page.id;
              return (
                <button
                  key={page.id}
                  type="button"
                  onClick={() => { selectPage(page); }}
                  title={`${page.label} · ${page.description}`}
                  aria-label={page.label}
                  className={cn(
                    'group relative flex h-10 w-10 items-center justify-center rounded-md text-center transition-colors',
                    isActive
                      ? 'bg-surface-soft text-foreground shadow-sm ring-1 ring-primary/25'
                      : 'text-muted-foreground hover:bg-surface-soft/70 hover:text-foreground',
                  )}
                >
                  {isActive && <span className="absolute left-0 top-2 h-6 w-0.5 rounded-r bg-primary" />}
                  <span className={cn('transition-colors', isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground')}>
                    <Icon size={18} />
                  </span>
                </button>
              );
            })}
          </div>
        </nav>

        <div className="w-full border-t border-border p-2">
          <AvatarMenu
            onOpenSettings={() => { openSettingWindowPage('settings'); }}
            onOpenDev={() => { openSettingWindowPage('dev'); }}
          />
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        <AppContextBar
          activePage={activePage}
          onOpenSettings={() => { openSettingWindowPage('settings'); }}
        />
        <div className="min-h-0 min-w-0 flex-1">
          <PageletHost activePage={activePage} runConsoleFocus={runConsoleFocus} />
        </div>
      </main>
    </div>
  );
}

function AvatarMenu({
  onOpenSettings,
  onOpenDev,
}: {
  onOpenSettings: () => void;
  onOpenDev: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const openSettings = useCallback(() => {
    setOpen(false);
    onOpenSettings();
  }, [onOpenSettings]);
  const openDev = useCallback(() => {
    setOpen(false);
    onOpenDev();
  }, [onOpenDev]);

  return (
    <div ref={menuRef} className="relative">
      {open && (
        <div
          role="menu"
          aria-label="Account menu"
          className="absolute bottom-12 left-0 z-50 w-44 rounded-md border border-border bg-popover p-1.5 text-popover-foreground shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={openSettings}
            className="flex h-9 w-full items-center gap-2 rounded-[5px] px-2.5 text-left text-[12px] font-medium text-foreground transition-colors hover:bg-surface-soft"
          >
            <Settings size={14} />
            <span>Setting</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={openDev}
            className="flex h-9 w-full items-center gap-2 rounded-[5px] px-2.5 text-left text-[12px] font-medium text-foreground transition-colors hover:bg-surface-soft"
          >
            <Code2 size={14} />
            <span>Dev</span>
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => { setOpen((value) => !value); }}
        aria-label="Open account menu"
        aria-expanded={open}
        className="group flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card/70 text-muted-foreground shadow-sm transition-colors hover:border-primary/35 hover:bg-surface-soft hover:text-foreground"
        title="Account"
      >
        <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-primary/12 text-primary">
          <UserRound size={17} />
          <ChevronUp
            size={10}
            className={cn(
              'absolute -bottom-0.5 -right-0.5 rounded-full bg-card text-muted-foreground transition-transform',
              open ? 'rotate-180' : 'rotate-0',
            )}
          />
        </span>
      </button>
    </div>
  );
}

function AppContextBar({
  activePage,
  onOpenSettings,
}: {
  activePage: PageConfig;
  onOpenSettings: () => void;
}): React.JSX.Element {
  const Icon = PAGE_ICONS[activePage.id];

  return (
    <header
      className="relative flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-background/95 px-3 shadow-[inset_0_-1px_0_var(--border)]"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary shadow-[var(--shadow-primary-soft)]">
          <Icon size={15} />
        </div>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <div className="truncate text-[13px] font-semibold leading-none text-foreground">{activePage.label}</div>
            <span className="hidden h-1 w-1 shrink-0 rounded-full bg-primary/70 sm:block" />
            <div className="hidden truncate text-[10.5px] leading-none text-muted-foreground sm:block">
              {activePage.description}
            </div>
          </div>
          <div className="mt-1 hidden h-px w-24 bg-primary/35 sm:block" />
        </div>
      </div>

      <div
        className="flex shrink-0 items-center gap-2 text-[10.5px] text-muted-foreground"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="hidden h-7 items-center gap-2 rounded-md border border-border bg-card/55 px-2.5 sm:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-mint shadow-[0_0_10px_rgba(55,220,168,0.35)]" />
          <span className="font-medium text-foreground">Ready</span>
          <span className="h-3 w-px bg-border" />
          <span>Local</span>
        </div>
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Open Settings Window"
          title="Open Settings Window"
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card/55 text-muted-foreground transition-colors hover:border-primary/30 hover:bg-surface-soft hover:text-foreground"
        >
          <Settings size={14} />
        </button>
      </div>
    </header>
  );
}

export default App;
