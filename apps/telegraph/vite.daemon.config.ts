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
    outDir: '.vite/build/daemon_utility',
    rollupOptions: {
      external: [
        ...nodeBuiltins,
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