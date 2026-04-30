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
  '@common/fetch',
  'electron-store',
  /@x-oasis\/async-call-rpc\/.*/,
]

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      '@app': resolve(__dirname, 'app'),
    },
  },
  build: {
    rollupOptions: {
      external: [...nodeModules, 'electron', ...externalPackages],
      output: {
        entryFileNames: '[name].js',
      },
    },
  },
})
