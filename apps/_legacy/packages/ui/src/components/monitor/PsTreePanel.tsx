import React, { useState } from 'react'
import { cn } from '@telegraph/ui/lib/utils'
import type { PidTreeJson } from '@telegraph/services/monitor/common/types'

interface PsTreePanelProps {
  tree: PidTreeJson | null
  query: string
}

export function PsTreePanel({ tree, query }: PsTreePanelProps) {
  if (!tree) {
    return (
      <div className="px-4 py-10 text-center text-zinc-500">
        ps tree unavailable
      </div>
    )
  }
  const q = query.trim().toLowerCase()
  const visible = q ? filterTree(tree, q) : tree
  if (!visible) {
    return (
      <div className="px-4 py-10 text-center text-zinc-500">
        No nodes match.
      </div>
    )
  }
  return (
    <div className="mx-3 my-2 rounded-xl border border-zinc-800/80 bg-zinc-900/30 px-2 py-2 font-mono text-[11px]">
      <PsNode node={visible} depth={0} highlight={q} />
    </div>
  )
}

function filterTree(node: PidTreeJson, q: string): PidTreeJson | null {
  const childMatches = node.children
    .map(child => filterTree(child, q))
    .filter((n): n is PidTreeJson => n != null)
  const selfMatches =
    node.command.toLowerCase().includes(q) || node.pid.includes(q)
  if (!selfMatches && childMatches.length === 0) return null
  return { ...node, children: childMatches }
}

function PsNode({
  node,
  depth,
  highlight,
}: {
  node: PidTreeJson
  depth: number
  highlight: string
}) {
  const [expanded, setExpanded] = useState(depth < 2)
  const hasChildren = node.children.length > 0
  const cpu = Number(node.cpu)
  const cpuClass =
    Number.isFinite(cpu) && cpu >= 30
      ? 'text-amber-400'
      : Number.isFinite(cpu) && cpu >= 70
        ? 'text-rose-400'
        : 'text-zinc-500'
  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-2 rounded px-1.5 py-[3px] hover:bg-zinc-800/40',
          hasChildren && 'cursor-pointer'
        )}
        style={{ paddingLeft: depth * 14 + 6 }}
        onClick={() => hasChildren && setExpanded(v => !v)}
      >
        <span className="inline-flex w-3 justify-center text-zinc-500">
          {hasChildren ? <Chevron open={expanded} /> : <span className="inline-block size-3" />}
        </span>
        <span className="w-14 shrink-0 tabular-nums text-zinc-500">[{node.pid}]</span>
        <span className={cn('w-16 shrink-0 tabular-nums', cpuClass)}>cpu {node.cpu}%</span>
        <span className="w-16 shrink-0 tabular-nums text-zinc-500">mem {node.mem}%</span>
        <span className="truncate text-zinc-200" title={node.command}>
          {shortenCommand(node.command, highlight)}
        </span>
      </div>
      {expanded &&
        node.children.map(c => (
          <PsNode key={c.pid} node={c} depth={depth + 1} highlight={highlight} />
        ))}
    </div>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      className={cn('h-3 w-3 transition-transform', open && 'rotate-90')}
      fill="currentColor"
    >
      <path d="M4 2 L8 6 L4 10 Z" />
    </svg>
  )
}

function shortenCommand(cmd: string, _q: string) {
  if (cmd.length <= 90) return cmd
  return `${cmd.slice(0, 87)}…`
}
