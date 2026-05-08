// Phase 3 — Vite config for the design utility-process bundle.
//
// Source lives in `../design/src/main.ts` (the workspace neighbour app).
// Output goes under `.vite/build/design_utility/index.js`, which matches
// `DesignPageletProcess.resolveEntryPath()` in the main bundle.
//
// The `entry` is supplied by forge.config.ts via the `entry` build entry.
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const nodeBuiltins = [
  'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns',
  'domain', 'events', 'fs', 'http', 'https', 'net', 'os', 'path', 'process',
  'querystring', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls',
  'tty', 'url', 'util', 'v8', 'vm', 'zlib',
];

export default defineConfig({
  resolve: {
    mainFields: ['module', 'jsnext:main', 'jsnext'],
    alias: {
      // Source aliases for the design app itself.
      '@design': resolve(__dirname, '../design/src'),
      // Cross-app reference: UtilityCpClient + common wire types live under
      // apps/telegraph/src/services. Mirror the renderer/main alias setup.
      '@telegraph/services': resolve(__dirname, 'src/services'),
    },
  },
  build: {
    // Forge writes outputs under .vite/build/<name>/index.js per build entry.
    rollupOptions: {
      external: [...nodeBuiltins, 'electron'],
      output: {
        entryFileNames: 'index.js',
      },
    },
  },
});
