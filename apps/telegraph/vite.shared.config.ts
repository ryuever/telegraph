// Vite config for the shared utility-process bundle.
//
// Source lives in `../shared/src/main.ts`.
// Output goes under `.vite/build/shared_utility/index.js`.
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
    // Explicitly set entry point to shared's main.ts
    lib: {
      entry: resolve(__dirname, '../shared/src/main.ts'),
      formats: ['cjs'],
    },
    outDir: '.vite/build/shared_utility',
    rollupOptions: {
      external: [
        ...nodeBuiltins,
        ...nodeBuiltins.map(m => `node:${m}`),
        'electron',
        '@x-oasis/di',
        '@x-oasis/async-call-rpc',
        '@x-oasis/async-call-rpc-electron',
      ],
      output: {
        entryFileNames: 'index.js',
      },
    },
  },
});