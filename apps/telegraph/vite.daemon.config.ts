// Vite config for the daemon utility-process bundle.
//
// Source lives in `../daemon/src/main.ts`.
// Output goes under `.vite/build/daemon_utility/index.js`.
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
      // Cross-app reference: UtilityCpClient + common wire types + core services
      // all live under apps/telegraph/src.
      '@telegraph/services': resolve(__dirname, 'src/services'),
      '@telegraph/core': resolve(__dirname, 'src/core'),
    },
  },
  build: {
    // Explicitly set entry point to daemon's main.ts
    lib: {
      entry: resolve(__dirname, '../daemon/src/main.ts'),
      formats: ['cjs'],
    },
    outDir: '.vite/build/daemon_utility',
    rollupOptions: {
      external: [
        ...nodeBuiltins,
        ...nodeBuiltins.map(m => `node:${m}`),
        'electron',
      ],
      output: {
        entryFileNames: 'index.js',
      },
    },
  },
});
