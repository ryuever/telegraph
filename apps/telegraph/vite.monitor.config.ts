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
      '@monitor': resolve(__dirname, '../monitor/src'),
      '@telegraph/services': resolve(__dirname, 'src/services'),
      '@telegraph/core': resolve(__dirname, 'src/core'),
    },
  },
  build: {
    outDir: '.vite/build/monitor_utility',
    rollupOptions: {
      external: [...nodeBuiltins, 'electron'],
      output: {
        entryFileNames: 'index.js',
      },
    },
  },
});
