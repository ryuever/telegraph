// Phase 1 — minimal renderer entry. Just renders "Hello Telegraph" so we can
// confirm main → window → React mount works end-to-end before Phase 2 layers
// on the orchestrator inspector.
import { StrictMode } from 'react';
import type { JSX } from 'react';
import { createRoot } from 'react-dom/client';

function App(): JSX.Element {
  return (
    <main style={{ textAlign: 'center' }}>
      <h1 style={{ fontSize: 48, margin: 0 }}>Hello Telegraph</h1>
      <p style={{ opacity: 0.7, marginTop: 12 }}>Phase 1 — renderer mounted.</p>
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
