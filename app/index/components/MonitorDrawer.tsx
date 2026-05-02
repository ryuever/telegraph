import React, { useEffect, useState } from 'react'
import {
  MONITOR_SNAPSHOT_CHANNEL,
} from '@app/services/monitor/common/config'
import type {
  MonitorSnapshot,
  PidTreeJson,
} from '@app/services/monitor/common/types'

interface Props {
  open: boolean
}

export function MonitorDrawer({ open }: Props) {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)

  useEffect(() => {
    const bridge = (window as any).redcity?.ipcRenderer
    if (!bridge?.on) return

    const listener = (_event: unknown, payload: MonitorSnapshot) => {
      setSnapshot(payload)
      setUpdatedAt(Date.now())
    }

    bridge.on(MONITOR_SNAPSHOT_CHANNEL, listener)
    return () => {
      bridge.removeListener?.(MONITOR_SNAPSHOT_CHANNEL, listener)
    }
  }, [])

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        height: '100vh',
        width: 420,
        background: 'rgba(15, 15, 18, 0.95)',
        color: 'white',
        boxShadow: '-4px 0 20px rgba(0,0,0,0.4)',
        transform: open ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 240ms ease',
        overflowY: 'auto',
        padding: 16,
        fontSize: 12,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        zIndex: 50,
      }}
    >
      <h3 style={{ margin: '0 0 12px', fontSize: 14, letterSpacing: 0.4 }}>
        📊 Monitor
      </h3>

      {!snapshot && (
        <p style={{ opacity: 0.7 }}>Waiting for first snapshot from daemon (≤ 5 s)…</p>
      )}

      {snapshot && (
        <>
          <Totals snapshot={snapshot} updatedAt={updatedAt} />
          <ProcessTable snapshot={snapshot} />
          <PsTree tree={snapshot.pidTree} />
        </>
      )}
    </div>
  )
}

function Totals({
  snapshot,
  updatedAt,
}: {
  snapshot: MonitorSnapshot
  updatedAt: number | null
}) {
  const ago = updatedAt ? Math.round((Date.now() - updatedAt) / 1000) : null
  return (
    <div style={{ marginBottom: 14, opacity: 0.95 }}>
      <div>
        <strong>CPU</strong> {snapshot.totals.cpu.toFixed(2)}% &nbsp;·&nbsp;{' '}
        <strong>Memory</strong> {snapshot.totals.memory.toFixed(2)} MB
      </div>
      <div style={{ opacity: 0.5, marginTop: 2 }}>
        snapshot @ {new Date(snapshot.timestamp).toLocaleTimeString()}
        {ago != null ? ` (${ago}s ago)` : ''}
      </div>
    </div>
  )
}

function ProcessTable({ snapshot }: { snapshot: MonitorSnapshot }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <h4 style={{ margin: '8px 0', fontSize: 12, opacity: 0.75 }}>
        Electron processes
      </h4>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', opacity: 0.6 }}>
            <th style={th}>type</th>
            <th style={th}>name</th>
            <th style={{ ...th, textAlign: 'right' }}>pid</th>
            <th style={{ ...th, textAlign: 'right' }}>cpu%</th>
            <th style={{ ...th, textAlign: 'right' }}>mem MB</th>
          </tr>
        </thead>
        <tbody>
          {snapshot.processes.map(p => (
            <tr key={p.pid} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <td style={td}>{p.type}</td>
              <td style={td}>{p.name ?? '—'}</td>
              <td style={{ ...td, textAlign: 'right' }}>{p.pid}</td>
              <td style={{ ...td, textAlign: 'right' }}>{p.cpu.toFixed(2)}</td>
              <td style={{ ...td, textAlign: 'right' }}>{p.memory.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PsTree({ tree }: { tree: PidTreeJson | null }) {
  if (!tree) {
    return (
      <div style={{ opacity: 0.5 }}>
        <em>ps tree unavailable</em>
      </div>
    )
  }
  return (
    <div>
      <h4 style={{ margin: '8px 0', fontSize: 12, opacity: 0.75 }}>
        ps tree (rooted at main pid)
      </h4>
      <PsNode node={tree} depth={0} />
    </div>
  )
}

function PsNode({ node, depth }: { node: PidTreeJson; depth: number }) {
  const [expanded, setExpanded] = useState(depth < 2)
  const hasChildren = node.children.length > 0
  const pad = depth * 12
  return (
    <div style={{ paddingLeft: pad }}>
      <div
        onClick={() => hasChildren && setExpanded(v => !v)}
        style={{
          cursor: hasChildren ? 'pointer' : 'default',
          padding: '2px 0',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 11,
          opacity: 0.92,
        }}
      >
        <span style={{ display: 'inline-block', width: 12, opacity: 0.55 }}>
          {hasChildren ? (expanded ? '▾' : '▸') : ''}
        </span>
        <span style={{ opacity: 0.7 }}>[{node.pid}]</span>{' '}
        <span style={{ opacity: 0.55 }}>
          cpu {node.cpu}% mem {node.mem}%
        </span>{' '}
        <span>{shortenCommand(node.command)}</span>
      </div>
      {expanded &&
        node.children.map(c => <PsNode key={c.pid} node={c} depth={depth + 1} />)}
    </div>
  )
}

function shortenCommand(cmd: string) {
  if (cmd.length <= 80) return cmd
  return `${cmd.slice(0, 77)}…`
}

const th: React.CSSProperties = {
  padding: '4px 6px',
  fontWeight: 500,
}
const td: React.CSSProperties = {
  padding: '4px 6px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
}
