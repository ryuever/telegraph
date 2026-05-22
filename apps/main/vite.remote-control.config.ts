import { defineConfig } from 'vite'
import { resolve } from 'node:path'

const nodeBuiltins = [
  'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns',
  'domain', 'events', 'fs', 'http', 'https', 'net', 'os', 'path', 'process',
  'querystring', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls',
  'tty', 'url', 'util', 'v8', 'vm', 'zlib', 'async_hooks', 'module',
]

const isExternal = (id: string) =>
  id === 'electron' ||
  id.startsWith('node:') ||
  nodeBuiltins.some(builtin => id === builtin || id.startsWith(`${builtin}/`))

export default defineConfig({
  resolve: {
    mainFields: ['module', 'jsnext:main', 'jsnext'],
    alias: {
      '@/apps/remote-control': resolve(__dirname, '../remote-control/src'),
      '@/apps/shared': resolve(__dirname, '../shared/src'),
      '@/packages/services/pagelet-host': resolve(__dirname, '../../packages/services/src/pagelet-host/src'),
      '@/packages/services/log': resolve(__dirname, '../../packages/services/src/log/src'),
      '@/packages/run-protocol': resolve(__dirname, '../../packages/run-protocol/src/index.ts'),
      '@/packages/remote-protocol': resolve(__dirname, '../../packages/remote-protocol/src/index.ts'),
    },
  },
  build: {
    outDir: '.vite/preload',
    lib: {
      entry: resolve(__dirname, '../remote-control/src/application/node/main.ts'),
      formats: ['cjs'],
    },
    rollupOptions: {
      external: isExternal,
      output: {
        entryFileNames: 'remote-control-worker.js',
      },
    },
  },
})
