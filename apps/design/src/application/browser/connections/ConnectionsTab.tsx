// Phase 4 — design pagelet's "Connections" tab.
//
// First end-to-end exercise of the renderer ↔ design direct channel:
//
//   1. Polls `inspector.getTopology()` every second for live participant /
//      connection state (read-only mirror of `AppOrchestrator`).
//   2. "Connect" button triggers `inspector.requestConnect('renderer:main',
//      DESIGN_PARTICIPANT_ID)` which flows through main's
//      `OrchestratorInspectorService → AppOrchestrator.requestConnect →
//      BaseConnectionOrchestrator.connect`. On READY, both endpoints have a
//      `MessagePort` bound to a direct channel.
//   3. After Connect resolves, "Ping" calls
//      `awaitDirectChannelClient<IDesignService>(DESIGN_SERVICE_PATH).ping(now)`
//      which round-trips through the renderer's `RPCMessageChannel` →
//      MessagePort → utility's `ElectronMessagePortMainChannel` →
//      `RPCServiceHost` → `DesignService.ping`. RTT printed inline.
//
// Inline styles only — Phase 4 explicitly defers shadcn/tailwind (see roadmap
// rationale: keep the first cross-process verification surface as small as
// possible).
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';

import { getInspectorClient } from '@telegraph/services/connection-orchestrator/browser/inspectorClient';
import {
  DESIGN_PARTICIPANT_ID,
} from '@telegraph/services/connection-orchestrator/common/types';
import type {
  TopologySnapshot,
} from '@telegraph/services/connection-orchestrator/common/types';

const RENDERER_PARTICIPANT_ID = 'renderer:main';
const POLL_INTERVAL_MS = 1000;

interface PingResult {
  rttMs: number;
  serverTime: number;
  at: number;
}

export function ConnectionsTab(): JSX.Element {
  const [topology, setTopology] = useState<TopologySnapshot | undefined>();
  const [topologyError, setTopologyError] = useState<string | undefined>();

  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | undefined>();
  const [connectionId, setConnectionId] = useState<string | undefined>();

  const [pinging, setPinging] = useState(false);
  const [pingError, setPingError] = useState<string | undefined>();
  const [pingResult, setPingResult] = useState<PingResult | undefined>();

  // Poll topology. `inspector.getTopology()` is cheap (it's an in-memory
  // snapshot of two Maps); 1 Hz is plenty for a debug surface and avoids
  // hammering the cp channel.
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

  const onConnect = useCallback(() => {
    setConnecting(true);
    setConnectError(undefined);
    const inspector = getInspectorClient();
    inspector
      .requestConnect(RENDERER_PARTICIPANT_ID, DESIGN_PARTICIPANT_ID)
      .then((result) => {
        setConnectionId(result.connectionId);
      })
      .catch((err: unknown) => {
        setConnectError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setConnecting(false);
      });
  }, []);

  const onPing = useCallback(() => {
    setPinging(true);
    setPingError(undefined);
    const start = Date.now();
    // The design direct channel lives entirely in the preload (port cannot
    // safely cross contextBridge). Call the bridge surface instead of the
    // renderer-side awaitDirectChannelClient.
    window.telegraph.designService
      .ping(start)
      .then(({ pong, serverTime }) => {
        const finish = Date.now();
        // Sanity guard: pong should equal what we sent. If not, surface as
        // an error — protocol drift is louder than a misleading RTT.
        if (pong !== start) {
          throw new Error(
            `ping echo mismatch: sent ${String(start)}, got ${String(pong)}`,
          );
        }
        setPingResult({ rttMs: finish - start, serverTime, at: finish });
      })
      .catch((err: unknown) => {
        setPingError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setPinging(false);
      });
  }, []);

  const designReady = !!topology?.connections.find(
    (c) =>
      c.state === 'READY' &&
      ((c.fromId === RENDERER_PARTICIPANT_ID && c.toId === DESIGN_PARTICIPANT_ID) ||
        (c.toId === RENDERER_PARTICIPANT_ID && c.fromId === DESIGN_PARTICIPANT_ID)),
  );

  return (
    <section style={sectionStyle}>
      <h2 style={h2Style}>Connections</h2>
      <div style={controlsRowStyle}>
        <button
          type="button"
          onClick={onConnect}
          disabled={connecting || designReady}
          style={buttonStyle}
        >
          {designReady
            ? 'Connected'
            : connecting
              ? 'Connecting…'
              : `Connect → ${DESIGN_PARTICIPANT_ID}`}
        </button>
        <button
          type="button"
          onClick={onPing}
          disabled={!designReady || pinging}
          style={buttonStyle}
        >
          {pinging ? 'Pinging…' : 'Ping design'}
        </button>
      </div>

      {connectionId && (
        <p style={metaStyle}>
          connectionId: <code>{connectionId}</code>
        </p>
      )}
      {connectError && <pre style={errorStyle}>connect error: {connectError}</pre>}
      {pingError && <pre style={errorStyle}>ping error: {pingError}</pre>}
      {pingResult && (
        <p style={metaStyle}>
          rtt: <strong>{String(pingResult.rttMs)}ms</strong> · serverTime:{' '}
          {new Date(pingResult.serverTime).toISOString()}
        </p>
      )}

      <h3 style={h3Style}>Participants</h3>
      {topology ? (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>id</th>
              <th style={thStyle}>type</th>
              <th style={thStyle}>registeredAt</th>
            </tr>
          </thead>
          <tbody>
            {topology.participants.map((p) => (
              <tr key={p.id}>
                <td style={tdStyle}>{p.id}</td>
                <td style={tdStyle}>{p.type}</td>
                <td style={tdStyle}>{new Date(p.registeredAt).toISOString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p style={mutedStyle}>loading…</p>
      )}

      <h3 style={h3Style}>Connections</h3>
      {topology ? (
        topology.connections.length === 0 ? (
          <p style={mutedStyle}>no connections yet — click Connect</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>id</th>
                <th style={thStyle}>from → to</th>
                <th style={thStyle}>state</th>
                <th style={thStyle}>changedAt</th>
              </tr>
            </thead>
            <tbody>
              {topology.connections.map((c) => (
                <tr key={c.connectionId}>
                  <td style={tdStyle}>{c.connectionId}</td>
                  <td style={tdStyle}>
                    {c.fromId} → {c.toId}
                  </td>
                  <td style={tdStyle}>
                    <span
                      style={{
                        ...stateBadgeStyle,
                        background: c.state === 'READY' ? '#0a3' : '#777',
                      }}
                    >
                      {c.state}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    {new Date(c.lastStateChangedAt).toISOString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )
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

const controlsRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  marginBottom: 12,
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

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 12,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  borderBottom: '1px solid #333',
  padding: '4px 6px',
  opacity: 0.7,
  fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
  borderBottom: '1px solid #1a1a1a',
  padding: '4px 6px',
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};

const stateBadgeStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 6px',
  borderRadius: 3,
  color: '#fff',
  fontSize: 11,
};
