// Phase 4 — design pagelet's "Connections" tab.
//
// End-to-end exercise of the renderer ↔ utility direct channels for ALL
// spawned participants: design, shared, and daemon.
//
//   1. Polls `inspector.getTopology()` every second for live participant /
//      connection state.
//   2. "Connect" buttons trigger `inspector.requestConnect('renderer:main',
//      <participantId>)` for each utility.
//   3. After Connect resolves, "Ping" calls the service via
//      `window.telegraph.<service>.ping(now)`, round-tripping through
//      the preload's direct MessagePort channel.
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';

import { getInspectorClient } from '@telegraph/services/connection-orchestrator/browser/inspectorClient';
import {
  DAEMON_PARTICIPANT_ID,
  DESIGN_PARTICIPANT_ID,
  SHARED_PARTICIPANT_ID,
} from '@telegraph/services/connection-orchestrator/common/types';
import type {
  ConnectionSnapshot,
  TopologySnapshot,
} from '@telegraph/services/connection-orchestrator/common/types';

const RENDERER_PARTICIPANT_ID = 'renderer:main';
const POLL_INTERVAL_MS = 1000;

interface PingResult {
  rttMs: number;
  serverTime: number;
  at: number;
}

interface ParticipantRow {
  id: string;
  label: string;
  serviceKey: 'designService' | 'sharedService' | 'daemonService';
}

const PARTICIPANTS: ParticipantRow[] = [
  { id: DESIGN_PARTICIPANT_ID, label: 'Design', serviceKey: 'designService' },
  { id: SHARED_PARTICIPANT_ID, label: 'Shared', serviceKey: 'sharedService' },
  { id: DAEMON_PARTICIPANT_ID, label: 'Daemon', serviceKey: 'daemonService' },
];

function isReady(topology: TopologySnapshot | undefined, participantId: string): boolean {
  if (!topology) return false;
  return !!topology.connections.find(
    (c) =>
      c.state === 'READY' &&
      ((c.fromId === RENDERER_PARTICIPANT_ID && c.toId === participantId) ||
        (c.toId === RENDERER_PARTICIPANT_ID && c.fromId === participantId)),
  );
}

interface TreeNode {
  id: string;
  type: string;
  registeredAt: number;
  children: TreeNode[];
  conn?: ConnectionSnapshot;
}

function buildTree(topology: TopologySnapshot): TreeNode {
  // Build a structural hierarchy: renderer is root, all other participants
  // are children. Connection state is attached to the child edge.
  const connMap = new Map<string, ConnectionSnapshot>();
  for (const conn of topology.connections) {
    connMap.set(conn.toId, conn);
    connMap.set(conn.fromId, conn);
  }

  const renderer = topology.participants.find((p) => p.id === RENDERER_PARTICIPANT_ID);
  const root: TreeNode = renderer
    ? { id: renderer.id, type: renderer.type, registeredAt: renderer.registeredAt, children: [] }
    : { id: RENDERER_PARTICIPANT_ID, type: 'renderer', registeredAt: 0, children: [] };

  for (const p of topology.participants) {
    if (p.id === RENDERER_PARTICIPANT_ID) continue;
    root.children.push({
      id: p.id,
      type: p.type,
      registeredAt: p.registeredAt,
      children: [],
      conn: connMap.get(p.id),
    });
  }

  return root;
}

function stateColor(state: string): string {
  if (state === 'READY') return '#0a3';
  if (state === 'CONNECTING' || state === 'RECONNECTING') return '#aa0';
  if (state === 'FAILED' || state === 'CLOSED') return '#a33';
  return '#555';
}

function TreeRow({ node, depth, isLast }: { node: TreeNode; depth: number; isLast: boolean }): JSX.Element {
  const indent = depth * 20;
  const hasChildren = node.children.length > 0;
  const prefix = depth === 0 ? '●' : isLast ? '└─' : '├─';

  return (
    <>
      <div style={{ ...treeRowStyle, paddingLeft: indent }}>
        <span style={treeGlyphStyle}>{prefix}</span>
        <code style={treeIdStyle}>{node.id}</code>
        <span style={treeTypeStyle}>{node.type}</span>
        {depth > 0 && node.conn && (
          <span
            style={{
              ...stateBadgeStyle,
              background: stateColor(node.conn.state),
            }}
          >
            {node.conn.state}
          </span>
        )}
        {depth > 0 && !node.conn && (
          <span style={{ ...stateBadgeStyle, background: '#333' }}>IDLE</span>
        )}
        {node.conn?.errorMessage && (
          <span style={treeErrorStyle}>{node.conn.errorMessage}</span>
        )}
      </div>
      {hasChildren &&
        node.children.map((child, i) => (
          <TreeRow
            key={child.id}
            node={child}
            depth={depth + 1}
            isLast={i === node.children.length - 1}
          />
        ))}
    </>
  );
}

function TopologyTree({ topology }: { topology: TopologySnapshot }): JSX.Element {
  const root = buildTree(topology);
  return (
    <div style={treeContainerStyle}>
      <TreeRow node={root} depth={0} isLast />
    </div>
  );
}

export function ConnectionsTab(): JSX.Element {
  const [topology, setTopology] = useState<TopologySnapshot | undefined>();
  const [topologyError, setTopologyError] = useState<string | undefined>();

  const [connectingId, setConnectingId] = useState<string | undefined>();
  const [connectErrors, setConnectErrors] = useState<Record<string, string>>({});
  const [connectionIds, setConnectionIds] = useState<Record<string, string>>({});

  const [pingingId, setPingingId] = useState<string | undefined>();
  const [pingErrors, setPingErrors] = useState<Record<string, string>>({});
  const [pingResults, setPingResults] = useState<Record<string, PingResult>>({});

  useEffect(() => {
    let cancelled = false;
    const inspector = getInspectorClient();

    const poll = (): void => {
      inspector
        .getTopology()
        .then((snap) => {
          if (cancelled) return;
          setTopology(snap);
          setTopologyError(undefined);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setTopologyError(err instanceof Error ? err.message : String(err));
        });
    };

    poll();
    const handle = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, []);

  const onConnect = useCallback((participantId: string) => {
    setConnectingId(participantId);
    setConnectErrors((prev) => { const next = { ...prev }; delete next[participantId]; return next; });
    // Preload needs to know which participant this port is for BEFORE the
    // orchestrator delivers the activated MessagePort, so it can route the
    // port to the correct direct channel.
    window.telegraph.enqueueConnect(participantId);
    const inspector = getInspectorClient();
    inspector
      .requestConnect(RENDERER_PARTICIPANT_ID, participantId)
      .then((result) => {
        setConnectionIds((prev) => ({ ...prev, [participantId]: result.connectionId }));
      })
      .catch((err: unknown) => {
        setConnectErrors((prev) => ({ ...prev, [participantId]: err instanceof Error ? err.message : String(err) }));
      })
      .finally(() => {
        setConnectingId(undefined);
      });
  }, []);

  const onPing = useCallback((participantId: string, serviceKey: ParticipantRow['serviceKey']) => {
    setPingingId(participantId);
    setPingErrors((prev) => { const next = { ...prev }; delete next[participantId]; return next; });
    const start = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    (window.telegraph as any)[serviceKey]
      .ping(start)
      .then(({ pong, serverTime }: { pong: number; serverTime: number }) => {
        const finish = Date.now();
        if (pong !== start) {
          throw new Error(`ping echo mismatch: sent ${String(start)}, got ${String(pong)}`);
        }
        setPingResults((prev) => ({ ...prev, [participantId]: { rttMs: finish - start, serverTime, at: finish } }));
      })
      .catch((err: unknown) => {
        setPingErrors((prev) => ({ ...prev, [participantId]: err instanceof Error ? err.message : String(err) }));
      })
      .finally(() => {
        setPingingId(undefined);
      });
  }, []);

  const onGetAppInfo = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    (window.telegraph as any).sharedService
      .getAppInfo()
      .then((info: { name: string; version: string }) => {
        setPingResults((prev) => ({
          ...prev,
          [SHARED_PARTICIPANT_ID]: {
            rttMs: prev[SHARED_PARTICIPANT_ID]?.rttMs ?? -1,
            serverTime: Date.now(),
            at: Date.now(),
          },
        }));
        window.alert(`AppInfo: ${info.name} v${info.version}`);
      })
      .catch((err: unknown) => {
        setPingErrors((prev) => ({ ...prev, [SHARED_PARTICIPANT_ID]: err instanceof Error ? err.message : String(err) }));
      });
  }, []);

  const onGetProcessStatus = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    (window.telegraph as any).daemonService
      .getProcessStatus()
      .then((status: { shared: string; pagelets: string[] }) => {
        window.alert(`ProcessStatus: shared=${status.shared}, pagelets=${status.pagelets.join(', ')}`);
      })
      .catch((err: unknown) => {
        setPingErrors((prev) => ({ ...prev, [DAEMON_PARTICIPANT_ID]: err instanceof Error ? err.message : String(err) }));
      });
  }, []);

  return (
    <section style={sectionStyle}>
      <h2 style={h2Style}>Connections</h2>

      {PARTICIPANTS.map((p) => {
        const ready = isReady(topology, p.id);
        const connecting = connectingId === p.id;
        const pinging = pingingId === p.id;
        const connId = connectionIds[p.id];
        const connectErr = connectErrors[p.id];
        const pingErr = pingErrors[p.id];
        const pingRes = pingResults[p.id];

        return (
          <div key={p.id} style={cardStyle}>
            <h3 style={h3Style}>{p.label} <code style={idCodeStyle}>{p.id}</code></h3>
            <div style={controlsRowStyle}>
              <button
                type="button"
                onClick={() => onConnect(p.id)}
                disabled={connecting || ready}
                style={buttonStyle}
              >
                {ready ? 'Connected' : connecting ? 'Connecting…' : `Connect → ${p.id}`}
              </button>
              <button
                type="button"
                onClick={() => onPing(p.id, p.serviceKey)}
                disabled={!ready || pinging}
                style={buttonStyle}
              >
                {pinging ? 'Pinging…' : 'Ping'}
              </button>
              {p.id === SHARED_PARTICIPANT_ID && (
                <button type="button" onClick={onGetAppInfo} disabled={!ready} style={buttonStyle}>
                  AppInfo
                </button>
              )}
              {p.id === DAEMON_PARTICIPANT_ID && (
                <button type="button" onClick={onGetProcessStatus} disabled={!ready} style={buttonStyle}>
                  Status
                </button>
              )}
            </div>
            {connId && <p style={metaStyle}>connectionId: <code>{connId}</code></p>}
            {connectErr && <pre style={errorStyle}>connect: {connectErr}</pre>}
            {pingErr && <pre style={errorStyle}>ping: {pingErr}</pre>}
            {pingRes && (
              <p style={metaStyle}>
                rtt: <strong>{String(pingRes.rttMs)}ms</strong> · serverTime:{' '}
                {new Date(pingRes.serverTime).toISOString()}
              </p>
            )}
          </div>
        );
      })}

      <h3 style={h3Style}>Topology</h3>
      {topology ? (
        <TopologyTree topology={topology} />
      ) : (
        <p style={mutedStyle}>loading…</p>
      )}

      {topologyError && (
        <pre style={errorStyle}>topology error: {topologyError}</pre>
      )}
    </section>
  );
}

// ----- styles ---------------------------------------------------------------

const sectionStyle: React.CSSProperties = {
  marginTop: 24,
};

const h2Style: React.CSSProperties = { fontSize: 18, margin: '0 0 12px' };
const h3Style: React.CSSProperties = { fontSize: 14, margin: '20px 0 8px', opacity: 0.8 };

const cardStyle: React.CSSProperties = {
  background: '#1a1a1a',
  borderRadius: 6,
  padding: 12,
  marginBottom: 12,
};

const idCodeStyle: React.CSSProperties = { fontSize: 11, opacity: 0.6 };

const controlsRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  marginBottom: 8,
};

const buttonStyle: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 13,
  border: '1px solid #444',
  borderRadius: 4,
  background: '#222',
  color: '#eee',
  cursor: 'pointer',
};

const metaStyle: React.CSSProperties = {
  fontSize: 12,
  opacity: 0.85,
  margin: '4px 0',
};

const mutedStyle: React.CSSProperties = { opacity: 0.5, fontSize: 12 };

const errorStyle: React.CSSProperties = {
  color: '#c33',
  whiteSpace: 'pre-wrap',
  fontSize: 12,
  background: '#220',
  padding: 8,
  borderRadius: 4,
};

const stateBadgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 6px',
  borderRadius: 3,
  color: '#fff',
  fontSize: 11,
  marginLeft: 6,
};

const treeContainerStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontSize: 12,
  lineHeight: '24px',
  padding: '8px 0',
};

const treeRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  whiteSpace: 'nowrap',
};

const treeGlyphStyle: React.CSSProperties = {
  color: '#555',
  width: 20,
  textAlign: 'center',
  flexShrink: 0,
};

const treeIdStyle: React.CSSProperties = {
  color: '#9cdcfe',
  fontSize: 12,
};

const treeTypeStyle: React.CSSProperties = {
  color: '#555',
  fontSize: 10,
  marginLeft: 6,
  fontStyle: 'italic',
};

const treeErrorStyle: React.CSSProperties = {
  color: '#c33',
  fontSize: 10,
  marginLeft: 6,
};
