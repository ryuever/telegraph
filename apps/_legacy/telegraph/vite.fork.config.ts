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
  esbuild: {
    // chat/design 的源码在 apps/chat/、apps/design/ 下，
    // esbuild 默认从文件位置向上找 tsconfig.json，会命中根目录（不存在）。
    // 指定 tsconfigRaw 避免 ENOENT 错误。
    tsconfigRaw: JSON.stringify({
      compilerOptions: {
        target: 'ES2020',
        useDefineForClassFields: true,
        module: 'ESNext',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        experimentalDecorators: true,
        jsx: 'react-jsx',
        strict: true,
      },
    }),
  },
  resolve: {
    alias: {
      '@telegraph/application': resolve(__dirname, 'src/application'),
      '@telegraph/core': resolve(__dirname, 'src/core'),
      '@telegraph/services': resolve(__dirname, 'src/services'),
      '@telegraph/agent': resolve(__dirname, '../../packages/agent/src'),
      '@telegraph/runtime-contracts': resolve(__dirname, '../../packages/runtime-contracts/src/index.ts'),
      '@chat': resolve(__dirname, '../../apps/chat/src'),
      '@design': resolve(__dirname, '../../apps/design/src'),
      '@monitor': resolve(__dirname, '../../apps/monitor/src'),
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
