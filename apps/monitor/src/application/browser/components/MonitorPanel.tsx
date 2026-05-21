import React, { useMemo, useState } from 'react';
import { ProcessesTable } from './ProcessesTable';
import { Sparkline, cpuColorClass } from './Sparkline';
import { SupervisorsPanel } from './SupervisorsPanel';
import {
  useMonitorSnapshots,
  useNowTick,
  useSnapshotHistory,
  useSupervisorSnapshots,
} from '../hooks';
import { MonitorSnapshot, ProcessRow } from '@/apps/monitor/application/common';
import { cn } from '@/packages/ui/lib/utils';
import { useIsPageletActive } from '@/apps/main/application/browser/pagelet-activity';

type TabId = 'overview' | 'processes' | 'supervisors';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'processes', label: 'Processes' },
  { id: 'supervisors', label: 'Supervisors' },
];

export function MonitorPanel() {
  const isActive = useIsPageletActive('monitor');
  const { snapshot, updatedAt } = useMonitorSnapshots(isActive);
  // Supervisor snapshots arrive on their own push channel
  // (`onSupervisorSnapshotsChanged`) sourced from main directly —
  // intentionally decoupled from the daemon-driven `MonitorSnapshot`
  // pipeline so daemon being down doesn't blind us to supervisor
  // `restarting` transitions. See IMonitorPageletService for the
  // full rationale.
  const supervisorSnapshots = useSupervisorSnapshots(isActive);
  const history = useSnapshotHistory(snapshot, 60);
  useNowTick(1000, isActive);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<TabId>('overview');

  const cpuSeries = useMemo(
    () => history.map((h) => h.totals.cpu),
    [history]
  );
  const memSeries = useMemo(
    () => history.map((h) => h.totals.memory),
    [history]
  );

  return (
    <div className="flex h-full w-full flex-col bg-background text-foreground">
      <Header
        query={query}
        setQuery={setQuery}
        snapshot={snapshot}
        updatedAt={updatedAt}
      />

      <div className="flex items-center gap-1 border-b border-border bg-card/55 px-5 py-1.5">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => { setTab(t.id); }}
              className={cn(
                'rounded px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                active
                  ? 'bg-background text-foreground shadow-sm ring-1 ring-border'
                  : 'text-muted-foreground hover:bg-surface-soft hover:text-foreground'
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {!snapshot ? (
          <EmptyState />
        ) : tab === 'overview' ? (
          <div className="h-full overflow-auto p-5">
            <Overview
              snapshot={snapshot}
              cpuSeries={cpuSeries}
              memSeries={memSeries}
            />
          </div>
        ) : tab === 'processes' ? (
          <div className="h-full overflow-auto px-3 pb-3">
            <ProcessesTable processes={snapshot.processes} query={query} />
          </div>
        ) : (
          <div className="h-full overflow-auto">
            <SupervisorsPanel
              supervisors={supervisorSnapshots ?? []}
              query={query}
            />
          </div>
        )}
      </div>

      <Footer snapshot={snapshot} />
    </div>
  );
}

function Header({
  query,
  setQuery,
  snapshot,
  updatedAt,
}: {
  query: string;
  setQuery: (v: string) => void;
  snapshot: MonitorSnapshot | null;
  updatedAt: number | null;
}) {
  const ago =
    updatedAt != null
      ? Math.max(0, Math.round((Date.now() - updatedAt) / 1000))
      : null;
  return (
    <header className="flex items-center justify-between gap-3 border-b border-border bg-card/55 px-5 py-3">
      <div className="flex items-baseline gap-3">
        <h1 className="text-base font-semibold text-foreground">
          Monitor
        </h1>
        <span className="text-[11px] text-muted-foreground">
          {snapshot?.processes
            ? `${String(snapshot.processes.length)} processes`
            : 'connecting…'}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {ago != null ? `updated ${String(ago)}s ago` : ''}
        </span>
        <SearchInput value={query} onChange={setQuery} />
      </div>
    </header>
  );
}

function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative w-56">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => { onChange(e.target.value); }}
        placeholder="Search processes…"
        className="h-7 w-full rounded-md border border-input bg-background pl-7 pr-2 text-[12px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
      />
    </div>
  );
}

function Overview({
  snapshot,
  cpuSeries,
  memSeries,
}: {
  snapshot: MonitorSnapshot;
  cpuSeries: number[];
  memSeries: number[];
}) {
  const topCpu = useMemo(
    () =>
      snapshot.processes
        .slice()
        .sort((a, b) => b.cpu - a.cpu)
        .slice(0, 5),
    [snapshot.processes]
  );
  const topMem = useMemo(
    () =>
      snapshot.processes
        .slice()
        .sort((a, b) => b.memory - a.memory)
        .slice(0, 5),
    [snapshot.processes]
  );
  const memMax = Math.max(1, ...memSeries);
  const cpuColor = cpuColorClass(snapshot.totals.cpu);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="CPU"
          value={snapshot.totals.cpu.toFixed(1)}
          unit="%"
          accentClass={cpuColor}
        >
          <div className={cn('mt-3', cpuColor)}>
            <Sparkline
              values={cpuSeries}
              max={Math.max(100, ...cpuSeries)}
              height={56}
            />
          </div>
        </StatCard>
        <StatCard
          label="Memory"
          value={snapshot.totals.memory.toFixed(0)}
          unit="MB"
          accentClass="text-sky-400"
        >
          <div className="mt-3 text-sky-400">
            <Sparkline values={memSeries} max={memMax} height={56} />
          </div>
        </StatCard>
        <StatCard
          label="Processes"
          value={String(snapshot.processes.length)}
          unit="active"
          accentClass="text-foreground"
        >
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
            <MiniStat
              label="utility"
              value={countByType(snapshot.processes, 'Utility')}
            />
            <MiniStat label="other" value={countOther(snapshot.processes)} />
          </div>
        </StatCard>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <TopCard
          title="Top CPU"
          rows={topCpu}
          unit="%"
          field="cpu"
          max={Math.max(1, ...topCpu.map((p) => p.cpu))}
          colorize="cpu"
        />
        <TopCard
          title="Top Memory"
          rows={topMem}
          unit=" MB"
          field="memory"
          max={Math.max(1, ...topMem.map((p) => p.memory))}
          colorize="mem"
        />
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  unit,
  accentClass,
  children,
}: {
  label: string;
  value: string;
  unit: string;
  accentClass?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4 shadow-sm">
      <div className="text-[10px] font-medium uppercase text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span
          className={cn(
            'font-mono text-3xl font-semibold tabular-nums',
            accentClass
          )}
        >
          {value}
        </span>
        <span className="text-xs text-muted-foreground">{unit}</span>
      </div>
      {children}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between rounded-md bg-surface-soft px-2 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function countByType(processes: ProcessRow[], type: string) {
  return processes.filter((p) => p.type === type).length;
}

function countOther(processes: ProcessRow[]) {
  return processes.filter((p) => p.type !== 'Utility').length;
}

function TopCard({
  title,
  rows,
  unit,
  field,
  max,
  colorize,
}: {
  title: string;
  rows: ProcessRow[];
  unit: string;
  field: 'cpu' | 'memory';
  max: number;
  colorize: 'cpu' | 'mem';
}) {
  return (
    <div className="rounded-md border border-border bg-card p-4 shadow-sm">
      <div className="mb-3 text-[10px] font-medium uppercase text-muted-foreground">
        {title}
      </div>
      <ul className="space-y-2.5">
        {rows.length === 0 && (
          <li className="text-xs text-muted-foreground">No data.</li>
        )}
        {rows.map((p) => {
          const v = p[field];
          const ratio = Math.min(1, max > 0 ? v / max : 0);
          return (
            <li key={`${String(p.pid)}-${p.name ?? p.type}`} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="truncate text-foreground"
                    title={p.name ?? p.type}
                  >
                    {p.name ?? p.type}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    [{p.pid}]
                  </span>
                </span>
                <span className="font-mono tabular-nums text-foreground">
                  {v.toFixed(field === 'cpu' ? 2 : 1)}
                  {unit}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-soft">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    colorize === 'cpu' ? barColorCpu(v) : 'bg-sky-500'
                  )}
                  style={{ width: `${String(ratio * 100)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function barColorCpu(v: number) {
  if (v >= 70) return 'bg-rose-500';
  if (v >= 30) return 'bg-amber-500';
  return 'bg-emerald-500';
}

function Footer({ snapshot }: { snapshot: MonitorSnapshot | null }) {
  return (
    <footer className="flex items-center gap-5 border-t border-border bg-card/70 px-5 py-2 text-[11px] backdrop-blur">
      <FooterStat
        label="CPU"
        value={snapshot ? `${snapshot.totals.cpu.toFixed(1)}%` : '—'}
      />
      <FooterStat
        label="Mem"
        value={
          snapshot ? `${snapshot.totals.memory.toFixed(0)} MB` : '—'
        }
      />
      <FooterStat
        label="Procs"
        value={snapshot ? String(snapshot.processes.length) : '—'}
      />
      <span className="ml-auto text-muted-foreground">
        {snapshot
          ? `snapshot @ ${new Date(snapshot.timestamp).toLocaleTimeString()}`
          : ''}
      </span>
    </footer>
  );
}

function FooterStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-foreground">{value}</span>
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-3 h-8 w-8 animate-pulse rounded-full bg-sky-500/20" />
        <p className="text-sm text-foreground">Waiting for first snapshot…</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Waiting for monitor-pagelet connection…
        </p>
      </div>
    </div>
  );
}
