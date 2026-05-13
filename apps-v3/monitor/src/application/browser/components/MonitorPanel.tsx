import React, { useMemo, useState } from 'react';
import { ProcessesTable } from './ProcessesTable';
import { Sparkline, cpuColorClass } from './Sparkline';
import { useMonitorSnapshots, useNowTick, useSnapshotHistory } from '../hooks';
import { MonitorSnapshot, ProcessRow } from '@telegraph/monitor/application/common';
import { cn } from '@telegraph/ui/lib/utils';

type TabId = 'overview' | 'processes';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'processes', label: 'Processes' },
];

export function MonitorPanel() {
  const { snapshot, updatedAt } = useMonitorSnapshots();
  const history = useSnapshotHistory(snapshot, 60);
  useNowTick(1000);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<TabId>('overview');

  const cpuSeries = useMemo(
    () => history.map((h) => h.totals?.cpu ?? 0),
    [history]
  );
  const memSeries = useMemo(
    () => history.map((h) => h.totals?.memory ?? 0),
    [history]
  );

  return (
    <div className="flex h-full w-full flex-col bg-zinc-950 text-zinc-100">
      <Header
        query={query}
        setQuery={setQuery}
        snapshot={snapshot}
        updatedAt={updatedAt}
      />

      <div className="flex items-center gap-1 border-b border-zinc-800/80 bg-zinc-900/40 px-5 py-1.5">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'rounded px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                active
                  ? 'bg-zinc-700/80 text-zinc-50 shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-200'
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
        ) : (
          <div className="h-full overflow-auto px-3 pb-3">
            <ProcessesTable processes={snapshot.processes} query={query} />
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
    <header className="flex items-center justify-between gap-3 border-b border-zinc-800/80 bg-zinc-900/40 px-5 py-3">
      <div className="flex items-baseline gap-3">
        <h1 className="text-base font-semibold tracking-tight text-zinc-100">
          Monitor
        </h1>
        <span className="text-[11px] text-zinc-500">
          {snapshot?.processes
            ? `${snapshot.processes.length} processes`
            : 'connecting…'}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-[11px] tabular-nums text-zinc-500">
          {ago != null ? `updated ${ago}s ago` : ''}
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
        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search processes…"
        className="h-7 w-full rounded-md border border-zinc-800 bg-zinc-900/60 pl-7 pr-2 text-[12px] text-zinc-100 placeholder:text-zinc-500 focus:border-sky-500/60 focus:outline-none focus:ring-1 focus:ring-sky-500/40"
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
      (snapshot.processes ?? [])
        .slice()
        .sort((a, b) => b.cpu - a.cpu)
        .slice(0, 5),
    [snapshot.processes]
  );
  const topMem = useMemo(
    () =>
      (snapshot.processes ?? [])
        .slice()
        .sort((a, b) => b.memory - a.memory)
        .slice(0, 5),
    [snapshot.processes]
  );
  const memMax = Math.max(1, ...memSeries);
  const cpuColor = cpuColorClass(snapshot.totals?.cpu ?? 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-4">
        <StatCard
          label="CPU"
          value={(snapshot.totals?.cpu ?? 0).toFixed(1)}
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
          value={(snapshot.totals?.memory ?? 0).toFixed(0)}
          unit="MB"
          accentClass="text-sky-400"
        >
          <div className="mt-3 text-sky-400">
            <Sparkline values={memSeries} max={memMax} height={56} />
          </div>
        </StatCard>
        <StatCard
          label="Processes"
          value={String((snapshot.processes ?? []).length)}
          unit="active"
          accentClass="text-zinc-100"
        >
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-zinc-400">
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
    <div className="rounded-2xl border border-zinc-800/80 bg-gradient-to-b from-zinc-900/80 to-zinc-900/40 p-4 shadow-sm">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
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
        <span className="text-xs text-zinc-500">{unit}</span>
      </div>
      {children}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between rounded-md bg-zinc-800/40 px-2 py-1">
      <span className="text-zinc-500">{label}</span>
      <span className="font-mono tabular-nums text-zinc-200">{value}</span>
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
    <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-4 shadow-sm">
      <div className="mb-3 text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
        {title}
      </div>
      <ul className="space-y-2.5">
        {rows.length === 0 && (
          <li className="text-xs text-zinc-500">No data.</li>
        )}
        {rows.map((p) => {
          const v = p[field];
          const ratio = Math.min(1, max > 0 ? v / max : 0);
          return (
            <li key={`${p.pid}-${p.name}`} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className="truncate text-zinc-200"
                    title={p.name ?? p.type}
                  >
                    {p.name ?? p.type}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                    [{p.pid}]
                  </span>
                </span>
                <span className="font-mono tabular-nums text-zinc-300">
                  {v.toFixed(field === 'cpu' ? 2 : 1)}
                  {unit}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800/70">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    colorize === 'cpu' ? barColorCpu(v) : 'bg-sky-500'
                  )}
                  style={{ width: `${ratio * 100}%` }}
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
    <footer className="flex items-center gap-5 border-t border-zinc-800/80 bg-zinc-950/80 px-5 py-2 text-[11px] backdrop-blur">
      <FooterStat
        label="CPU"
        value={snapshot ? `${(snapshot.totals?.cpu ?? 0).toFixed(1)}%` : '—'}
      />
      <FooterStat
        label="Mem"
        value={
          snapshot ? `${(snapshot.totals?.memory ?? 0).toFixed(0)} MB` : '—'
        }
      />
      <FooterStat
        label="Procs"
        value={snapshot ? String((snapshot.processes ?? []).length) : '—'}
      />
      <span className="ml-auto text-zinc-500">
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
      <span className="text-zinc-500">{label}</span>
      <span className="font-mono tabular-nums text-zinc-200">{value}</span>
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-3 h-8 w-8 animate-pulse rounded-full bg-sky-500/20" />
        <p className="text-sm text-zinc-300">Waiting for first snapshot…</p>
        <p className="mt-1 text-[11px] text-zinc-500">
          Waiting for monitor-pagelet connection…
        </p>
      </div>
    </div>
  );
}
