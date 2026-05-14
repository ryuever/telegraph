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
      '@/apps/connection': resolve(__dirname, '../connection/src'),
      '@/packages/services/pagelet-host': resolve(__dirname, '../../packages/services/src/pagelet-host/src'),
      '@/apps/shared': resolve(__dirname, '../shared/src'),
      '@/apps/daemon': resolve(__dirname, '../daemon/src'),
      '@/apps/main': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: '.vite/preload',
    lib: {
      entry: resolve(__dirname, '../connection/src/application/node/main.ts'),
      formats: ['cjs'],
    },
    rollupOptions: {
      external: [...nodeBuiltins, ...nodeBuiltins.map(m => `node:${m}`), 'electron'],
      output: {
        entryFileNames: 'connection-worker.js',
      },
    },
  },
});
