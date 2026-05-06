import { defineConfig } from 'vite'
import { resolve } from 'path'

const nodeModules = [
  'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns', 'domain',
  'events', 'fs', 'http', 'https', 'net', 'os', 'path', 'process', 'punycode',
  'querystring', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls',
  'tty', 'url', 'util', 'v8', 'vm', 'zlib',
]

const externalPackages = [
  'electron-log',
  '@sentry/node',
  'electron-store',
  /@x-oasis\/async-call-rpc\/.*/,
]

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    mainFields: ['module', 'jsnext:main', 'jsnext'],
    alias: {
      '@chat/application': resolve(__dirname, 'src/application'),
      '@chat/core': resolve(__dirname, 'src/core'),
      '@chat/services': resolve(__dirname, 'src/services'),
    },
  },
  build: {
    target: 'node20',
    outDir: '.vite/build',
    ssr: true,
    rollupOptions: {
      input: 'src/main.ts',
      external: [...nodeModules, 'electron', ...externalPackages],
      output: {
        entryFileNames: 'index.js',
      },
    },
  },
})
