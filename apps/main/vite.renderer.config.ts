import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig(({ command }) => ({
  ...(command === 'serve' ? { base: '/' } : {}),
  plugins: [react()],
  resolve: {
    alias: {
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
      '@/packages/runtime-contracts': resolve(__dirname, '../../packages/runtime-contracts/src/index.ts'),
      '@/packages/ui/useOrchestratorDashboard': resolve(__dirname, '../../packages/ui/src/hooks/useOrchestratorDashboard.ts'),
      '@/packages/ui': resolve(__dirname, '../../packages/ui/src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: {
      allow: ['..'],
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
