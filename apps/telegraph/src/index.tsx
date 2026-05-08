// Phase 4 — renderer entry.
//
// Mounts the design pagelet's `DesignPanel`, which in turn hosts
// `ConnectionsTab` (the renderer ↔ design utility direct-channel smoke test).
// The Phase 2 inline topology JSON dump moved into ConnectionsTab itself; the
// renderer entry is now a thin shell that boots React and routes to the
// active pagelet (currently always design).
//
// `@design/...` resolves via the alias declared in vite.renderer.config.ts +
// apps/telegraph/tsconfig.json's paths map.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { DesignPanel } from '@design/application/browser/DesignPanel';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('missing #root');

createRoot(rootEl).render(
  <StrictMode>
    <DesignPanel />
  </StrictMode>,
);
