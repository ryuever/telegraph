import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

function emptyNodeBuiltinPlugin(): Plugin {
  const emptyModules = new Set(['child_process', 'module', 'perf_hooks', 'worker_threads']);

  return {
    name: 'telegraph:sandpacker-empty-node-builtins',
    resolveId(id) {
      if (emptyModules.has(id)) return `\0empty-node-builtin:${id}`;
      return null;
    },
    load(id) {
      if (!id.startsWith('\0empty-node-builtin:')) return null;
      return 'export default {}; export const performance = globalThis.performance;';
    },
  };
}

export default defineConfig(({ command }) => ({
  ...(command === 'serve' ? { base: '/' } : {}),
  plugins: [react(), emptyNodeBuiltinPlugin()],
  resolve: {
    alias: {
      assert: 'assert',
      buffer: 'buffer',
      constants: 'constants-browserify',
      crypto: 'crypto-browserify',
      events: 'events',
      child_process: resolve(__dirname, 'src/application/browser/sandpacker-node-stubs/empty.ts'),
      fs: 'memfs',
      module: resolve(__dirname, 'src/application/browser/sandpacker-node-stubs/module.ts'),
      os: 'os-browserify/browser',
      path: 'path-browserify',
      'node:path': 'path-browserify',
      perf_hooks: resolve(__dirname, 'src/application/browser/sandpacker-node-stubs/perf-hooks.ts'),
      process: 'process/browser',
      stream: 'stream-browserify',
      tty: 'tty-browserify',
      url: 'url',
      util: 'util',
      vm: 'vm-browserify',
      worker_threads: resolve(__dirname, 'src/application/browser/sandpacker-node-stubs/empty.ts'),
      '@/apps/main': resolve(__dirname, 'src'),
      '@/packages/services/pagelet-host': resolve(__dirname, '../../packages/services/src/pagelet-host/src'),
      '@/packages/services/main-metrics': resolve(__dirname, '../../packages/services/src/main-metrics/src'),
      '@/packages/services/log': resolve(__dirname, '../../packages/services/src/log/src'),
      '@/apps/connection': resolve(__dirname, '../connection/src'),
      '@/apps/daemon': resolve(__dirname, '../daemon/src'),
      '@/apps/shared': resolve(__dirname, '../shared/src'),
      '@/apps/monitor': resolve(__dirname, '../monitor/src'),
      '@/apps/setting': resolve(__dirname, '../setting/src'),
      '@/apps/design': resolve(__dirname, '../design/src'),
      '@/apps/chat': resolve(__dirname, '../chat/src'),
      '@/packages/stores': resolve(__dirname, '../../packages/stores/src/index.ts'),
      '@/packages/agent': resolve(__dirname, '../../packages/agent/src'),
      '@/packages/agent-protocol': resolve(__dirname, '../../packages/agent-protocol/src/index.ts'),
      '@/packages/ui/useOrchestratorDashboard': resolve(__dirname, '../../packages/ui/src/hooks/useOrchestratorDashboard.ts'),
      '@/packages/ui': resolve(__dirname, '../../packages/ui/src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    headers: {
      'Service-Worker-Allowed': '/',
    },
    fs: {
      allow: ['..'],
    },
  },
  define: {
    global: 'globalThis',
    __dirname: '"/"',
    __filename: '"/sandpacker-worker.js"',
    'process.env': {},
  },
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        entryFileNames: '[name]-[hash].js',
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        setting: resolve(__dirname, 'setting.html'),
      },
    },
  },
}));
