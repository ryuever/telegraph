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
      '@/apps/chat': resolve(__dirname, '../chat/src'),
      '@/packages/services/pagelet-host': resolve(__dirname, '../../packages/services/src/pagelet-host/src'),
      '@/packages/services/log': resolve(__dirname, '../../packages/services/src/log/src'),
      '@/apps/daemon': resolve(__dirname, '../daemon/src'),
      '@/apps/main': resolve(__dirname, 'src'),
      '@/packages/ui': resolve(__dirname, '../../packages/ui/src'),
      '@/packages/agent-protocol': resolve(__dirname, '../../packages/agent-protocol/src/index.ts'),
      '@/packages/run-protocol': resolve(__dirname, '../../packages/run-protocol/src/index.ts'),
      '@/packages/remote-protocol': resolve(__dirname, '../../packages/remote-protocol/src/index.ts'),
      '@/packages/computer-use': resolve(__dirname, '../../packages/computer-use/src'),
      '@/packages/computer-use-protocol': resolve(__dirname, '../../packages/computer-use-protocol/src/index.ts'),
      '@/packages/orchestrator-core': resolve(__dirname, '../../packages/orchestrator-core/src'),
      '@/packages/agent': resolve(__dirname, '../../packages/agent/src'),
      '@/packages/agent-capabilities': resolve(__dirname, '../../packages/agent-capabilities/src'),
      '@/packages/agent-extension-host': resolve(__dirname, '../../packages/agent-extension-host/src'),
      '@/packages/agent-resources': resolve(__dirname, '../../packages/agent-resources/src'),
      '@/extensions/telegraph-subagents': resolve(__dirname, '../../extensions/telegraph-subagents'),
    },
  },
  build: {
    outDir: '.vite/preload',
    lib: {
      entry: resolve(__dirname, '../chat/src/application/node/main.ts'),
      formats: ['cjs'],
    },
    rollupOptions: {
      external: isExternal,
      output: {
        entryFileNames: 'chat-worker.js',
      },
    },
  },
});
