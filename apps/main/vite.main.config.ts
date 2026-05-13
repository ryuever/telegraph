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
      '@telegraph/main': resolve(__dirname, 'src'),
      '@telegraph/pagelet-host': resolve(__dirname, '../../packages/services/src/pagelet-host/src'),
      '@telegraph/main-metrics': resolve(__dirname, '../../packages/services/src/main-metrics/src'),
      '@telegraph/process': resolve(__dirname, '../../packages/services/src/process/src'),
      '@telegraph/connection': resolve(__dirname, '../connection/src'),
      '@telegraph/daemon': resolve(__dirname, '../daemon/src'),
      '@telegraph/shared': resolve(__dirname, '../shared/src'),
      '@telegraph/monitor': resolve(__dirname, '../monitor/src'),
      '@telegraph/setting': resolve(__dirname, '../setting/src'),
      '@telegraph/design': resolve(__dirname, '../design/src'),
      '@telegraph/chat': resolve(__dirname, '../chat/src'),
      '@telegraph/ui': resolve(__dirname, '../../packages/ui/src'),
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/application/electron-main/main.ts'),
      formats: ['cjs'],
    },
    rollupOptions: {
      external: [...nodeBuiltins, ...nodeBuiltins.map(m => `node:${m}`), 'electron'],
      output: {
        entryFileNames: 'index.js',
      },
    },
  },
});
