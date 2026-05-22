import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const nodeBuiltins = [
  'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns',
  'domain', 'events', 'fs', 'http', 'https', 'net', 'os', 'path', 'process',
  'querystring', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls',
  'tty', 'url', 'util', 'v8', 'vm', 'zlib', 'async_hooks', 'module',
];

const isExternal = (id: string) =>
  id === 'electron' ||
  id.startsWith('node:') ||
  nodeBuiltins.some(builtin => id === builtin || id.startsWith(`${builtin}/`));

export default defineConfig({
  resolve: {
    mainFields: ['module', 'jsnext:main', 'jsnext'],
    alias: {
      '@/apps/main': resolve(__dirname, 'src'),
      '@/packages/services/pagelet-host': resolve(__dirname, '../../packages/services/src/pagelet-host/src'),
      '@/packages/services/main-metrics': resolve(__dirname, '../../packages/services/src/main-metrics/src'),
      '@/packages/services/process': resolve(__dirname, '../../packages/services/src/process/src'),
      '@/packages/services/log': resolve(__dirname, '../../packages/services/src/log/src'),
      '@/apps/connection': resolve(__dirname, '../connection/src'),
      '@/apps/daemon': resolve(__dirname, '../daemon/src'),
      '@/apps/shared': resolve(__dirname, '../shared/src'),
      '@/apps/monitor': resolve(__dirname, '../monitor/src'),
      '@/apps/setting': resolve(__dirname, '../setting/src'),
      '@/apps/design': resolve(__dirname, '../design/src'),
      '@/apps/chat': resolve(__dirname, '../chat/src'),
      '@/apps/cli-gateway': resolve(__dirname, '../cli-gateway/src'),
      '@/apps/remote-control': resolve(__dirname, '../remote-control/src'),
      '@/packages/agent-protocol': resolve(__dirname, '../../packages/agent-protocol/src/index.ts'),
      '@/packages/run-protocol': resolve(__dirname, '../../packages/run-protocol/src/index.ts'),
      '@/packages/remote-protocol': resolve(__dirname, '../../packages/remote-protocol/src/index.ts'),
      '@/packages/computer-use': resolve(__dirname, '../../packages/computer-use/src'),
      '@/packages/computer-use-protocol': resolve(__dirname, '../../packages/computer-use-protocol/src/index.ts'),
      '@/packages/ui': resolve(__dirname, '../../packages/ui/src'),
    },
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'src/application/electron-main/main.ts'),
      formats: ['cjs'],
    },
    rollupOptions: {
      external: isExternal,
      output: {
        entryFileNames: 'index.js',
      },
    },
  },
});
