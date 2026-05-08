// Phase 1 — Vite config for main-process bundle.
// `@telegraph/{application,core,services}` are aliased so source can use
// stable import paths from day one even though only a few directories exist.
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
      '@telegraph/application': resolve(__dirname, 'src/application'),
      '@telegraph/core': resolve(__dirname, 'src/core'),
      '@telegraph/services': resolve(__dirname, 'src/services'),
    },
  },
  build: {
    rollupOptions: {
      external: [...nodeBuiltins, 'electron'],
      output: {
        entryFileNames: 'index.js',
      },
    },
  },
});
