import React, { useMemo, useState } from 'react'
import { cn } from '@telegraph/ui/lib/utils'
import type { ProcessRow } from '@telegraph/services/connection-orchestrator/common/types'

type SortKey = 'pid' | 'name' | 'type' | 'cpu' | 'memory'
type SortDir = 'asc' | 'desc'

interface ProcessesTableProps {
  processes: ProcessRow[]
  query: string
}

const numericKeys: SortKey[] = ['pid', 'cpu', 'memory']

export function ProcessesTable({ processes, query }: ProcessesTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('cpu')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return processes
    return processes.filter(
      (p) =>
        String(p.pid).includes(q) ||
        (p.name ?? '').toLowerCase().includes(q) ||
        p.type.toLowerCase().includes(q),
    )
  }, [processes, query])

  const sorted = useMemo(() => {
    const arr = filtered.slice()
    arr.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      let cmp: number
      if (numericKeys.includes(sortKey)) {
        cmp = (Number(av) || 0) - (Number(bv) || 0)
      } else {
        cmp = String(av ?? '').localeCompare(String(bv ?? ''))
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [filtered, sortKey, sortDir])

  const onHeaderClick = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(numericKeys.includes(key) ? 'desc' : 'asc')
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-900/30">
      <table className="w-full text-[12px]">
        <thead className="sticky top-0 z-10 border-b border-zinc-800/80 bg-zinc-900/80 backdrop-blur">
          <tr>
            <SortableHead label="Type" sortKey="type" active={sortKey} dir={sortDir} onClick={onHeaderClick} />
            <SortableHead label="Name" sortKey="name" active={sortKey} dir={sortDir} onClick={onHeaderClick} />
            <SortableHead label="PID" sortKey="pid" active={sortKey} dir={sortDir} onClick={onHeaderClick} align="right" />
            <SortableHead label="CPU%" sortKey="cpu" active={sortKey} dir={sortDir} onClick={onHeaderClick} align="right" />
            <SortableHead label="Mem MB" sortKey="memory" active={sortKey} dir={sortDir} onClick={onHeaderClick} align="right" />
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={5} className="py-10 text-center text-zinc-500">
                No processes match.
              </td>
            </tr>
          )}
          {sorted.map((p, i) => (
            <tr
              key={p.pid}
              className={cn(
                'border-b border-zinc-800/40 transition-colors hover:bg-zinc-800/40',
                i % 2 === 1 && 'bg-zinc-900/20',
              )}
            >
              <td className="px-3 py-1.5">
                <span className="inline-flex rounded border border-zinc-700/80 bg-zinc-800/50 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">
                  {p.type}
                </span>
              </td>
              <td className="max-w-[220px] truncate px-3 py-1.5 text-zinc-200" title={p.name ?? ''}>
                {p.name ?? '—'}
              </td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-zinc-500">
                {p.pid}
              </td>
              <td className={cn('px-3 py-1.5 text-right font-mono tabular-nums', cpuTextClass(p.cpu))}>
                {p.cpu.toFixed(2)}
              </td>
              <td className="px-3 py-1.5 text-right font-mono tabular-nums text-zinc-200">
                {p.memory.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SortableHead({
  label,
  sortKey,
  active,
  dir,
  onClick,
  align = 'left',
}: {
  label: string
  sortKey: SortKey
  active: SortKey
  dir: SortDir
  onClick: (key: SortKey) => void
  align?: 'left' | 'right'
}) {
  const isActive = active === sortKey
  return (
    <th className={cn('px-3 py-2', align === 'right' && 'text-right')}>
      <button
        type="button"
        onClick={() => { onClick(sortKey); }}
        className={cn(
          'inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] transition-colors',
          isActive ? 'text-sky-300' : 'text-zinc-500 hover:text-zinc-300',
        )}
      >
        <span>{label}</span>
        <SortIcon active={isActive} dir={dir} />
      </button>
    </th>
  )
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) {
    return (
      <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 opacity-50" fill="currentColor">
        <path d="M6 2 L9 5 H3 Z" opacity={0.5} />
        <path d="M6 10 L9 7 H3 Z" opacity={0.5} />
      </svg>
    )
  }
  if (dir === 'asc') {
    return (
      <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="currentColor">
        <path d="M6 3 L10 8 H2 Z" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="currentColor">
      <path d="M6 9 L10 4 H2 Z" />
    </svg>
  )
}

function cpuTextClass(v: number) {
  if (v >= 50) return 'text-rose-400'
  if (v >= 15) return 'text-amber-400'
  return 'text-zinc-200'
}
