// Phase 2 — renderer entry.
//
// Boots the cp client, fetches the orchestrator topology snapshot via the
// inspector RPC, and renders it as JSON underneath the Phase 1 banner. This
// is the first end-to-end main↔renderer x-oasis call in the new project.
//
// Phase 4 will replace the JSON dump with DesignPanel + ConnectionsTab.
import { StrictMode, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { createRoot } from 'react-dom/client';

import type { TopologySnapshot } from '@telegraph/services/connection-orchestrator/common/types';

import { getInspectorClient } from '@telegraph/services/connection-orchestrator/browser/inspectorClient';

function App(): JSX.Element {
  const [topology, setTopology] = useState<TopologySnapshot | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    getInspectorClient()
      .getTopology()
      .then((snap) => {
        if (!cancelled) setTopology(snap);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <h1 style={{ fontSize: 32, margin: 0 }}>Telegraph</h1>
      <p style={{ opacity: 0.7, marginTop: 8 }}>
        Phase 2 — orchestrator inspector live.
      </p>
      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 18, margin: '0 0 8px' }}>Topology snapshot</h2>
        {error ? (
          <pre style={{ color: '#c33', whiteSpace: 'pre-wrap' }}>error: {error}</pre>
        ) : topology ? (
          <pre
            style={{
              background: '#111',
              color: '#0f0',
              padding: 12,
              borderRadius: 6,
              fontSize: 12,
              overflow: 'auto',
            }}
          >
            {JSON.stringify(topology, null, 2)}
          </pre>
        ) : (
          <p style={{ opacity: 0.6 }}>loading…</p>
        )}
      </section>
    </main>
  );
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('missing #root');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
