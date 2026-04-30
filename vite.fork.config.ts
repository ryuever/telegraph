import { defineConfig } from 'vite'
import { resolve } from 'path'

const nodeModules = [
  'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns', 'domain',
  'events', 'fs', 'http', 'https', 'net', 'os', 'path', 'process', 'punycode',
  'querystring', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls',
  'tty', 'url', 'util', 'v8', 'vm', 'zlib',
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
      external: [...nodeModules, 'electron'],
      output: {
        entryFileNames: '[name].js',
      },
    },
  },
})
