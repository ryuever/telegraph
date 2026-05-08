// Phase 4 — top-level renderer surface for the design pagelet.
//
// Design context: codebase-wiki/roadmap/20260508-from-zero-design-only-electron-app-plan.md (§10 Phase 4).
//
// Hosts the per-tab views; Phase 4 only ships ConnectionsTab (the smoke-test
// for the renderer ↔ design utility direct channel). Phase 5+ adds real
// design-tool tabs (canvas, layers, inspector) once the wire-level link is
// proven trustworthy.
//
// Lives under `apps/design/` rather than `apps/telegraph/` so the design
// pagelet's UI can evolve in lock-step with its utility-process services.
// The renderer bundle is produced by apps/telegraph's vite renderer config,
// which exposes `@design/*` and `@telegraph/services/*` aliases so this file
// resolves at build time.
import type { JSX } from 'react';

import { ConnectionsTab } from './connections/ConnectionsTab';

export function DesignPanel(): JSX.Element {
  return (
    <div style={containerStyle}>
      <header style={headerStyle}>
        <h1 style={titleStyle}>Design</h1>
        <p style={subtitleStyle}>
          Phase 4 — renderer ↔ design utility direct channel.
        </p>
      </header>
      <ConnectionsTab />
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  fontFamily: 'system-ui, sans-serif',
  padding: 24,
  color: '#eee',
  background: '#0d0d0d',
  minHeight: '100vh',
  boxSizing: 'border-box',
};

const headerStyle: React.CSSProperties = { marginBottom: 8 };
const titleStyle: React.CSSProperties = { fontSize: 28, margin: 0 };
const subtitleStyle: React.CSSProperties = {
  margin: '6px 0 0',
  opacity: 0.65,
  fontSize: 13,
};
