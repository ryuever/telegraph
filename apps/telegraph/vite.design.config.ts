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
    // Forge's base config sets a single `outDir: '.vite/build'` for ALL build
    // entries (see node_modules/@electron-forge/plugin-vite/.../vite.base.config.js
    // — there's even a `// 🚧 Multiple builds may conflict.` comment in there).
    // Without an explicit per-build override, multiple build entries either
    // share `.vite/build/<entry-basename>.js` (clobbering each other when the
    // basenames match — both this entry and `src/application/main.ts` would
    // emit `main.js`) or one of them silently produces nothing.
    //
    // Pin design utility's output to a dedicated subdir so:
    //   - main bundle stays at .vite/build/index.js (per vite.main.config.ts)
    //   - design utility lands at .vite/build/design_utility/index.js
    //   - DesignPageletProcess.resolveEntryPath() keeps using
    //     `join(__dirname, 'design_utility', 'index.js')` (since main bundle
    //     also lives in .vite/build/, that relative path is stable).
    outDir: '.vite/build/design_utility',
    rollupOptions: {
      external: [...nodeBuiltins, 'electron'],
      output: {
        entryFileNames: 'index.js',
      },
    },
  },
});
