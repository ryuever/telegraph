// Phase 1 — Vite config for the renderer bundle.
// Single window for now; routes / multi-pagelet hosting lands in Phase 4.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig(({ command }) => ({
  // Forge merges `base: './'` for production renderer builds. Dev needs `/` so
  // dev-server absolute URLs resolve correctly under Electron.
  ...(command === 'serve' ? { base: '/' } : {}),
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@telegraph/application': resolve(__dirname, 'src/application'),
      '@telegraph/core': resolve(__dirname, 'src/core'),
      '@telegraph/services': resolve(__dirname, 'src/services'),
      // Phase 4 — design pagelet's renderer surface (DesignPanel +
      // ConnectionsTab) lives in apps/design/src/application/browser/.
      // Aliasing here lets the telegraph renderer bundle pull those
      // components in directly via `@design/application/browser/...` —
      // matches the path mapping in apps/design/tsconfig.json so the
      // typecheck and the runtime build agree.
      '@design': resolve(__dirname, '../design/src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
}));
