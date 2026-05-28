import React, { useEffect, useMemo, useState } from 'react';
import type {
  ProcessControlAction,
  SupervisorInspectorSnapshot,
} from '@/apps/monitor/application/common';
import { getMonitorPageletClient } from '@/apps/monitor/application/browser/getClient';
import { cn } from '@/packages/ui/lib/utils';

interface SupervisorsPanelProps {
  supervisors: SupervisorInspectorSnapshot[] | undefined;
  query: string;
}

/**
 * Visualizes the per-utility-process supervisor state pushed by the
 * main process via IMainMetricsService.getSupervisorSnapshots() (called
 * by daemon's Diagnostics every 2s and folded into MonitorSnapshot).
 *
 * Mirrors the supervisor diagnostics shape from x-oasis multi-page-router-di
 * and renders live snapshots from main metrics.
 */
export function SupervisorsPanel({
  supervisors,
  query,
}: SupervisorsPanelProps) {
  const [menu, setMenu] = useState<SupervisorContextMenuState | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const filtered = useMemo(() => {
    if (!supervisors) return [];
    const q = query.trim().toLowerCase();
    if (!q) return supervisors;
    return supervisors.filter(
      (s) =>
        s.participantId.toLowerCase().includes(q) ||
        s.state.toLowerCase().includes(q)
    );
  }, [supervisors, query]);

  const selectedSnapshot = useMemo(() => {
    if (!menu) return null;
    return (
      supervisors?.find((snap) => snap.participantId === menu.participantId) ??
      null
    );
  }, [menu, supervisors]);

  useEffect(() => {
    if (!menu) return;

    const close = () => {
      setMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menu]);

  const runSupervisorAction = async (
    participantId: string,
    action: ProcessControlAction
  ) => {
    const key = `${participantId}:${action}`;
    setPendingAction(key);
    setActionError(null);
    setMenu(null);
    try {
      const result = await getMonitorPageletClient().controlSupervisor(
        participantId,
        action
      );
      if (!result.ok) {
        setActionError(result.error ?? `Failed to ${action} ${participantId}`);
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingAction(null);
    }
  };

  if (!supervisors) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Waiting for first supervisor snapshot…
      </div>
    );
  }

  if (supervisors.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        No supervisors registered.
      </div>
    );
  }

  return (
    <div className="relative">
      {actionError && (
        <div className="sticky top-0 z-10 border-b border-rose-500/30 bg-rose-950/80 px-3 py-2 text-[11px] text-rose-100">
          {actionError}
        </div>
      )}
      <div className="grid gap-3 p-3 lg:grid-cols-2">
        {filtered.map((snap) => (
          <SupervisorCard
            key={snap.participantId}
            snapshot={snap}
            isBusy={
              pendingAction?.startsWith(`${snap.participantId}:`) ?? false
            }
            onContextMenu={(event) => {
              event.preventDefault();
              setActionError(null);
              setMenu({
                participantId: snap.participantId,
                x: event.clientX,
                y: event.clientY,
              });
            }}
          />
        ))}
        {filtered.length === 0 && (
          <div className="col-span-full py-8 text-center text-xs text-muted-foreground">
            No supervisors match &ldquo;{query}&rdquo;.
          </div>
        )}
      </div>
      {menu && selectedSnapshot && (
        <SupervisorContextMenu
          snapshot={selectedSnapshot}
          x={menu.x}
          y={menu.y}
          pendingAction={pendingAction}
          onAction={(action) => {
            void runSupervisorAction(selectedSnapshot.participantId, action);
          }}
        />
      )}
    </div>
  );
}

interface SupervisorContextMenuState {
  participantId: string;
  x: number;
  y: number;
}

const STATE_TONE: Record<string, string> = {
  idle: 'bg-surface-soft text-muted-foreground',
  spawning: 'bg-amber-500/20 text-amber-300',
  running: 'bg-emerald-500/20 text-emerald-300',
  restarting: 'bg-amber-500/20 text-amber-300',
  stopped: 'bg-rose-500/20 text-rose-300',
  failed: 'bg-rose-600/30 text-rose-200',
};

function SupervisorCard({
  snapshot,
  isBusy,
  onContextMenu,
}: {
  snapshot: SupervisorInspectorSnapshot;
  isBusy: boolean;
  onContextMenu: React.MouseEventHandler<HTMLElement>;
}) {
  const tone = STATE_TONE[snapshot.state] ?? 'bg-surface-soft text-muted-foreground';
  const recent = snapshot.restartHistory.slice(-5).reverse();

  return (
    <section
      className={cn(
        'rounded-md border border-border bg-card p-4 shadow-sm outline-none transition-colors',
        'hover:border-ring/50',
        isBusy && 'opacity-70'
      )}
      onContextMenu={onContextMenu}
    >
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-[13px] font-semibold text-foreground">
            {snapshot.participantId}
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-[11px] text-muted-foreground">
            <span>
              pid:&nbsp;
              <span className="font-mono text-foreground">
                {snapshot.currentPid ?? '—'}
              </span>
            </span>
            <span>
              orchestrators:&nbsp;
              <span className="font-mono text-foreground">
                {snapshot.orchestratorCount}
              </span>
            </span>
          </div>
        </div>
        <span
          className={cn(
            'rounded px-2 py-0.5 text-[10px] font-medium uppercase',
            tone
          )}
        >
          {snapshot.state}
        </span>
      </header>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
        <Stat label="restart count" value={String(snapshot.restartCount)} />
        <Stat
          label="history size"
          value={String(snapshot.restartHistory.length)}
        />
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
        <Stat
          label="channel ready"
          value={formatTimeAgo(snapshot.lastChannelReadyAt)}
          title={
            snapshot.lastChannelReadyAt
              ? new Date(snapshot.lastChannelReadyAt).toISOString()
              : undefined
          }
        />
        <Stat
          label="readiness probe"
          value={
            snapshot.lastReadinessProbeAt === null
              ? 'n/a'
              : formatTimeAgo(snapshot.lastReadinessProbeAt)
          }
          title={
            snapshot.lastReadinessProbeAt
              ? new Date(snapshot.lastReadinessProbeAt).toISOString()
              : 'spawn-mode supervisor (no readiness probe)'
          }
        />
        <Stat
          label="probe failures"
          value={String(snapshot.consecutiveProbeFailures)}
          tone={
            snapshot.consecutiveProbeFailures > 0 ? 'text-rose-300' : undefined
          }
        />
      </div>

      <div className="mt-3">
        <div className="mb-1.5 text-[10px] font-medium uppercase text-muted-foreground">
          Recent restarts
        </div>
        {recent.length === 0 ? (
          <div className="rounded-md bg-surface-soft px-2 py-1.5 text-[11px] text-muted-foreground">
            No restarts yet.
          </div>
        ) : (
          <ul className="space-y-1">
            {recent.map(
              (
                entry: SupervisorInspectorSnapshot['restartHistory'][number],
                i: number
              ) => (
                <RestartRow key={`${String(entry.triggeredAt)}-${String(i)}`} entry={entry} />
              )
            )}
          </ul>
        )}
      </div>
    </section>
  );
}

function SupervisorContextMenu({
  snapshot,
  x,
  y,
  pendingAction,
  onAction,
}: {
  snapshot: SupervisorInspectorSnapshot;
  x: number;
  y: number;
  pendingAction: string | null;
  onAction: (action: ProcessControlAction) => void;
}) {
  const actions: Array<{
    action: ProcessControlAction;
    label: string;
    disabled: boolean;
  }> = [
    {
      action: 'kill',
      label: 'Kill process',
      disabled: ['stopped', 'failed'].includes(snapshot.state),
    },
    {
      action: 'resume',
      label: 'Resume process',
      disabled: !['stopped', 'failed'].includes(snapshot.state),
    },
    {
      action: 'restart',
      label: 'Restart process',
      disabled: snapshot.state !== 'running',
    },
  ];
  const left = Math.max(8, Math.min(x, window.innerWidth - 190));
  const top = Math.max(8, Math.min(y, window.innerHeight - 132));

  return (
    <div
      className="fixed z-50 w-44 overflow-hidden rounded-md border border-border bg-popover py-1 text-[12px] text-popover-foreground shadow-lg"
      style={{ left, top }}
      onClick={(event) => {
        event.stopPropagation();
      }}
      role="menu"
    >
      <div
        className="truncate border-b border-border px-2.5 py-1.5 font-mono text-[10px] text-muted-foreground"
        title={snapshot.participantId}
      >
        {snapshot.participantId}
      </div>
      {actions.map((item) => {
        const pendingKey = `${snapshot.participantId}:${item.action}`;
        const pending = pendingAction === pendingKey;
        return (
          <button
            key={item.action}
            type="button"
            role="menuitem"
            disabled={item.disabled || pending}
            onClick={() => {
              onAction(item.action);
            }}
            className={cn(
              'flex h-8 w-full items-center justify-between px-2.5 text-left transition-colors',
              'hover:bg-surface-soft hover:text-foreground',
              item.disabled
                ? 'cursor-not-allowed text-muted-foreground/50'
                : 'text-foreground'
            )}
          >
            <span>{pending ? 'Working…' : item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: string;
  tone?: string;
  title?: string;
}) {
  return (
    <div
      className="flex items-baseline justify-between rounded-md bg-surface-soft px-2 py-1"
      title={title}
    >
      <span className="text-[10px] uppercase text-muted-foreground">
        {label}
      </span>
      <span className={cn('font-mono tabular-nums text-foreground', tone)}>
        {value}
      </span>
    </div>
  );
}

/**
 * Renders a wall-clock timestamp as either a short relative duration
 * (`5s ago`, `2m ago`) when within the last 60 minutes, or an absolute
 * `HH:MM:SS` time-of-day stamp otherwise. Returns `'never'` for null —
 * the caller is responsible for substituting `'n/a'` when the field is
 * structurally inapplicable (e.g. spawn-mode `lastReadinessProbeAt`).
 */
function formatTimeAgo(ts: number | null): string {
  if (ts === null) return 'never';
  const deltaMs = Date.now() - ts;
  if (deltaMs < 0) return 'just now';
  const sec = Math.floor(deltaMs / 1000);
  if (sec < 60) return `${String(sec)}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${String(min)}m ago`;
  const t = new Date(ts);
  return `${String(t.getHours()).padStart(2, '0')}:${String(
    t.getMinutes()
  ).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
}

function RestartRow({
  entry,
}: {
  entry: SupervisorInspectorSnapshot['restartHistory'][number];
}) {
  const status = entry.succeededAt
    ? 'success'
    : entry.failedAt
      ? 'failed'
      : 'pending';
  const statusTone =
    status === 'success'
      ? 'text-emerald-400'
      : status === 'failed'
        ? 'text-rose-400'
        : 'text-amber-400';

  const t = new Date(entry.triggeredAt);
  const stamp = `${String(t.getHours()).padStart(2, '0')}:${String(
    t.getMinutes()
  ).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;

  return (
    <li className="flex items-center gap-2 rounded-md bg-surface-soft px-2 py-1 text-[11px]">
      <span className="font-mono tabular-nums text-muted-foreground">{stamp}</span>
      <span className={cn('shrink-0 text-[10px] uppercase', statusTone)}>
        {status}
      </span>
      <span
        className="min-w-0 flex-1 truncate text-foreground"
        title={entry.reason}
      >
        {entry.reason}
      </span>
      <span className="font-mono text-[10px] text-muted-foreground">
        pid {entry.prevPid ?? '—'}
        {entry.newPid ? ` → ${String(entry.newPid)}` : ''}
      </span>
    </li>
  );
}
