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
      '@telegraph/chat': resolve(__dirname, '../chat/src'),
      '@telegraph/pagelet-host': resolve(__dirname, '../../packages/services/src/pagelet-host/src'),
      '@telegraph/daemon': resolve(__dirname, '../daemon/src'),
      '@telegraph/main': resolve(__dirname, 'src'),
      '@telegraph/ui': resolve(__dirname, '../../packages/ui/src'),
      '@telegraph/runtime-contracts': resolve(__dirname, '../../packages/runtime-contracts/src/index.ts'),
    },
  },
  build: {
    outDir: '.vite/preload',
    lib: {
      entry: resolve(__dirname, '../chat/src/application/node/main.ts'),
      formats: ['cjs'],
    },
    rollupOptions: {
      external: [...nodeBuiltins, ...nodeBuiltins.map(m => `node:${m}`), 'electron'],
      output: {
        entryFileNames: 'chat-worker.js',
      },
    },
  },
});
