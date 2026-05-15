import React, { useMemo } from 'react';
import { SupervisorInspectorSnapshot } from '@/apps/monitor/application/common';
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
 * Mirrors the demo SupervisorsPanel from x-oasis multi-page-router-di
 * example (verified against §3.D supervisor diagnostics).
 */
export function SupervisorsPanel({
  supervisors,
  query,
}: SupervisorsPanelProps) {
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

  if (!supervisors) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-zinc-500">
        Waiting for first supervisor snapshot…
      </div>
    );
  }

  if (supervisors.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-zinc-500">
        No supervisors registered.
      </div>
    );
  }

  return (
    <div className="grid gap-3 p-3 lg:grid-cols-2">
      {filtered.map((snap) => (
        <SupervisorCard key={snap.participantId} snapshot={snap} />
      ))}
      {filtered.length === 0 && (
        <div className="col-span-full py-8 text-center text-xs text-zinc-500">
          No supervisors match &ldquo;{query}&rdquo;.
        </div>
      )}
    </div>
  );
}

const STATE_TONE: Record<string, string> = {
  idle: 'bg-zinc-700/60 text-zinc-200',
  spawning: 'bg-amber-500/20 text-amber-300',
  running: 'bg-emerald-500/20 text-emerald-300',
  restarting: 'bg-amber-500/20 text-amber-300',
  stopped: 'bg-rose-500/20 text-rose-300',
  failed: 'bg-rose-600/30 text-rose-200',
};

function SupervisorCard({
  snapshot,
}: {
  snapshot: SupervisorInspectorSnapshot;
}) {
  const tone = STATE_TONE[snapshot.state] ?? 'bg-zinc-700/60 text-zinc-200';
  const recent = snapshot.restartHistory.slice(-5).reverse();

  return (
    <section className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-4 shadow-sm">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-[13px] font-semibold text-zinc-100">
            {snapshot.participantId}
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-[11px] text-zinc-500">
            <span>
              pid:&nbsp;
              <span className="font-mono text-zinc-300">
                {snapshot.currentPid ?? '—'}
              </span>
            </span>
            <span>
              orchestrators:&nbsp;
              <span className="font-mono text-zinc-300">
                {snapshot.orchestratorCount}
              </span>
            </span>
          </div>
        </div>
        <span
          className={cn(
            'rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider',
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
        <div className="mb-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
          Recent restarts
        </div>
        {recent.length === 0 ? (
          <div className="rounded-md bg-zinc-800/40 px-2 py-1.5 text-[11px] text-zinc-500">
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
      className="flex items-baseline justify-between rounded-md bg-zinc-800/40 px-2 py-1"
      title={title}
    >
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">
        {label}
      </span>
      <span className={cn('font-mono tabular-nums text-zinc-200', tone)}>
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
    <li className="flex items-center gap-2 rounded-md bg-zinc-800/30 px-2 py-1 text-[11px]">
      <span className="font-mono tabular-nums text-zinc-500">{stamp}</span>
      <span className={cn('shrink-0 text-[10px] uppercase', statusTone)}>
        {status}
      </span>
      <span
        className="min-w-0 flex-1 truncate text-zinc-300"
        title={entry.reason}
      >
        {entry.reason}
      </span>
      <span className="font-mono text-[10px] text-zinc-500">
        pid {entry.prevPid ?? '—'}
        {entry.newPid ? ` → ${String(entry.newPid)}` : ''}
      </span>
    </li>
  );
}
